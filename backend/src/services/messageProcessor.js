const crypto = require("crypto");
const fs = require("fs/promises");
const { Task, Issue, Discussion, Activity } = require("../models");
const { parseMessage } = require("../agent/parser");
const { analyzeSlackMessage } = require("../ai/gemini");
const { shouldAnalyze } = require("../ai/shouldAnalyze");
const { extractAttachments } = require("../attachments/extractor");
const { invalidateDailySummary } = require("../utils/cacheHelper");
const { inngest } = require("../inngest/client");

const {
  findSimilarTask,
  findSimilarIssue,
  findWorkByThread,
  findWorkByMessageTs,
} = require("./similarity");
const { newId } = require("../utils/helpers");

function hashText(text = "") {
  return crypto.createHash("sha1").update(text || "").digest("hex");
}

function wasTextAlreadyAnalyzed(doc, message_ts, hash) {
  if (!doc || !Array.isArray(doc.history) || !message_ts) return false;
  return doc.history.some(
    (h) => h?.details?.message_ts === message_ts && h?.details?.text_hash === hash,
  );
}

class MessageProcessor {
  constructor({ notificationService, io } = {}) {
    this.notifications = notificationService || null;
    this.io = io || null;
  }

  setIo(io) {
    this.io = io;
  }

  async process(raw, options = {}) {
    const {
      text = "",
      sender,
      channel = "",
      thread_id = "",
      workspace_id = "",
      team = "",
      message_ts = "",
      is_edit = false,
      user_directory = {},
      local_attachments = [],
    } = raw;
    const { quiet = false } = options;

    let existing_task = null;
    let existing_issue = null;

    const isExplicitCommand = /task\s*-/i.test(text) || /issue\s*-/i.test(text);
    const textHash = hashText(text);
    let alreadyAnalyzed = false;

    if (is_edit && message_ts) {
      const byMsg = await findWorkByMessageTs(message_ts);
      existing_task = byMsg.task;
      existing_issue = byMsg.issue;

      alreadyAnalyzed =
        wasTextAlreadyAnalyzed(existing_task, message_ts, textHash) ||
        wasTextAlreadyAnalyzed(existing_issue, message_ts, textHash);
    }

    const threadRoot = thread_id || message_ts;

    if (!existing_task && !existing_issue && threadRoot && !isExplicitCommand) {
      const byThread = await findWorkByThread(threadRoot, channel);
      existing_task = byThread.task;
      existing_issue = byThread.issue;
    }

    // Step 1: Baseline parse
    const parsed = await parseMessage({
      text,
      sender,
      channel,
      thread_id: threadRoot,
      workspace_id,
      team,
      message_ts,
      is_edit,
      user_directory,
      existing_task,
      existing_issue,
      now: new Date(),
    });

    if (
      parsed.classification === "TASK" &&
      parsed.action === "CREATE_TASK" &&
      parsed.task &&
      !isExplicitCommand
    ) {
      const sim = await findSimilarTask(
        parsed.task.title,
        parsed.task.description,
        workspace_id,
        channel,
      );
      if (sim) {
        parsed.action = "UPDATE_TASK";
        parsed.task_created = false;
        parsed.task_updated = true;
        parsed.task.id = sim.task.task_id;
        existing_task = sim.task;
      }
    }

    if (
      parsed.classification === "ISSUE" &&
      parsed.action === "CREATE_ISSUE" &&
      parsed.issue
    ) {
      const sim = await findSimilarIssue(
        parsed.issue.title,
        parsed.issue.description,
        workspace_id,
        channel,
      );
      if (sim) {
        parsed.action = "UPDATE_ISSUE";
        parsed.issue_created = false;
        parsed.issue_updated = true;
        parsed.issue.id = sim.issue.issue_id;
        existing_issue = sim.issue;
      }
    }

    // Step 2: AI Enhancement
    let enhanced = parsed;

    if (!alreadyAnalyzed) {
      let attachments = [];
      if (
        local_attachments.length &&
        shouldAnalyze({ rawMessage: text, parserResult: parsed, attachments: local_attachments })
      ) {
        attachments = await extractAttachments(local_attachments);
      }

      enhanced = await analyzeSlackMessage({
        rawMessage: text,
        parserResult: parsed,
        existingTask: existing_task ? this.taskSnapshot(existing_task) : null,
        existingIssue: existing_issue ? this.issueSnapshot(existing_issue) : null,
        threadContext: [],
        attachments,
      });
    }

    // Step 3: Persist and cleanup attachments
    let result;
    try {
      result = await this.persist(
        {
          ...enhanced,
          local_attachments,
        },
        {
          text,
          sender,
          channel,
          thread_id: threadRoot,
          workspace_id,
          team,
          message_ts,
          text_hash: textHash,
          existing_task,
          existing_issue,
        },
      );
    } finally {
      await this.cleanupAttachments(local_attachments);
    }

    if (this.io && !quiet) {
      this.io.emit("dashboard:update", {
        action: result.action,
        classification: result.classification,
        task_id: result.task?.id || null,
        issue_id: result.issue?.id || null,
        at: new Date().toISOString(),
      });
    }

    return result;
  }

