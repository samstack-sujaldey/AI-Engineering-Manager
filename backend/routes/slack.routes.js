import express from 'express';
import {
  installSlack,
  slackOAuthCallback,
  getChannels,
  getChannelMessages,
  joinChannel,
} from '../controllers/slack.controller.js';
import { processSlackData, saveParsedTasksToDatabase, runFullPipeline } from '../services/slack.service.js';
import { parseStandupMessage } from '../services/parserService.js';

const router = express.Router();

// ─── OAuth ────────────────────────────────────────────
router.get('/install', installSlack);
router.get('/oauth/callback', slackOAuthCallback);

// ─── Channel Management ───────────────────────────────
router.get('/channels', getChannels);
router.get('/channels/:channelId/messages', getChannelMessages);
router.post('/channels/:channelId/join', joinChannel);

// ─── Full Pipeline Trigger ────────────────────────────
/**
 * POST /api/slack/channels/:channelId/process
 *
 * MAIN ENDPOINT — end-to-end pipeline. Safe to call repeatedly: messages
 * already ingested and parsed in a previous call are skipped, not duplicated.
 *
 * Query params:
 *   ?limit=50   (number of messages to fetch, clamped to 1–200)
 */
router.post('/channels/:channelId/process', async (req, res) => {
  try {
    const { channelId } = req.params;

    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required.' });
    }

    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

    console.log(`📥 Fetching up to ${limit} messages from channel ${channelId}...`);
    const result = await runFullPipeline(channelId, limit);

    res.status(200).json(result);
  } catch (error) {
     console.error('❌ FULL PIPELINE ERROR:', error);
    console.error('❌ ERROR MESSAGE:', error.message);
    console.error('❌ ERROR STACK:', error.stack);
    console.error('❌ ERROR DATA:', error.data);

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.data?.error || null,
    });
  }
});

// ─── Webhook (for Slack Event Subscriptions) ──────────
/**
 * POST /api/slack/webhook
 *
 * Body must have: { channel: { channelId, channelName }, messages: [...] }
 * Runs the same idempotent ingestion as /process, so re-delivered webhook
 * events (Slack retries these) won't create duplicates either.
 */
router.post('/webhook', async (req, res) => {
  try {
    if (req.body.type === 'url_verification') {
      return res.status(200).json({ challenge: req.body.challenge });
    }

    const { channel, messages } = req.body;

    if (!channel?.channelId || !messages) {
      return res.status(400).json({
        error: 'Request body must include "channel.channelId" and "messages" fields.',
      });
    }

    const ingestResult = await processSlackData({ channel, messages });

    if (!ingestResult.aiReadyText) {
      return res.status(200).json({
        message:
          ingestResult.alreadyParsedCount > 0
            ? 'Already processed — nothing new.'
            : 'No parseable messages found.',
        ...ingestResult,
        tasks: [],
      });
    }

    const parsedTasks = await parseStandupMessage(ingestResult.aiReadyText);
    const savedTasks = await saveParsedTasksToDatabase(parsedTasks);

    res.status(200).json({
      message: 'Webhook processed successfully.',
      ...ingestResult,
      savedTaskCount: savedTasks.length,
      tasks: savedTasks,
    });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
