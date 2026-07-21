const express = require('express');
const { body, validationResult } = require('express-validator');
const { Task, Issue, Discussion } = require('../models');
const { getDashboard } = require('../services/dashboard');
const { createSlackClient, listChannels, syncFromSlack } = require('../services/slackSync');
const { parseMessage } = require('../agent/parser');

function createApiRouter({ messageProcessor }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ai-engineering-manager', ts: new Date().toISOString() });
  });

  router.get('/dashboard', async (_req, res, next) => {
    try {
      const data = await getDashboard();
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Pull recent Slack channel history, process messages, return fresh dashboard payload.
   */
  router.post('/slack/sync', async (req, res, next) => {
    try {
      if (!messageProcessor) {
        return res.status(503).json({ error: 'Message processor not ready' });
      }
      const limit = req.body?.limit_per_channel
        ? parseInt(req.body.limit_per_channel, 10)
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
          code: err.code || 'slack_sync_failed',
        });
      }
      next(err);
    }
  });

  router.get('/slack/channels', async (_req, res, next) => {
    try {
      const client = createSlackClient();
      const rawChannels = await listChannels(client);

      const channels = rawChannels.map((ch) => ({
        id: ch.id,
        name: `#${ch.name}`,
        members: ch.num_members || 4,
        status: 'Bot in channel',
      }));

      res.json({ channels });
    } catch (err) {
      next(err);
    }
  });

  router.get('/tasks', async (req, res, next) => {
    try {
      const filter = {};

      // Handle status filter: if user explicitly requests a status, use it; 
      // otherwise, exclude completed/done tasks by default.
      if (req.query.status) {
        filter.status = req.query.status;
      } else {
        filter.status = { $nin: ['done', 'completed', 'Complete', 'Done', 'COMPLETE', 'DONE'] };
        
        // Also exclude tasks where the title explicitly ends with or indicates completion
        filter.title = { $not: /(- completed|- done| - done| - completed)$/i };
      }

      if (req.query.priority) filter.priority = req.query.priority;
      
      if (req.query.assignee) {
        filter.$or = [
          { 'assigned_to.id': req.query.assignee },
          { 'assigned_to.name': new RegExp(req.query.assignee, 'i') },
        ];
      }

      const tasks = await Task.find(filter).sort({ updated_time: -1 }).lean();
      res.json(tasks);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/tasks/:id', async (req, res, next) => {
    try {
      const { status } = req.body;
      let updateData = { ...req.body, updated_time: new Date() };

      // Check if status is completed to trigger the 1-month (30 days) expiration countdown
      if (status === 'done' || status === 'completed') {
        updateData.completed_at = new Date();
      } else if (status) {
        updateData.completed_at = null; // Clear if reactivated or changed to active state
      }

      // Query supporting both custom task_id and MongoDB default _id
      const query = {
        $or: [
          { task_id: req.params.id },
          { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null }
        ]
      };

      const updatedTask = await Task.findOneAndUpdate(query, updateData, { new: true });

      if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
      res.json(updatedTask);
    } catch (err) {
      next(err);
    }
  });

  router.get('/issues', async (req, res, next) => {
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

  router.get('/issues/:id', async (req, res, next) => {
    try {
      const issue = await Issue.findOne({ issue_id: req.params.id }).lean();
      if (!issue) return res.status(404).json({ error: 'Issue not found' });
      res.json(issue);
    } catch (err) {
      next(err);
    }
  });

  router.get('/discussions', async (_req, res, next) => {
    try {
      const discussions = await Discussion.find().sort({ timestamp: -1 }).limit(200).lean();
      res.json(discussions);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Stateless parse endpoint — returns structured JSON without persistence.
   */
  router.post(
    '/parse',
    body('text').isString().notEmpty(),
    body('sender').isObject(),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const result = parseMessage({
          text: req.body.text,
          sender: req.body.sender,
          channel: req.body.channel || '',
          thread_id: req.body.thread_id || '',
          workspace_id: req.body.workspace_id || '',
          team: req.body.team || '',
          message_ts: req.body.message_ts || '',
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

  /**
   * Full process endpoint — parse + persist + notifications.
   */
  router.post(
    '/messages/process',
    body('text').isString().notEmpty(),
    body('sender').isObject(),
    async (req, res, next) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        if (!messageProcessor) {
          return res.status(503).json({ error: 'Message processor not ready' });
        }

        const result = await messageProcessor.process({
          text: req.body.text,
          sender: req.body.sender,
          channel: req.body.channel || 'api',
          thread_id: req.body.thread_id || '',
          workspace_id: req.body.workspace_id || '',
          team: req.body.team || '',
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

  router.patch('/tasks/:id', async (req, res, next) => {
    try {
      const allowed = [
        'title',
        'description',
        'priority',
        'status',
        'due_date',
        'blocked_reason',
        'owner',
        'assigned_to',
      ];
      const $set = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) $set[key] = req.body[key];
      }
      if ($set.due_date) {
        $set.due_date = new Date($set.due_date);
        $set.due_date_pending = false;
      }
      if ($set.blocked_reason) $set.block_reason_pending = false;

      const task = await Task.findOneAndUpdate(
        { task_id: req.params.id },
        { $set },
        { new: true }
      );
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createApiRouter };