  async cleanupAttachments(localAttachments = []) {
    for (const attachment of localAttachments) {
      try {
        if (attachment.localPath) {
          await fs.unlink(attachment.localPath);
          console.log(`[cleanup] Deleted local temp attachment: ${attachment.localPath}`);
        }
      } catch (err) {
        console.warn(`[cleanup] Failed to delete file ${attachment.localPath}:`, err.message);
      }
    }
  }

  async persist(parsed, ctx) {
    const senderRef = parsed.sender;

    switch (parsed.action) {
      case "CREATE_TASK":
        return this.createTask(parsed, ctx, senderRef);
      case "UPDATE_TASK":
      case "UPDATE_LINKED_WORK":
        if (parsed.task?.id || ctx.existing_task) {
          return this.updateTask(parsed, ctx, senderRef);
        }
        if (parsed.issue?.id || ctx.existing_issue) {
          return this.updateIssue(parsed, ctx, senderRef);
        }
        return this.storeDiscussion(parsed, ctx, senderRef);
      case "CREATE_ISSUE":
        return this.createIssue(parsed, ctx, senderRef);
      case "UPDATE_ISSUE":
        return this.updateIssue(parsed, ctx, senderRef);
      case "ACKNOWLEDGE_DEPENDENCY":
        return this.acknowledge(parsed, ctx, senderRef);
      case "LINK_DISCUSSION":
      case "STORE_DISCUSSION":
      default:
        return this.storeDiscussion(parsed, ctx, senderRef);
    }
  }

  async storeDiscussion(parsed, ctx, senderRef) {
    if (parsed.updates && parsed.updates.status) {
      if (parsed.discussion?.task_id) {
        await Task.updateOne(
          { task_id: parsed.discussion.task_id },
          { $set: { status: parsed.updates.status } },
        );
      } else if (parsed.discussion?.issue_id) {
        await Issue.updateOne(
          { issue_id: parsed.discussion.issue_id },
          { $set: { status: parsed.updates.status } },
        );
      }
    }

    const discussion = await this.createDiscussionRecord(
      parsed,
      ctx,
      senderRef,
      {
        task_id: parsed.discussion?.task_id || null,
        issue_id: parsed.discussion?.issue_id || null,
      },
    );

    if (discussion.task_id) {
      await Task.updateOne(
        { task_id: discussion.task_id },
        { $addToSet: { related_discussions: discussion.discussion_id } },
      );
    }
    if (discussion.issue_id) {
      await Issue.updateOne(
        { issue_id: discussion.issue_id },
        { $addToSet: { related_discussions: discussion.discussion_id } },
      );
    }

    await this.logActivity({
      type: "DISCUSSION",
      summary: `Discussion: ${(parsed.discussion?.content || ctx.text || "").slice(0, 80)}`,
      actor: senderRef,
      discussion_id: discussion.discussion_id,
      task_id: discussion.task_id,
      issue_id: discussion.issue_id,
      channel: ctx.channel,
      thread: ctx.thread_id,
    });

    await this.dispatchNotifications(parsed.notifications, {
      task_id: discussion.task_id,
      issue_id: discussion.issue_id,
    });

    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();

    return {
      ...parsed,
      discussion: {
        id: discussion.discussion_id,
        content: discussion.content,
        task_id: discussion.task_id,
        issue_id: discussion.issue_id,
        flagged_for_review: discussion.flagged_for_review,
      },
    };
  }

