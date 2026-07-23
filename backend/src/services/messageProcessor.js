const { analyzeBlockReason } = require("../agent/blockAnalyzer");
const crypto = require("crypto");
const fs = require("fs/promises");
const { Task, Issue, Discussion, Activity } = require("../models");
const {
	parseMessage,
	detectStatus,
	extractDueDate,
	extractMentionedUsers,
} = require("../agent/parser");
const { analyzeSlackMessage } = require("../ai/gemini");
const { shouldAnalyze } = require("../ai/shouldAnalyze");
const { extractAttachments } = require("../attachments/extractor");
const { invalidateDailySummary } = require("../utils/cacheHelper");

const { cleanupCompletedWork } = require("../utils/retention");
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

	async checkAndPromptMissingInfo(doc, ctx) {
		let threadPrompt = "";

		if (
			(doc.status === "BLOCKED" || doc.status === "HOLD") &&
			!doc.blocked_reason
		) {
			doc.block_reason_pending = true;
			const statusLabel = doc.status === "HOLD" ? "HOLD" : "BLOCKED";
			threadPrompt += `⚠️ <@${ctx.sender.id}> This item is marked as *${statusLabel}*. Please reply directly to this thread with the reason.`;
		}

		if (
			!doc.due_date &&
			doc.status !== "COMPLETED" &&
			doc.status !== "RESOLVED"
		) {
			doc.due_date_pending = true;
			if (threadPrompt) {
				threadPrompt +=
					" Also, I couldn't find a due date. Please include the deadline in your reply (e.g., 'by tomorrow').";
			} else {
				threadPrompt += `📅 <@${ctx.sender.id}> I tracked this, but I couldn't find a due date. Please reply directly to this thread with the deadline (e.g., 'by tomorrow').`;
			}
		}

		if (threadPrompt) {
			const nextHour = new Date(Date.now() + 3600000);
			if (doc.block_reason_pending)
				doc.block_reason_notification_at = nextHour;
			if (doc.due_date_pending) doc.due_date_notification_at = nextHour;

			await doc.save();

			try {
				if (ctx.slack_client) {
					await ctx.slack_client.chat.postMessage({
						channel: ctx.channel,
						thread_ts: ctx.thread_id || ctx.message_ts,
						text: threadPrompt,
					});
				}
			} catch (err) {
				console.error(
					"Failed to ask for missing info in thread:",
					err.message,
				);
			}
		}
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
			slack_client = null,
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

		// 1. Intercept "accept @user" or "accept" with a tag
		if (text.trim().toLowerCase().startsWith("accept")) {
			const mentioned = extractMentionedUsers(text, user_directory || {});
			const targetToTag = mentioned.find(
				(u) => u.id && u.id !== sender?.id,
			);

			if (targetToTag && raw.slack_client) {
				const originalSenderId = targetToTag.id;
				// DM the original sender
				await raw.slack_client.chat.postMessage({
					channel: originalSenderId,
					text: `🔔 Good news! <@${sender.id}> is available and will connect with you right now.`,
				});
				// Confirm in the current thread
				await raw.slack_client.chat.postMessage({
					channel: channel,
					thread_ts: threadRoot || raw.message_ts,
					text: `✅ Thanks <@${sender.id}>! I've let <@${originalSenderId}> know you are ready.`,
				});
				return {
					classification: "GENERAL_DISCUSSION",
					action: "CONNECT_ACCEPTED",
					dashboard_update: false,
				};
			}
		}

		// 2. Intercept "delay [time] @user" (Handles "20 min", "1 hour", "4:45 pm", "tomorrow")
		if (text.trim().toLowerCase().startsWith("delay")) {
			const mentioned = extractMentionedUsers(text, user_directory || {});
			const targetToTag = mentioned.find(
				(u) => u.id && u.id !== sender?.id,
			);

			if (targetToTag && raw.slack_client) {
				const originalSenderId = targetToTag.id;

				// Clean the text: remove "delay", remove the tag, and trim spaces
				const timeInput = text
					.replace(/^delay/i, "")
					.replace(new RegExp(`<@${targetToTag.id}>`, "gi"), "")
					.replace(/@[A-Za-z0-9_.-]+/g, "")
					.trim();

				let postAt;
				let delayText = timeInput;

				// Parse relative minutes (e.g. "20", "20 min", "20 mins")
				const minMatch = timeInput.match(
					/^(\d+)\s*(?:m|min|mins|minutes?)?$/i,
				);
				// Parse relative hours (e.g. "1 hour", "1.5 hrs")
				const hrMatch = timeInput.match(
					/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)$/i,
				);

				if (minMatch) {
					const mins = parseInt(minMatch[1], 10);
					postAt =
						Math.floor(Date.now() / 1000) + Math.max(mins * 60, 65);
					delayText = `in ${mins} minutes`;
				} else if (hrMatch) {
					const hrs = parseFloat(hrMatch[1]);
					postAt =
						Math.floor(Date.now() / 1000) +
						Math.max(hrs * 3600, 65);
					delayText = `in ${hrs} hours`;
				} else {
					// Fallback to your built-in AI date parser for "4:45 pm", "tomorrow", etc.
					const parsedDateStr = extractDueDate(timeInput, new Date());
					if (parsedDateStr) {
						postAt = Math.floor(
							new Date(parsedDateStr).getTime() / 1000,
						);
						delayText = `at ${timeInput}`;

						// If the parsed time has already passed today (e.g. it's 5 PM and they said "4:45 PM"), bump it to tomorrow
						if (postAt <= Math.floor(Date.now() / 1000) + 60) {
							postAt += 24 * 3600;
						}
					} else {
						// Couldn't understand the time formatting
						await raw.slack_client.chat.postMessage({
							channel: channel,
							thread_ts: threadRoot || raw.message_ts,
							text: `⚠️ I didn't understand the time "${timeInput}". Try "20 mins", "1 hour", "4:45 pm", or "tomorrow".`,
						});
						return {
							classification: "GENERAL_DISCUSSION",
							action: "CONNECT_DELAY_FAILED",
							dashboard_update: false,
						};
					}
				}

				// DM Original Sender
				await raw.slack_client.chat.postMessage({
					channel: originalSenderId,
					text: `🕒 <@${sender.id}> is currently busy, but will be free *${delayText}* to connect.`,
				});
				// Confirm in the current thread
				await raw.slack_client.chat.postMessage({
					channel: channel,
					thread_ts: threadRoot || raw.message_ts,
					text: `✅ Delay set! I've let <@${originalSenderId}> know you'll be free ${delayText}. You will both get a reminder.`,
				});

				// Schedule Reminders
				try {
					await raw.slack_client.chat.scheduleMessage({
						channel: originalSenderId,
						post_at: postAt,
						text: `🔔 *Reminder:* <@${sender.id}> should be free now to connect!`,
					});
					await raw.slack_client.chat.scheduleMessage({
						channel: sender.id,
						post_at: postAt,
						text: `🔔 *Reminder:* You are scheduled to connect with <@${originalSenderId}> right now!`,
					});
				} catch (e) {
					console.error("[Slack] Scheduler error:", e.message);
				}

				return {
					classification: "GENERAL_DISCUSSION",
					action: "CONNECT_DELAYED",
					dashboard_update: false,
				};
			}
		}

		// ✨ Generic Connect Command (Thread Flow with updated instructions)
		const connectMatch = text.match(
			/\bconnect\s+(?:with\s+)?(?:<@[A-Z0-9]+>|@[A-Za-z0-9_.-]+)/i,
		);
		if (connectMatch) {
			try {
				const mentioned = extractMentionedUsers(
					text,
					user_directory || {},
				);
				const senderId = sender?.id || "unknown";
				const targetUser = mentioned.find(
					(u) => u.id && u.id !== senderId,
				);

				if (targetUser && raw.slack_client) {
					console.log(
						`[Connect] Thread Flow Triggered! Sender: ${senderId}, Target: ${targetUser.id}`,
					);

					const blocks = [
						{
							type: "header",
							text: {
								type: "plain_text",
								text: "🗓️ Connection Request",
							},
						},
						{
							type: "section",
							text: {
								type: "mrkdwn",
								text: `Hi <@${targetUser.id}>, <@${senderId}> would like to connect with you.\n\n*To respond, reply in this thread with:*\n✅ \`accept <@${senderId}>\` _(If free now)_\n🕒 \`delay 20 mins <@${senderId}>\` _(Or '1 hour', '4:45 pm', 'tomorrow')_`,
							},
						},
					];

					// Post publicly in the exact thread where the command was typed
					await raw.slack_client.chat.postMessage({
						channel: channel,
						thread_ts: threadRoot || raw.message_ts,
						text: `Connection Request for <@${targetUser.id}>`,
						blocks,
					});

					return {
						classification: "GENERAL_DISCUSSION",
						action: "CONNECT_REQUEST",
						dashboard_update: true,
					};
				}
			} catch (err) {
				console.error("[Connect] FATAL ERROR:", err.message);
			}
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

		// 1. DEDUPLICATION & TASK UPDATES
		// We removed the "!isExplicitCommand" restriction so this runs even if you type "task -"
		if (
			parsed.classification === "TASK" &&
			parsed.action === "CREATE_TASK" &&
			parsed.task
		) {
			// Use a slightly lower threshold (0.75) so "fix code" matches "fix code is done"
			const sim = await findSimilarTask(
				parsed.task.title,
				parsed.task.description,
				workspace_id,
				channel,
				0.6,
			);
			if (sim) {
				parsed.action = "UPDATE_TASK";
				parsed.task_created = false;
				parsed.task_updated = true;
				parsed.task.id = sim.task.task_id;
				existing_task = sim.task;

				// Preserve the new status if you typed "completed" or "blocked"
				if (parsed.task.status && parsed.task.status !== "TODO") {
					parsed.updates = {
						...parsed.updates,
						status: parsed.task.status,
					};
				}
			}
		}

		// 2. STANDALONE STATUS CATCHER
		// Catches messages like "fix code of backend is done" that might have missed the TASK classification
		if (
			parsed.classification === "GENERAL_DISCUSSION" &&
			parsed.action === "STORE_DISCUSSION"
		) {
			const statusMatch = detectStatus(text);
			if (statusMatch !== "TODO") {
				const sim = await findSimilarTask(
					text,
					"",
					workspace_id,
					channel,
					0.75,
				);
				if (sim) {
					parsed.classification = "TASK";
					parsed.action = "UPDATE_TASK";
					parsed.task_created = false;
					parsed.task_updated = true;
					parsed.task = {
						...sim.task,
						id: sim.task.task_id,
						status: statusMatch,
					};
					parsed.updates = { status: statusMatch };
					existing_task = sim.task;
				}
			}
		}

		const result = await this.persist(parsed, {
			text,
			sender,
			channel,
			thread_id: threadRoot,
			workspace_id,
			team,
			message_ts,
			slack_client,
			user_directory: raw.user_directory || {},
			existing_task,
			existing_issue,
		});

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

		await this.checkAndPromptMissingInfo(doc, ctx);

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

		// ✨ Intercept the exact moment a new block reason is saved
		if (ctx.updates && ctx.updates.block_reason) {
			// Extract the tagged user directly from the block reason reply
			const mentionedInReason = extractMentionedUsers(
				ctx.updates.block_reason,
				ctx.user_directory,
			);

			// Find the first tagged person who isn't the person who owns the task
			const targetUser = mentionedInReason.find(
				(u) => u.id && u.id !== (doc.assigned_to?.id || ctx.sender?.id),
			);

			if (targetUser) {
				const ownerName =
					doc.assigned_to?.name ||
					ctx.sender?.name ||
					"A team member";
				const senderId = ctx.sender?.id || "unknown";

				const blocks = [
					{
						type: "header",
						text: {
							type: "plain_text",
							text: "🚨 Action Required: Task Blocked",
						},
					},
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `Hi ${targetUser.display_name},\n\nThe task *${doc.title}* has been marked as blocked by *${ownerName}*.\n\n*Reason:* ${ctx.updates.block_reason}\n\nPlease review this at your earliest convenience.`,
						},
					},
					{
						type: "actions",
						elements: [
							{
								type: "button",
								text: {
									type: "plain_text",
									text: "✅ I'm looking into it",
								},
								style: "primary",
								action_id: "accept_sync_btn",
								value: `${doc.task_id}|${senderId}`,
							},
							{
								type: "button",
								text: {
									type: "plain_text",
									text: "🕒 I'll check later",
								},
								action_id: "later_sync_btn",
								value: `${doc.task_id}|${senderId}`,
							},
						],
					},
				];

				try {
					await ctx.slack_client.chat.postMessage({
						channel: targetUser.id,
						text: `Blocked Task Notification: ${doc.title}`,
						blocks,
					});

					await ctx.slack_client.chat.postMessage({
						channel: ctx.channel,
						thread_ts: ctx.thread_id || ctx.message_ts,
						text: `✅ <@${senderId}> I have privately messaged <@${targetUser.id}> about this blocker. I will DM you directly with their response.`,
					});
				} catch (err) {
					console.error(
						"[Slack] Failed to notify blocking user:",
						err.message,
					);
				}
			}
		}

		await this.checkAndPromptMissingInfo(doc, ctx);

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

    await this.logActivity({
      type: "ISSUE_CREATED",
      summary: `Issue created: ${doc.title}`,
      actor: senderRef,
      issue_id: issueId,
      channel: ctx.channel,
      thread: ctx.thread_id,
    });

    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();
		await this.logActivity({
			type: "ISSUE_CREATED",
			summary: `Issue created: ${doc.title}`,
			actor: senderRef,
			issue_id: issueId,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

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

		await this.logActivity({
			type: "ISSUE_UPDATED",
			summary: `Issue updated: ${doc.title}`,
			actor: senderRef,
			issue_id: doc.issue_id,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});
    // ⚡ Invalidate daily summary cache for today
    await invalidateDailySummary();

		return {
			...parsed,
			issue_created: false,
			issue_updated: true,
			issue: this.issueSnapshot(doc),
		};
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
				{
					$addToSet: {
						related_discussions: discussion.discussion_id,
					},
				},
			);
		}
		if (discussion.issue_id) {
			await Issue.updateOne(
				{ issue_id: discussion.issue_id },
				{
					$addToSet: {
						related_discussions: discussion.discussion_id,
					},
				},
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

		if (discussion.task_id) {
			await this.dispatchNotifications(parsed.notifications, {
				task_id: discussion.task_id,
				issue_id: null,
			});
		}

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

  async acknowledge(parsed, ctx, senderRef) {
    return { ...parsed, acknowledgement: true };
  }

    async createDiscussionRecord(parsed, ctx, senderRef, links) {
    // 🟢 Safe fallback logic: Guarantees content is never empty or ""
    const safeContent =
      parsed.discussion?.content?.trim() ||
      parsed.content?.trim() ||
      ctx?.text?.trim() ||
      "Slack discussion update";

    return Discussion.create({
      discussion_id: newId("dsc"),
      content: safeContent, // 👈 Fixes Mongoose validation error
      author: senderRef,
      channel: ctx.channel,
      thread: ctx.thread_id || ctx.thread,
      workspace_id: ctx.workspace_id,
      team: ctx.team,
      task_id: links.task_id,
      issue_id: links.issue_id,
      slack_message_ts: ctx.message_ts || ctx.ts, // 👈 Checks both message_ts and ts
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
			due_date: doc.due_date ? doc.due_date.toISOString() : "",
			due_date_pending: doc.due_date_pending,
			block_reason_pending: doc.block_reason_pending,
      owner: doc.owner,
      assigned_to: doc.assigned_to,
    };
  }
}

module.exports = { MessageProcessor };