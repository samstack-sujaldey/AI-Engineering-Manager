const express = require('express');
const { body, validationResult } = require('express-validator');
const { Task, Issue, Discussion } = require('../models');
const { getDashboard } = require('../services/dashboard');
const { syncFromSlack } = require('../services/slackSync');
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
      const channelIds = Array.isArray(req.body?.channels) ? req.body.channels : undefined;
      const channelNames = Array.isArray(req.body?.channelNames)
        ? req.body.channelNames
        : undefined;
      const result = await syncFromSlack(messageProcessor, {
        ...(limit ? { limitPerChannel: limit } : {}),
        ...(channelIds ? { channelIds } : {}),
        ...(channelNames ? { channelNames } : {}),
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

  router.get('/tasks', async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
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

  router.get('/tasks/:id', async (req, res, next) => {
    try {
      const task = await Task.findOne({ task_id: req.params.id }).lean();
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json(task);
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
      if ($set.status === 'COMPLETED') $set.completed_at = new Date();
      if ($set.status && $set.status !== 'COMPLETED') $set.completed_at = null;

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
