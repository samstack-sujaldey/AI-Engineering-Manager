const express = require("express");
const { body, validationResult } = require("express-validator");
const { Task, Issue, Discussion } = require("../models");
const { getDashboard } = require("../services/dashboard");
const {
  createSlackClient,
  listChannels,
  syncFromSlack,
} = require("../services/slackSync");
const { parseMessage } = require("../agent/parser");
const { newId } = require("../utils/helpers");
const DailySummary = require("../models/DailySummary");
const { sendDailyStandupBriefings } = require("../config/scheduler.js");
const { callOpenAI } = require(".././ai/openai.js");

function createApiRouter({ messageProcessor }) {
  const router = express.Router();

  router.get("/discussions/daily-summary", async (req, res) => {
    try {
      // 1. Get requested date string safely (YYYY-MM-DD)
      const getTodayStr = () => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      const requestedDateStr = req.query.date
        ? String(req.query.date).split("T")[0].trim()
        : getTodayStr();

      const forceRefresh = req.query.forceRefresh === "true";

      // 2. Cache Lookup
      if (!forceRefresh) {
        const cachedDoc = await DailySummary.findOne({
          date: requestedDateStr,
        }).lean();
        if (cachedDoc && cachedDoc.summary) {
          console.log(`[DailySummary] ⚡ Serving cache for: ${requestedDateStr}`);
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          return res.json({
            date: requestedDateStr,
            summary: cachedDoc.summary,
            tasks_count: cachedDoc.tasks_count || 0,
            issues_count: cachedDoc.issues_count || 0,
            cached: true,
            last_updated_at: cachedDoc.updatedAt || cachedDoc.createdAt,
          });
        }
      }

      console.log(`[DailySummary] 🤖 Generating summary for (${requestedDateStr})...`);

      // 3. Parse date strictly without timezone shifting
      const [reqYear, reqMonth, reqDay] = requestedDateStr.split("-").map(Number);
      if (!reqYear || !reqMonth || !reqDay) {
        return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
      }

      // Set local start and end of the requested day
      const startOfDay = new Date(reqYear, reqMonth - 1, reqDay, 0, 0, 0, 0);
      const endOfDay = new Date(reqYear, reqMonth - 1, reqDay, 23, 59, 59, 999);

      // 4. Query DB for tasks and issues strictly within the requested day
      const [tasks, issues] = await Promise.all([
        Task.find(
          {
            $or: [
              { created_time: { $gte: startOfDay, $lte: endOfDay } },
              { updated_time: { $gte: startOfDay, $lte: endOfDay } },
              { due_date: { $gte: startOfDay, $lte: endOfDay } },
            ],
          },
          "title status priority blocked_reason"
        ).lean().catch(() => []),

        Issue.find(
          {
            $or: [
              { created_time: { $gte: startOfDay, $lte: endOfDay } },
              { updated_time: { $gte: startOfDay, $lte: endOfDay } },
            ],
          },
          "title status priority blocked_reason"
        ).lean().catch(() => []),
      ]);

      // Present Members: everyone who has any task/issue activity today,
      // deduplicated, in the exact "Present Members: A, B, C" format requested.
      const memberNames = [];
      const seenNames = new Set();
      const addMember = (name) => {
        if (name && name !== "Unassigned" && !seenNames.has(name)) {
          seenNames.add(name);
          memberNames.push(name);
        }
      };
      for (const t of tasks) addMember(t.assigned_to?.name || t.owner?.name);
      for (const i of issues) addMember(i.assigned_to?.name || i.owner?.name);
      const presentMembers = memberNames.join(", ") || "—";

      // Standup duration isn't tracked anywhere in the data — using a fixed
      // default. Override with STANDUP_DURATION in .env if you want a
      // different value, or wire this up to something real later.
      const duration = process.env.STANDUP_DURATION || "15 Minutes";

      const momHeader =
        `Hi Everyone, please find Today Stand-up MOM\n` +
        `Date: ${requestedDateStr}\n` +
        `Duration: ${duration}\n` +
        `Present Members: ${presentMembers}\n` +
        `Team-wise Task Updates`;

      let summaryText = "";

      if (!tasks.length && !issues.length) {
        summaryText = `${momHeader}\n\n• No activities recorded for date (${requestedDateStr}).`;
      } else {
        const prompt = `
You are an AI Engineering Manager writing a Stand-up Minutes of Meeting (MOM) for ${requestedDateStr}.

Format the output EXACTLY like this template (keep this exact structure and header — do not add or remove header lines):

Hi Everyone, please find Today Stand-up MOM
Date: ${requestedDateStr}
Duration: ${duration}
Present Members: ${presentMembers}
Team-wise Task Updates

**[Member Name]**
* Natural, complete-sentence bullet describing what they did, are working on, or are blocked by — written like a real human standup note, not "Task: X, Status: Y".
* Use an indented sub-bullet (two spaces then "* ") when one task has multiple distinct parts worth calling out separately.

**[Next Member Name]**
* ...

INSTRUCTIONS:
1. Group strictly by team member — one section per name listed in "Present Members" above, in that order. Wrap each member's name in ** ** exactly as shown, on its own line.
2. Write each bullet as a natural sentence, not a mechanical field dump.
3. If an item has a blocked reason, give it its OWN separate bullet line starting with "🚨" followed directly by a natural description of the blocker (e.g. "🚨 Currently blocked on the API integration, waiting on review from Aryan.") — don't mix it into another bullet's sentence, and don't add the word "Blocker" since the 🚨 already marks it.
4. Do not invent work that isn't in the data below — only phrase what's given more naturally, don't add facts.
5. Skip a member's section entirely if they have no activity today.

Data for ${requestedDateStr}:
Tasks: ${JSON.stringify(tasks.map(t => ({ member: t.assigned_to?.name || t.owner?.name || "Unassigned", title: t.title, status: t.status, priority: t.priority, blocker: t.blocked_reason })))}
Issues: ${JSON.stringify(issues.map(i => ({ member: i.assigned_to?.name || i.owner?.name || "Unassigned", title: i.title, status: i.status, priority: i.priority, blocker: i.blocked_reason })))}
`;

        summaryText = await callOpenAI([{ role: "user", content: prompt }], {
          maxTokens: 900,
          temperature: 0.3,
        });

        if (!summaryText) {
          // Deterministic fallback, grouped by member, matching the same header.
          const byMember = {};
          const pushItem = (name, line) => {
            const key = name || "Unassigned";
            if (!byMember[key]) byMember[key] = [];
            byMember[key].push(line);
          };
          for (const t of tasks) {
            const name = t.assigned_to?.name || t.owner?.name || "Unassigned";
            const status = t.status ? ` [${t.status}]` : "";
            pushItem(name, `${t.title}${status}`);
            if (t.blocked_reason) pushItem(name, `🚨 ${t.blocked_reason}`);
          }
          for (const i of issues) {
            const name = i.assigned_to?.name || i.owner?.name || "Unassigned";
            const status = i.status ? ` [${i.status}]` : "";
            pushItem(name, `${i.title}${status}`);
            if (i.blocked_reason) pushItem(name, `🚨 ${i.blocked_reason}`);
          }

          let body = "";
          for (const [name, lines] of Object.entries(byMember)) {
            body += `\n**${name}**\n`;
            for (const line of lines) body += `* ${line}\n`;
          }

          summaryText = `${momHeader}\n${body}`;
        }
      }

      // 5. Save to DB under requestedDateStr
      const updatedDoc = await DailySummary.findOneAndUpdate(
        { date: requestedDateStr },
        {
          summary: summaryText,
          tasks_count: tasks.length,
          issues_count: issues.length,
          discussions_count: 0,
          is_stale: false,
        },
        { upsert: true, returnDocument: "after" }
      );

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      return res.json({
        date: requestedDateStr,
        summary: summaryText,
        tasks_count: tasks.length,
        issues_count: issues.length,
        cached: false,
        last_updated_at: updatedDoc.updatedAt || new Date(),
      });
    } catch (err) {
      console.error("[daily-summary route error]:", err);
      res.status(500).json({ error: "Failed to generate daily summary" });
    }
  });

  // POST: Parse Raw Unstructured MOM Message using OpenAI Structured Output
  router.post("/discussions/parse-mom", async (req, res) => {
    try {
      const { rawText } = req.body;

      if (!rawText || typeof rawText !== "string") {
        return res.status(400).json({ error: "rawText parameter is required" });
      }

      const prompt = `
You are an expert AI Engineering Manager. Parse the following Stand-up MOM message into structured categories per team member.

Raw MOM Message:
"""
${rawText}
"""

Instructions:
1. Extract metadata: Date (in YYYY-MM-DD format), Duration, and Present Members array.
2. For each member under "Team-wise Task Updates", group their bullet points into:
   - "tasks": Completed, in-progress, or planned work items.
   - "issues": Bugs, data mismatches, blockers, or errors being analyzed/retested.
   - "discussions": Meetings, discussions with leads/management, or general administrative notes.
`;

      const aiResponse = await callOpenAI(
        [{ role: "user", content: prompt }],
        {
          maxTokens: 1000,
          temperature: 0.1,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "mom_parsed_structure",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  metadata: {
                    type: "object",
                    properties: {
                      date: { type: "string" },
                      duration: { type: "string" },
                      present_members: {
                        type: "array",
                        items: { type: "string" }
                      }
                    },
                    required: ["date", "duration", "present_members"],
                    additionalProperties: false
                  },
                  member_updates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        member_name: { type: "string" },
                        tasks: {
                          type: "array",
                          items: { type: "string" }
                        },
                        issues: {
                          type: "array",
                          items: { type: "string" }
                        },
                        discussions: {
                          type: "array",
                          items: { type: "string" }
                        }
                      },
                      required: ["member_name", "tasks", "issues", "discussions"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["metadata", "member_updates"],
                additionalProperties: false
              }
            }
          }
        }
      );

      const parsedData = typeof aiResponse === "string" ? JSON.parse(aiResponse) : aiResponse;

      // Construct MOM-style markdown string
      let formattedText = `Hi Everyone, please find Today Stand-up MOM\n\n`;
      formattedText += `Date: ${parsedData.metadata.date}\n`;
      formattedText += `Duration: ${parsedData.metadata.duration}\n`;
      formattedText += `Present Members: ${parsedData.metadata.present_members.join(", ")}\n`;
      formattedText += `Team-wise Task Updates\n\n`;

      parsedData.member_updates.forEach((m) => {
        formattedText += `**${m.member_name}**\n`;
        m.tasks.forEach((t) => (formattedText += `- ${t}\n`));
        m.issues.forEach((i) => (formattedText += `- 🚨 Issue: ${i}\n`));
        m.discussions.forEach((d) => (formattedText += `- 💬 Note: ${d}\n`));
        formattedText += `\n`;
      });

      // Upsert into DailySummary
      const updatedDoc = await DailySummary.findOneAndUpdate(
        { date: parsedData.metadata.date },
        {
          summary: formattedText.trim(),
          tasks_count: parsedData.member_updates.reduce((acc, m) => acc + m.tasks.length, 0),
          issues_count: parsedData.member_updates.reduce((acc, m) => acc + m.issues.length, 0),
          discussions_count: parsedData.member_updates.reduce((acc, m) => acc + m.discussions.length, 0),
          is_stale: false,
        },
        { upsert: true, returnDocument: "after" }
      );

      return res.json({
        success: true,
        metadata: parsedData.metadata,
        member_updates: parsedData.member_updates,
        formatted_summary: formattedText.trim(),
        saved_doc: updatedDoc,
      });
    } catch (err) {
      console.error("[parse-mom route error]:", err);
      res.status(500).json({ error: "Failed to parse stand-up MOM message" });
    }
  });

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "ai-engineering-manager",
      ts: new Date().toISOString(),
    });
  });

  router.get("/dashboard", async (_req, res, next) => {
    try {
      const data = await getDashboard();
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  router.post("/slack/sync", async (req, res, next) => {
    try {
      if (!messageProcessor) {
        return res.status(503).json({ error: "Message processor not ready" });
      }
      const limit = req.body?.limit_per_channel
        ? parseInt(req.body.limit_per_channel, 10)
        : undefined;
      const channelIds = Array.isArray(req.body?.channels)
        ? req.body.channels
        : undefined;
      const channelId = req.body?.channel_id || undefined;

      const result = await syncFromSlack(messageProcessor, {
        ...(limit ? { limitPerChannel: limit } : {}),
        ...(channelId ? { channelId } : {}),
      });
      res.json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code || "slack_sync_failed",
        });
      }
      next(err);
    }
  });

  router.get("/slack/channels", async (_req, res, next) => {
    try {
      const client = createSlackClient();
      const rawChannels = await listChannels(client);

      const channels = rawChannels.map((ch) => ({
        id: ch.id,
        name: `#${ch.name}`,
        members: ch.num_members || 4,
        status: "Bot in channel",
      }));

      res.json({ channels });
    } catch (err) {
      next(err);
    }
  });

  router.get("/tasks", async (req, res, next) => {
    try {
      const filter = {};

      if (req.query.status) {
        filter.status = req.query.status;
      } else {
        filter.status = {
          $nin: ["done", "completed", "Complete", "Done", "COMPLETE", "DONE"],
        };
        filter.title = { $not: /(- completed|- done| - done| - completed)$/i };
      }

      if (req.query.priority) filter.priority = req.query.priority;

      if (req.query.assignee) {
        filter.$or = [
          { "assigned_to.id": req.query.assignee },
          { "assigned_to.name": new RegExp(req.query.assignee, "i") },
        ];
      }

      const tasks = await Task.find(filter).sort({ updated_time: -1 }).lean();
      res.json(tasks);
    } catch (err) {
      next(err);
    }
  });

  router.all("/slack/standup-briefing", async (req, res) => {
    try {
      const { team, userId, hours, meetingTime } = {
        ...req.query,
        ...req.body,
      };

      const result = await sendDailyStandupBriefings({
        team,
        userId,
        lookbackHours: hours ? parseInt(hours, 10) : 24,
        meetingTime,
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get("/tasks/:id", async (req, res, next) => {
    try {
      const query = {
        $or: [
          { task_id: req.params.id },
          {
            _id: req.params.id.match(/^[0-9a-fA-F]{24}$/)
              ? req.params.id
              : null,
          },
        ],
      };
      const task = await Task.findOne(query).lean();
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/tasks/:id", async (req, res, next) => {
    try {
      const { status } = req.body;
      const allowed = [
        "title",
        "description",
        "priority",
        "status",
        "due_date",
        "blocked_reason",
        "owner",
        "assigned_to",
      ];

      const updateData = { updated_time: new Date() };
      for (const key of allowed) {
        if (req.body[key] !== undefined) updateData[key] = req.body[key];
      }

      if (updateData.due_date) {
        updateData.due_date = new Date(updateData.due_date);
        updateData.due_date_pending = false;
      }
      if (updateData.blocked_reason) {
        updateData.block_reason_pending = false;
      }

      if (status === "done" || status === "completed") {
        updateData.completed_at = new Date();
      } else if (status) {
        updateData.completed_at = null;
      }

      const query = {
        $or: [
          { task_id: req.params.id },
          {
            _id: req.params.id.match(/^[0-9a-fA-F]{24}$/)
              ? req.params.id
              : null,
          },
        ],
      };

      const updatedTask = await Task.findOneAndUpdate(query, updateData, {
        returnDocument: "after",
      });

      if (!updatedTask)
        return res.status(404).json({ error: "Task not found" });
      res.json(updatedTask);
    } catch (err) {
      next(err);
    }
  });

  router.get("/issues", async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.priority) filter.priority = req.query.priority;
      const issues = await Issue.find(filter).sort({ updated_time: -1 }).lean();
      res.json(issues);
    } catch (err) {
      next(err);
    }
  });

  router.get("/issues/:id", async (req, res, next) => {
    try {
      const issue = await Issue.findOne({ issue_id: req.params.id }).lean();
      if (!issue) return res.status(404).json({ error: "Issue not found" });
      res.json(issue);
    } catch (err) {
      next(err);
    }
  });

  router.get("/discussions", async (_req, res, next) => {
    try {
      const discussions = await Discussion.find()
        .sort({ timestamp: -1 })
        .limit(200)
        .lean();
      res.json(discussions);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/parse",
    body("text").isString().notEmpty(),
    body("sender").isObject(),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty())
          return res.status(400).json({ errors: errors.array() });

        const result = parseMessage({
          text: req.body.text,
          sender: req.body.sender,
          channel: req.body.channel || "",
          thread_id: req.body.thread_id || "",
          workspace_id: req.body.workspace_id || "",
          team: req.body.team || "",
          message_ts: req.body.message_ts || "",
          is_edit: !!req.body.is_edit,
          user_directory: req.body.user_directory || {},
          existing_task: req.body.existing_task || null,
          existing_issue: req.body.existing_issue || null,
          thread_context: req.body.thread_context || [],
        });

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/messages/process",
    body("text").isString().notEmpty(),
    body("sender").isObject(),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty())
          return res.status(400).json({ errors: errors.array() });

        if (!messageProcessor) {
          return res.status(503).json({ error: "Message processor not ready" });
        }

        const result = await messageProcessor.process({
          text: req.body.text,
          sender: req.body.sender,
          channel: req.body.channel || "api",
          thread_id: req.body.thread_id || "",
          workspace_id: req.body.workspace_id || "",
          team: req.body.team || "",
          message_ts: req.body.message_ts || `api_${Date.now()}`,
          is_edit: !!req.body.is_edit,
          user_directory: req.body.user_directory || {},
        });

        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

module.exports = { createApiRouter };