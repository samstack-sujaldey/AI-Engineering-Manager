const express = require("express");
const { body, validationResult } = require("express-validator");
const { Task, Issue, Discussion } = require("../models");
const { getDashboard } = require("../services/dashboard");
const { createSlackClient, listChannels, syncFromSlack } = require("../services/slackSync");
const { parseMessage } = require("../agent/parser");
const { callOpenRouter } = require("../ai/gemini");
const { newId } = require("../utils/helpers");
const DailySummary = require("../models/DailySummary");
const { sendDailyStandupBriefings } = require("../config/scheduler.js");

function createApiRouter({ messageProcessor }) {
  const router = express.Router();

  router.get("/discussions/daily-summary", async (req, res) => {
    try {
      const rawDate = req.query.date || new Date().toISOString().split("T")[0];
      const targetDateStr = rawDate.split("T")[0].trim();
      const forceRefresh = req.query.forceRefresh === "true";

      if (!forceRefresh) {
        const cachedDoc = await DailySummary.findOne({
          date: targetDateStr,
        }).lean();

        if (cachedDoc) {
          console.log(
            `[DailySummary] ⚡ Serving cached summary for date: ${targetDateStr}`
          );
          return res.json({
            date: targetDateStr,
            summary: cachedDoc.summary,
            tasks_count: cachedDoc.tasks_count,
            issues_count: cachedDoc.issues_count,
            discussions_count: cachedDoc.discussions_count,
            cached: true,
            last_updated_at: cachedDoc.updatedAt || cachedDoc.createdAt,
          });
        }
      }

      console.log(
        `[DailySummary] 🤖 Generating AI summary for date: ${targetDateStr} (forceRefresh=${forceRefresh})`
      );

      const [year, month, day] = targetDateStr.split("-").map(Number);
      if (!year || !month || !day) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Expected YYYY-MM-DD" });
      }

      const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

      const [tasks, issues, discussions] = await Promise.all([
        Task.find({
          $or: [
            { created_time: { $gte: startOfDay, $lte: endOfDay } },
            { updated_time: { $gte: startOfDay, $lte: endOfDay } },
            { due_date: { $gte: startOfDay, $lte: endOfDay } },
            { status: { $in: ["TODO", "PROCESSING", "BLOCKED"] } },
          ],
        })
          .lean()
          .catch(() => []),

        Issue.find({
          $or: [
            { created_time: { $gte: startOfDay, $lte: endOfDay } },
            { updated_time: { $gte: startOfDay, $lte: endOfDay } },
            { status: { $in: ["OPEN", "HOLD"] } },
          ],
        })
          .lean()
          .catch(() => []),

        Discussion.find({
          timestamp: { $gte: startOfDay, $lte: endOfDay },
          channel: { $ne: "daily-wrapup" },
        })
          .lean()
          .catch(() => []),
      ]);

      if (!tasks.length && !issues.length && !discussions.length) {
        const emptyText = `No activity recorded for ${targetDateStr}.`;
        return res.json({
          date: targetDateStr,
          summary: emptyText,
          tasks_count: 0,
          issues_count: 0,
          discussions_count: 0,
          cached: false,
        });
      }

      const ignoreList = ["go for break", "break", "test"];
      const filteredTasks = tasks.filter(
        (t) =>
          !ignoreList.some((term) =>
            (t.title || "").toLowerCase().includes(term)
          )
      );

      const uniqueTasks = Object.values(
        filteredTasks.reduce((acc, t) => {
          const key = (t.title || "").toLowerCase().trim();
          if (!acc[key]) {
            acc[key] = {
              title: t.title,
              status: t.status,
              assignees: new Set(),
            };
          }
          const assignee = t.assigned_to?.name || t.owner?.name;
          if (assignee && assignee !== "Unassigned")
            acc[key].assignees.add(assignee);
          return acc;
        }, {})
      ).map((t) => ({
        title: t.title,
        status: t.status,
        assignees: Array.from(t.assignees).join(", ") || "Unassigned",
      }));

      const prompt = `
Generate a 3-section engineering stand-up summary for ${targetDateStr}:

1. 📌 **Tasks Activity**
2. 🐞 **Issues & Bugs**
3. 💬 **General Discussions**

Data:
Tasks: ${JSON.stringify(uniqueTasks)}
Issues: ${JSON.stringify(issues.map((i) => ({ title: i.title, priority: i.priority, status: i.status })))}
Discussions: ${JSON.stringify(discussions.map((d) => ({ author: d.author?.name || d.sender?.name, text: d.content || d.text })))}
`;

      let summaryText = await callOpenRouter(
        [{ role: "user", content: prompt }],
        { maxTokens: 350, temperature: 0.1 }
      );

      if (!summaryText) {
        const taskLines = uniqueTasks
          .map((t) => `- **${t.title}** (${t.status})`)
          .join("\n");
        const issueLines = issues
          .map((i) => `- **${i.title}** (${i.status})`)
          .join("\n");
        summaryText = `📌 **Tasks Activity**\n${taskLines || "- None"}\n\n🐞 **Issues & Bugs**\n${issueLines || "- None"}\n\n💬 **General Discussions**\n- ${discussions.length} messages.`;
      }

      const updatedDoc = await DailySummary.findOneAndUpdate(
        { date: targetDateStr },
        {
          summary: summaryText,
          tasks_count: tasks.length,
          issues_count: issues.length,
          discussions_count: discussions.length,
          is_stale: false,
        },
        { upsert: true, returnDocument: 'after' }
      );

      return res.json({
        date: targetDateStr,
        summary: summaryText,
        tasks_count: tasks.length,
        issues_count: issues.length,
        discussions_count: discussions.length,
        cached: false,
        last_updated_at: updatedDoc.updatedAt,
      });
    } catch (err) {
      console.error("[daily-summary route error]:", err);
      res.status(500).json({ error: "Failed to fetch stand-up summary" });
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
      const { team, userId, hours, meetingTime } = { ...req.query, ...req.body };

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
          { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null },
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
          { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null },
        ],
      };

      const updatedTask = await Task.findOneAndUpdate(query, updateData, {
        returnDocument: 'after',
      });

      if (!updatedTask) return res.status(404).json({ error: "Task not found" });
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