  async createTask(parsed, ctx, senderRef) {
    const t = parsed.task || {};
    const taskId = newId("tsk");
    const dueDate = t.due_date ? new Date(t.due_date) : null;

    const doc = await Task.create({
      task_id: taskId,
      title: t.title,
      description: t.description || ctx.text,
      owner: parsed.owner || { id: "", name: "Unassigned" },
      assigned_to: parsed.assigned_to || { id: "", name: "Unassigned" },
      assigned_by: parsed.assigned_by || senderRef,
      reporter: parsed.reporter || senderRef,
      created_by: senderRef,
      last_updated_by: senderRef,
      mentioned_users: parsed.mentioned_users || [],
      priority: t.priority || "MEDIUM",
      status: t.status || "TODO",
      due_date: dueDate,
      due_date_pending: !dueDate,
      blocked_reason: t.blocked_reason || "",
      block_reason_pending: t.status === "BLOCKED" && !t.blocked_reason,
      dependencies: t.dependencies || [],
      confidence_score: parsed.confidence,
      channel: ctx.channel,
      thread: ctx.thread_id,
      workspace_id: ctx.workspace_id,
      team: ctx.team,
      slack_message_ts: ctx.message_ts,
      entities: parsed.meta?.entities || {},
      local_file_logs: parsed.local_attachments || [],
      history: [
        {
          event: "CREATED",
          by: senderRef,
          details: { action: "CREATE_TASK", message_ts: ctx.message_ts, text_hash: ctx.text_hash },
        },
      ],
    });

    await this.logActivity({
      type: "TASK_CREATED",
      summary: `Task created: ${doc.title}`,
      actor: senderRef,
      task_id: taskId,
      channel: ctx.channel,
      thread: ctx.thread_id,
    });

    await this.dispatchNotifications(parsed.notifications, { task_id: taskId });

    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();

    return {
      ...parsed,
      task_created: true,
      task_updated: false,
      task: this.taskSnapshot(doc),
    };
  }

  async updateTask(parsed, ctx, senderRef) {
    const taskId = parsed.task?.id || ctx.existing_task?.task_id;
    const doc = await Task.findOne({ task_id: taskId });
    if (!doc) {
      return this.createTask({ ...parsed, action: "CREATE_TASK", task_created: true }, ctx, senderRef);
    }

    const t = parsed.task || {};
    const updates = parsed.updates || {};

    if (t.title && !ctx.existing_task) doc.title = t.title;
    if (t.description) doc.description = t.description;
    if (parsed.owner) doc.owner = parsed.owner;
    if (parsed.assigned_to) doc.assigned_to = parsed.assigned_to;

    const nextStatus = updates.status || t.status;
    if (nextStatus) doc.status = nextStatus;

    doc.last_updated_by = senderRef;
    await doc.save();

    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();

    return {
      ...parsed,
      task_created: false,
      task_updated: true,
      task: this.taskSnapshot(doc),
    };
  }

