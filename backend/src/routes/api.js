const express = require("express");
const { body, validationResult } = require("express-validator");
const { Task, Issue, Discussion, Team } = require("../models");
const { getDashboard, getDashboardForDate } = require("../services/dashboard");
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
  // Replace GET /discussions/daily-summary in routes/api.js with this:

  /**
 * 🟢 Protects routes requiring the message processor from undefined crashes
 */
function ensureMessageProcessorReady(processor, res) {
  if (!processor || typeof processor.process !== "function") {
    res.status(503).json({ error: "Message processor is not ready or uninitialized." });
    return false;
  }
  return true;
}

  router.get("/discussions/daily-summary", async (req, res) => {
    try {
      const { getTargetSummaryDate } = require("../jobs/standupScheduler");

      // 1. Receive the raw date passed from frontend (or default to today's raw date)
      const rawDateStr = req.query.date
        ? String(req.query.date).split("T")[0].trim()
        : new Date().toISOString().split("T")[0];

      // 2. Convert the raw date to the target business date (Yesterday / Friday on Mondays)
      const rawDateObj = new Date(rawDateStr);
      const targetBusinessDateStr = getTargetSummaryDate(rawDateObj);

      const channel = req.query.channel
        ? String(req.query.channel).trim()
        : null;

      // 3. Query MongoDB for the converted target business date
      const cacheKey = channel
        ? { date: targetBusinessDateStr, channel: channel }
        : {
            date: targetBusinessDateStr,
            $or: [{ channel: null }, { channel: "" }],
          };

      const cachedDoc = await DailySummary.findOne(cacheKey).lean();

      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      if (cachedDoc && cachedDoc.summary) {
        return res.json({
          raw_date: rawDateStr,
          date: targetBusinessDateStr,
          channel: channel || null,
          summary: cachedDoc.summary,
          tasks_count: cachedDoc.tasks_count || 0,
          issues_count: cachedDoc.issues_count || 0,
          cached: true,
          last_updated_at: cachedDoc.updatedAt || cachedDoc.createdAt,
        });
      }

      // 4. Return fallback if no pre-cached document exists for that business date
      return res.json({
        raw_date: rawDateStr,
        date: targetBusinessDateStr,
        channel: channel || null,
        summary: `Hi Everyone, please find Today Stand-up MOM\n\nDate: ${targetBusinessDateStr}\nSummary for ${targetBusinessDateStr} is not cached.`,
        tasks_count: 0,
        issues_count: 0,
        cached: false,
        last_updated_at: new Date(),
      });
    } catch (err) {
      console.error("[daily-summary route error]:", err);
      res.status(500).json({ error: "Failed to fetch daily summary cache" });
    }
  });

  // POST: Parse Raw Unstructured MOM Message using OpenAI Structured Output
  // POST: Parse Raw Unstructured MOM Message / Document and Auto-Assign Items by First Name
  router.post("/discussions/parse-mom", async (req, res) => {
    try {
      if (!ensureMessageProcessorReady(messageProcessor, res)) return;
      const { rawText, channel, workspace_id, user_directory, team } = req.body;

      if (!rawText || typeof rawText !== "string") {
        return res.status(400).json({ error: "rawText parameter is required" });
      }

      const { processMOMAndAssignWork } = require("../services/momParser");

      // Process MOM: Matches first names against Slack usernames & saves tasks in DB
      const result = await processMOMAndAssignWork({
        rawText,
        channel: channel || "",
        workspace_id: workspace_id || "",
        team: team || channel || "",
        message_ts: `mom_${Date.now()}`,
        user_directory: user_directory || {},
        messageProcessor,
      });

      return res.json({
        success: true,
        metadata: result.metadata,
        created: result.created,
      });
    } catch (err) {
      console.error("[parse-mom route error]:", err);
      res
        .status(500)
        .json({ error: "Failed to parse and assign stand-up MOM message" });
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

  router.get("/dashboard/for-date", async (req, res, next) => {
    try {
      const date = req.query.date || null;
      const channel = req.query.channel || null;
      const data = await getDashboardForDate(date, channel);
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

      const teams = await Team.find(filter).sort({ updated_time: -1 }).lean();
      res.json(teams);
    } catch (err) {
      next(err);
    }
  });

  router.get("/teams/channel/:channelId", async (req, res, next) => {
    try {
      const team = await Team.findOne({
        channel_id: req.params.channelId,
      }).lean();
      if (!team)
        return res.status(404).json({ error: "Team not found for channel" });
      res.json(team);
    } catch (err) {
      next(err);
    }
  });

  router.get("/teams/workload", async (req, res, next) => {
    try {
      const channelId = req.query.channelId;
      const dateStr = req.query.date || null;
      const taskFilter = {};
      const issueFilter = {};

      if (channelId) {
        taskFilter.channel = channelId;
        issueFilter.channel = channelId;
      }

      if (dateStr) {
        const [year, month, day] = String(dateStr).split("-").map(Number);
        if (year && month && day) {
          const start = new Date(year, month - 1, day, 0, 0, 0, 0);
          const end = new Date(year, month - 1, day, 23, 59, 59, 999);
          taskFilter.$or = [
            { created_time: { $gte: start, $lte: end } },
            { updated_time: { $gte: start, $lte: end } },
            { due_date: { $gte: start, $lte: end } },
          ];
          issueFilter.$or = [
            { created_time: { $gte: start, $lte: end } },
            { updated_time: { $gte: start, $lte: end } },
          ];
        }
      }

      const [tasks, issues] = await Promise.all([
        Task.find(taskFilter).lean(),
        Issue.find(issueFilter).lean(),
      ]);

      const memberMap = new Map();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const getName = (item) => {
        const name =
          item.assigned_to?.name ||
          item.assigned_to ||
          item.owner?.name ||
          item.owner;
        if (!name || name === "Unassigned") return null;
        return typeof name === "string"
          ? name
          : name.name || name.display_name || "Unknown";
      };

      const isToday = (date) => {
        if (!date) return false;
        const d = new Date(date);
        return d >= today;
      };

      for (const task of tasks) {
        const name = getName(task);
        if (!name) continue;

        const status = (task.status || "").toLowerCase();
        const isBlocked =
          status === "blocked" ||
          task.blocked_reason ||
          task.block_reason_pending;
        const isDone = status === "completed" || status === "done";
        const isCurrent = !isBlocked && !isDone;

        if (!memberMap.has(name)) {
          memberMap.set(name, { name, current: 0, blocked: 0, doneToday: 0 });
        }
        const member = memberMap.get(name);

        if (isBlocked) member.blocked++;
        else if (isDone) {
          if (
            isToday(task.updated_time || task.updatedAt || task.created_time)
          ) {
            member.doneToday++;
          }
        } else if (isCurrent) member.current++;
      }

      for (const issue of issues) {
        const name = getName(issue);
        if (!name) continue;

        const status = (issue.status || "").toLowerCase();
        const isBlocked =
          status === "hold" ||
          issue.blocked_reason ||
          issue.block_reason_pending;
        const isResolved = status === "resolved";
        const isCurrent = !isBlocked && !isResolved;

        if (!memberMap.has(name)) {
          memberMap.set(name, { name, current: 0, blocked: 0, doneToday: 0 });
        }
        const member = memberMap.get(name);

        if (isBlocked) member.blocked++;
        else if (isResolved) {
          if (
            isToday(issue.updated_time || issue.updatedAt || issue.created_time)
          ) {
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
