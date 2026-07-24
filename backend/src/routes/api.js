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
      const getTodayStr = () => {
        return new Date().toISOString().split("T")[0];
      };

      const requestedDateStr = req.query.date
        ? String(req.query.date).split("T")[0].trim()
        : getTodayStr();

      const forceRefresh = req.query.forceRefresh === "true";

      // 1. Instant Cache Lookup
      if (!forceRefresh) {
        const cachedDoc = await DailySummary.findOne({
          date: requestedDateStr,
        }).lean();
        if (cachedDoc && cachedDoc.summary) {
          console.log(
            `[DailySummary] ⚡ Serving cache for: ${requestedDateStr}`,
          );
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          );
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

      console.log(
        `[DailySummary] 🤖 Generating 2-section summary for (${requestedDateStr}) using OpenAI...`,
      );

      const [reqYear, reqMonth, reqDay] = requestedDateStr
        .split("-")
        .map(Number);
      if (!reqYear || !reqMonth || !reqDay) {
        return res
          .status(400)
          .json({ error: "Invalid date format. Expected YYYY-MM-DD" });
      }

      const requestedDateObj = new Date(reqYear, reqMonth - 1, reqDay);
      const yesterdayObj = new Date(requestedDateObj);
      yesterdayObj.setDate(yesterdayObj.getDate() - 1);

      const yesterdayStr = yesterdayObj.toISOString().split("T")[0];
      const [yYear, yMonth, yDay] = yesterdayStr.split("-").map(Number);

      const startOfDay = new Date(yYear, yMonth - 1, yDay, 0, 0, 0, 0);
      const endOfDay = new Date(yYear, yMonth - 1, yDay, 23, 59, 59, 999);

      // 2. Fetch Tasks and Issues strictly from yesterday
      const [tasks, issues] = await Promise.all([
        Task.find(
          {
            $or: [
              { created_time: { $gte: startOfDay, $lte: endOfDay } },
              { updated_time: { $gte: startOfDay, $lte: endOfDay } },
              { due_date: { $gte: startOfDay, $lte: endOfDay } },
            ],
          },
          "title status priority blocked_reason",
        )
          .lean()
          .catch(() => []),

        Issue.find(
          {
            $or: [
              { created_time: { $gte: startOfDay, $lte: endOfDay } },
              { updated_time: { $gte: startOfDay, $lte: endOfDay } },
            ],
          },
          "title status priority blocked_reason",
        )
          .lean()
          .catch(() => []),
      ]);

      let summaryText = "";

      if (!tasks.length && !issues.length) {
        summaryText = `📌 **Tasks Summary**\n• No tasks recorded for yesterday (${yesterdayStr}).\n\n🚨 **Issues & Bugs Summary**\n• No issues recorded for yesterday (${yesterdayStr}).`;
      } else {
        // 3. Summarize with OpenAI into 2 sections only
        const prompt = `
You are an AI Engineering Manager. Summarize the engineering activity that happened yesterday (${yesterdayStr}) into a clean, structured report.

Format each item using multiple lines strictly like this:
• **Task/Issue Title**
  - Status: [Status] | Priority: [Priority]
  - Blocker/Details: [Reason or None]

Create EXACTLY two sections and nothing else:

📌 **Tasks Summary**
(List each task with title on the first line, status/priority on the next line, and blocker on the following line)

🚨 **Issues & Bugs Summary**
(List each issue with title on the first line, status/priority on the next line)

Data from Yesterday (${yesterdayStr}):
Tasks: ${JSON.stringify(tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority, blocker: t.blocked_reason })))}
Issues: ${JSON.stringify(issues.map((i) => ({ title: i.title, status: i.status, priority: i.priority })))}
`;

        summaryText = await callOpenAI([{ role: "user", content: prompt }], {
          maxTokens: 400,
          temperature: 0.1,
        });

        if (!summaryText) {
          const taskBullets =
            tasks.length > 0
              ? tasks
                  .map(
                    (t) =>
                      `• **${t.title}** [Status: ${t.status || "TODO"} | Priority: ${t.priority || "MEDIUM"}]${t.blocked_reason ? ` - 🚨 ${t.blocked_reason}` : ""}`,
                  )
                  .join("\n")
              : "• No tasks logged yesterday.";

          const issueBullets =
            issues.length > 0
              ? issues
                  .map(
                    (i) =>
                      `• **${i.title}** [Status: ${i.status || "HOLD"} | Priority: ${i.priority || "HIGH"}]`,
                  )
                  .join("\n")
              : "• No issues logged yesterday.";

          summaryText = `📌 **Tasks Summary**\n${taskBullets}\n\n🚨 **Issues & Bugs Summary**\n${issueBullets}`;
        }
      }

      // 4. Save to DB under requested date
      const updatedDoc = await DailySummary.findOneAndUpdate(
        { date: requestedDateStr },
        {
          summary: summaryText,
          tasks_count: tasks.length,
          issues_count: issues.length,
          discussions_count: 0,
          is_stale: false,
        },
        { upsert: true, returnDocument: "after" },
      );

      // Prevent browser caching on freshly generated responses as well
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
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
    },
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
    },
  );

  return router;
}

module.exports = { createApiRouter };
