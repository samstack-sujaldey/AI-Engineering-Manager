const express = require("express");
const { body, validationResult } = require("express-validator");
const { Task, Issue, Discussion, Team } = require("../models");
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

  // GET: Daily Summary formatted strictly as MOM (with Channel Filtering Support)
router.get("/discussions/daily-summary", async (req, res) => {
  try {
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

    // 🟢 Convert "2026-07-26" to "26.07.26" for the MOM Header
    const [reqYear, reqMonth, reqDay] = requestedDateStr.split("-").map(Number);
    if (!reqYear || !reqMonth || !reqDay) {
      return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
    }
    const displayDateStr = `${String(reqDay).padStart(2, "0")}.${String(reqMonth).padStart(2, "0")}.${String(reqYear).slice(2)}`;

    const forceRefresh = req.query.forceRefresh === "true";
    const channel = req.query.channel || null;
    const cacheKey = channel ? { date: requestedDateStr, channel } : { date: requestedDateStr };

    // 1. Cache Lookup (With format validation bypass)
    if (!forceRefresh) {
      const cachedDoc = await DailySummary.findOne(cacheKey).lean();
      
      // Ensure the cache doesn't serve old Markdown-heavy formats
      const isCorrectFormat = cachedDoc?.summary?.includes("Hi Everyone, please find Today Stand-up MOM\n\nDate:");

      if (cachedDoc && cachedDoc.summary && isCorrectFormat) {
        console.log(`[DailySummary] ⚡ Serving cache for: ${requestedDateStr}${channel ? ` (${channel})` : ''}`);
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        return res.json({
          date: requestedDateStr,
          channel: channel || null,
          summary: cachedDoc.summary,
          tasks_count: cachedDoc.tasks_count || 0,
          issues_count: cachedDoc.issues_count || 0,
          cached: true,
          last_updated_at: cachedDoc.updatedAt || cachedDoc.createdAt,
        });
      }
    }

    console.log(`[DailySummary] 🤖 Generating MOM summary for (${requestedDateStr})${channel ? ` (${channel})` : ''}...`);

    const startOfDay = new Date(reqYear, reqMonth - 1, reqDay, 0, 0, 0, 0);
    const endOfDay = new Date(reqYear, reqMonth - 1, reqDay, 23, 59, 59, 999);

    // 2. Construct Channel Filters
    const dateRangeQuery = { $gte: startOfDay, $lte: endOfDay };
    const taskBaseFilter = {
      $or: [
        { createdAt: dateRangeQuery },
        { updatedAt: dateRangeQuery },
        { created_time: dateRangeQuery },
        { updated_time: dateRangeQuery },
        { due_date: dateRangeQuery },
      ],
    };
    const issueBaseFilter = {
      $or: [
        { createdAt: dateRangeQuery },
        { updatedAt: dateRangeQuery },
        { created_time: dateRangeQuery },
        { updated_time: dateRangeQuery },
      ],
    };

    if (channel) {
      taskBaseFilter.channel = channel;
      issueBaseFilter.channel = channel;
    }

    const [tasks, issues] = await Promise.all([
      Task.find(taskBaseFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
      Issue.find(issueBaseFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
    ]);

    // 3. Calculate Present Members
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
    
    const presentMembers = memberNames.length > 0 ? memberNames.join(", ") : "—";
    const duration = process.env.STANDUP_DURATION || "15 Minutes";

    // 🟢 Exact Header Formatting
    const momHeader = 
`Hi Everyone, please find Today Stand-up MOM

Date: ${displayDateStr}
Duration: ${duration}
Present Members: ${presentMembers}
Team-wise Task Updates`;

    let summaryText = "";

    if (!tasks.length && !issues.length) {
      summaryText = `${momHeader}\nNo activities recorded for date (${displayDateStr}).`;
    } else {
      // 🟢 Strict prompt with NO Markdown and NO Bullet symbols
      const prompt = `You are an AI generating a Daily Stand-up MOM.

Format the output EXACTLY like this template. Do NOT use markdown bolding (**). Do NOT use bullet points (•, -, or *). Just write plain text on new lines.

Hi Everyone, please find Today Stand-up MOM

Date: ${displayDateStr}
Duration: ${duration}
Present Members: ${presentMembers}
Team-wise Task Updates
[Member Name]
Natural complete-sentence describing what they worked on or completed.
Another complete-sentence describing another task.
[Next Member Name]
...

INSTRUCTIONS:
1. Start EXACTLY with the header block provided above.
2. Under "Team-wise Task Updates", write the member's name on its own line (NO bolding, NO symbols).
3. Directly beneath the member's name, write their tasks as plain text sentences on new lines. Do not use bullets or dashes.
4. If an item has a blocker, write a sentence explaining the blocker on a new line.
5. Do not invent work that isn't in the data below.

Data for ${requestedDateStr}:
Tasks: ${JSON.stringify(tasks.map(t => ({ member: t.assigned_to?.name || t.owner?.name || "Unassigned", title: t.title, status: t.status, priority: t.priority, blocker: t.blocked_reason })))}
Issues: ${JSON.stringify(issues.map(i => ({ member: i.assigned_to?.name || i.owner?.name || "Unassigned", title: i.title, status: i.status, priority: i.priority, blocker: i.blocked_reason })))}`;

      summaryText = await callOpenAI([{ role: "user", content: prompt }], {
        maxTokens: 900,
        temperature: 0.2, // Lowered temperature to enforce strict formatting
      });

      // 🟢 NO FALLBACK. If AI fails to return text, throw an error to prevent saving bad cache.
      if (!summaryText || !summaryText.trim()) {
        throw new Error("AI failed to generate a valid stand-up summary from the provided data.");
      }
    }

    // 4. Save to DB under cacheKey
    const updatedDoc = await DailySummary.findOneAndUpdate(
      cacheKey,
      {
        summary: summaryText.trim(),
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
      channel: channel || null,
      summary: summaryText.trim(),
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

  router.get("/dashboard", async (req, res, next) => {
    try {
      const channel = req.query.channel || null;
      const data = await getDashboard(channel);
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

      if (req.query.channel) {
        filter.channel = req.query.channel;
      }

      if (req.query.date) {
        const [year, month, day] = String(req.query.date)
          .split("-")
          .map(Number);
        if (year && month && day) {
          const start = new Date(year, month - 1, day, 0, 0, 0, 0);
          const end = new Date(year, month - 1, day, 23, 59, 59, 999);
          filter.$or = [
            { created_time: { $gte: start, $lte: end } },
            { updated_time: { $gte: start, $lte: end } },
            { due_date: { $gte: start, $lte: end } },
          ];
        }
      }

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
      if (req.query.channel) filter.channel = req.query.channel;

      if (req.query.date) {
        const [year, month, day] = String(req.query.date)
          .split("-")
          .map(Number);
        if (year && month && day) {
          const start = new Date(year, month - 1, day, 0, 0, 0, 0);
          const end = new Date(year, month - 1, day, 23, 59, 59, 999);
          filter.$or = [
            { created_time: { $gte: start, $lte: end } },
            { updated_time: { $gte: start, $lte: end } },
          ];
        }
      }

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

  router.get("/discussions", async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.channel) filter.channel = req.query.channel;

      const discussions = await Discussion.find(filter)
        .sort({ timestamp: -1 })
        .limit(200)
        .lean();
      res.json(discussions);
    } catch (err) {
      next(err);
    }
  });

  router.get("/teams", async (req, res, next) => {
    try {
      const channelId = req.query.channelId;
      const filter = {};
      if (channelId) filter.channel_id = channelId;

      const teams = await Team.find(filter)
        .sort({ updated_time: -1 })
        .lean();
      res.json(teams);
    } catch (err) {
      next(err);
    }
  });

  router.get("/teams/channel/:channelId", async (req, res, next) => {
    try {
      const team = await Team.findOne({ channel_id: req.params.channelId }).lean();
      if (!team) return res.status(404).json({ error: "Team not found for channel" });
      res.json(team);
    } catch (err) {
      next(err);
    }
  });

  router.get("/teams/workload", async (req, res, next) => {
    try {
      const channelId = req.query.channelId;
      const taskFilter = {};
      const issueFilter = {};

      if (channelId) {
        taskFilter.channel = channelId;
        issueFilter.channel = channelId;
      }

      const [tasks, issues] = await Promise.all([
        Task.find(taskFilter).lean(),
        Issue.find(issueFilter).lean(),
      ]);

      const memberMap = new Map();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const getName = (item) => {
        const name = item.assigned_to?.name || item.assigned_to || item.owner?.name || item.owner;
        if (!name || name === 'Unassigned') return null;
        return typeof name === 'string' ? name : (name.name || name.display_name || 'Unknown');
      };

      const isToday = (date) => {
        if (!date) return false;
        const d = new Date(date);
        return d >= today;
      };

      for (const task of tasks) {
        const name = getName(task);
        if (!name) continue;

        const status = (task.status || '').toLowerCase();
        const isBlocked = status === 'blocked' || task.blocked_reason || task.block_reason_pending;
        const isDone = status === 'completed' || status === 'done';
        const isCurrent = !isBlocked && !isDone;

        if (!memberMap.has(name)) {
          memberMap.set(name, { name, current: 0, blocked: 0, doneToday: 0 });
        }
        const member = memberMap.get(name);

        if (isBlocked) member.blocked++;
        else if (isDone) {
          if (isToday(task.updated_time || task.updatedAt || task.created_time)) {
            member.doneToday++;
          }
        } else if (isCurrent) member.current++;
      }

      for (const issue of issues) {
        const name = getName(issue);
        if (!name) continue;

        const status = (issue.status || '').toLowerCase();
        const isBlocked = status === 'hold' || issue.blocked_reason || issue.block_reason_pending;
        const isResolved = status === 'resolved';
        const isCurrent = !isBlocked && !isResolved;

        if (!memberMap.has(name)) {
          memberMap.set(name, { name, current: 0, blocked: 0, doneToday: 0 });
        }
        const member = memberMap.get(name);

        if (isBlocked) member.blocked++;
        else if (isResolved) {
          if (isToday(issue.updated_time || issue.updatedAt || issue.created_time)) {
            member.doneToday++;
          }
        } else if (isCurrent) member.current++;
      }

      res.json(Array.from(memberMap.values()));
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