  async createIssue(parsed, ctx, senderRef) {
    const i = parsed.issue || {};
    const issueId = newId("iss");

    const doc = await Issue.create({
      issue_id: issueId,
      title: i.title,
      description: i.description || ctx.text,
      reporter: parsed.reporter || senderRef,
      owner: parsed.owner || { id: "", name: "Unassigned" },
      assigned_to: parsed.assigned_to || { id: "", name: "Unassigned" },
      assigned_by: parsed.assigned_by || senderRef,
      created_by: senderRef,
      last_updated_by: senderRef,
      mentioned_users: parsed.mentioned_users || [],
      priority: i.priority || "HIGH",
      status: i.status || "HOLD",
      confidence_score: parsed.confidence,
      channel: ctx.channel,
      thread: ctx.thread_id,
      workspace_id: ctx.workspace_id,
      team: ctx.team,
      slack_message_ts: ctx.message_ts,
      local_file_logs: parsed.local_attachments || [],
    });

    try {
      console.log(`[MessageProcessor] ⚡ Sending Inngest event 'issue/created' for ID: ${doc.issue_id}`);
      const sendRes = await inngest.send({
        name: "issue/created",
        data: {
          issueId: doc.issue_id,
          workspaceId: ctx.workspace_id || "",
          channel: ctx.channel || "",
        },
      });
      console.log("[MessageProcessor] ✅ Inngest event dispatched successfully:", sendRes);
    } catch (err) {
      console.error("[MessageProcessor] ❌ Inngest Send Error:", err.message);
    }

    await this.logActivity({
      type: "ISSUE_CREATED",
      summary: `Issue created: ${doc.title}`,
      actor: senderRef,
      issue_id: issueId,
      channel: ctx.channel,
      thread: ctx.thread_id,
    });

    // Invalidate daily summary cache for today
    await invalidateDailySummary();

    return {
      ...parsed,
      issue_created: true,
      issue_updated: false,
      issue: this.issueSnapshot(doc),
    };
  }

  async updateIssue(parsed, ctx, senderRef) {
    const issueId = parsed.issue?.id || ctx.existing_issue?.issue_id;
    const doc = await Issue.findOne({ issue_id: issueId });
    if (!doc) {
      return this.createIssue({ ...parsed, action: "CREATE_ISSUE", issue_created: true }, ctx, senderRef);
    }

    const i = parsed.issue || {};
    const updates = parsed.updates || {};

    if (i.description) doc.description = i.description;
    const nextStatus = updates.status || i.status;
    if (nextStatus) doc.status = nextStatus;

    doc.last_updated_by = senderRef;
    await doc.save();

    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();

    return {
      ...parsed,
      issue_created: false,
      issue_updated: true,
      issue: this.issueSnapshot(doc),
    };
  }

  async acknowledge(parsed, ctx, senderRef) {
    return { ...parsed, acknowledgement: true };
  }

  async createDiscussionRecord(parsed, ctx, senderRef, links) {
    return Discussion.create({
      discussion_id: newId("dsc"),
      content: parsed.discussion?.content || ctx.text,
      author: senderRef,
      channel: ctx.channel,
      thread: ctx.thread_id,
      workspace_id: ctx.workspace_id,
      team: ctx.team,
      task_id: links.task_id,
      issue_id: links.issue_id,
      slack_message_ts: ctx.message_ts,
      mentioned_users: parsed.mentioned_users || [],
      timestamp: new Date(),
    });
  }

  async dispatchNotifications(list = [], ids = {}) {
    if (!this.notifications || !list.length) return;
    for (const n of list) {
      await this.notifications.createAndSend({
        ...n,
        task_id: ids.task_id || n.task_id || null,
        issue_id: ids.issue_id || n.issue_id || null,
        scheduleReminder: true,
      });
    }
  }

  async logActivity(entry) {
    await Activity.create({
      activity_id: newId("act"),
      type: entry.type,
      summary: entry.summary,
      actor: entry.actor,
      task_id: entry.task_id || null,
      issue_id: entry.issue_id || null,
      discussion_id: entry.discussion_id || null,
      channel: entry.channel || "",
      thread: entry.thread || "",
      payload: entry.payload || {},
    });
  }

  taskSnapshot(doc) {
    return {
      id: doc.task_id,
      title: doc.title,
      description: doc.description,
      priority: doc.priority,
      status: doc.status,
      due_date: doc.due_date ? doc.due_date.toISOString() : "",
      owner: doc.owner,
      assigned_to: doc.assigned_to,
    };
  }

  issueSnapshot(doc) {
    return {
      id: doc.issue_id,
      title: doc.title,
      description: doc.description,
      status: doc.status,
      priority: doc.priority,
      owner: doc.owner,
      assigned_to: doc.assigned_to,
    };
  }
}

module.exports = { MessageProcessor };