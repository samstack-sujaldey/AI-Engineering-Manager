const { WebClient } = require('@slack/web-api');
const config = require('../config');
const { toUser } = require('../agent/parser');
const { findWorkByMessageTs } = require('./similarity');
const { Discussion } = require('../models');
const { getDashboard } = require('./dashboard');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

function looksLikePlaceholder(value, prefixes = []) {
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.includes('your-') || lower.includes('change-me') || lower.includes('placeholder')) {
    return true;
  }
  return prefixes.length > 0 && !prefixes.some((p) => value.startsWith(p));
}

function createSlackClient() {
  const token = config.slack.botToken;
  if (!token || looksLikePlaceholder(token, ['xoxb-'])) {
    const err = new Error(
      'Slack is not configured. Set a real SLACK_BOT_TOKEN (xoxb-…) in backend/.env and save the file.'
    );
    err.status = 503;
    err.code = 'slack_not_configured';
    throw err;
  }
  return new WebClient(token);
}

async function resolveUser(client, userId, cache) {
  if (!userId) return toUser({ id: '', name: 'unknown' });
  if (cache.has(userId)) return cache.get(userId);
  try {
    const info = await client.users.info({ user: userId });
    const u = info.user || {};
    const user = toUser({
      id: u.id,
      name: u.name,
      display_name: u.profile?.display_name || u.real_name || u.name,
      email: u.profile?.email || '',
      real_name: u.real_name,
    });
    cache.set(userId, user);
    return user;
  } catch {
    const fallback = toUser({ id: userId, name: userId, display_name: userId });
    cache.set(userId, fallback);
    return fallback;
  }
}

async function buildDirectory(client, text, cache) {
  const ids = [...(text || '').matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
  const directory = {};
  await Promise.all(
    ids.map(async (id) => {
      const user = await resolveUser(client, id, cache);
      directory[id] = user;
    })
  );
  return directory;
}

async function alreadyProcessed(messageTs) {
  const { task, issue } = await findWorkByMessageTs(messageTs, channel?.id || channel);
  if (task || issue) return { skipped: true, type: task ? 'TASK_MATCH' : 'ISSUE_MATCH' };
  
  const discussion = await Discussion.findOne({ slack_message_ts: messageTs }).lean();
  if (discussion) return { skipped: true, type: 'DISCUSSION_MATCH' };
  
  return { skipped: false };
}

async function listChannels(client, { channelIds = [] } = {}) {
  if (channelIds.length) {
    return channelIds.map((id) => ({ id }));
  }

  const channels = [];
  let cursor;
  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const ch of result.channels || []) {
      if (ch.is_member) channels.push(ch);
    }
    cursor = result.response_metadata?.next_cursor || '';
  } while (cursor);

  return channels;
}

async function fetchChannelHistory(client, channelId, limit) {
  const messages = [];
  let cursor;
  let remaining = limit;
  do {
    const batch = Math.min(200, remaining);
    const result = await client.conversations.history({
      channel: channelId,
      limit: batch,
      cursor,
    });
    messages.push(...(result.messages || []));
    remaining -= (result.messages || []).length;
    cursor = result.has_more ? result.response_metadata?.next_cursor || '' : '';
  } while (cursor && remaining > 0);

  return messages.reverse();
}

/**
 * Downloads Slack attachments and guarantees the destination temp folder exists in root.
 */
async function downloadSlackAttachments(attachments = [], token) {
  if (!attachments || attachments.length === 0) return [];

  // 1. Ensure temp directory exists at project root
  const tempDir = path.join(process.cwd(), 'temp');
  try {
    await fs.mkdir(tempDir, { recursive: true });
  } catch (mkdirErr) {
    console.error(`[attachments] Failed to create temp folder:`, mkdirErr.message);
  }

  const downloadedFiles = [];

  for (const file of attachments) {
    const downloadUrl = file.urlPrivateDownload || file.urlPrivate;
    if (!downloadUrl) continue;

    const ext = path.extname(file.fileName || '') || '.bin';
    const localFileName = `${file.slackFileId || Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const localPath = path.join(tempDir, localFileName);

    try {
      const response = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
      });

      await fs.writeFile(localPath, response.data);

      downloadedFiles.push({
        ...file,
        localPath,
        size: response.data.length,
      });
      console.log(`[attachments] Downloaded file: ${file.fileName} -> ${localPath}`);
    } catch (err) {
      console.error(`[attachments] Failed to download file ${file.fileName}:`, err.message);
    }
  }

  return downloadedFiles;
}

/**
 * Pull recent Slack channel messages into the message processor, then return dashboard data.
 */
async function syncFromSlack(messageProcessor, options = {}) {
  const {
    limitPerChannel = parseInt(process.env.SLACK_SYNC_LIMIT || '50', 10),
    channelId = null,
    channelIds = (process.env.SLACK_SYNC_CHANNELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  } = options;

  const client = createSlackClient();

  let auth;
  try {
    auth = await client.auth.test();
  } catch (err) {
    const slackErr = err?.data?.error || err.message;
    const error = new Error(
      slackErr === 'invalid_auth'
        ? 'Slack rejected the bot token (invalid_auth). Reinstall the app and update SLACK_BOT_TOKEN.'
        : `Slack auth failed: ${slackErr}`
    );
    error.status = 401;
    error.code = slackErr;
    throw error;
  }

  const downloadToken = config.slack.botToken;
  let channels = await listChannels(client, { channelIds });
  if (channelId) {
    channels = channels.filter((ch) => ch.id === channelId);
  }

  const userCache = new Map();
  const summary = {
    workspace: auth.team || '',
    bot_user: auth.user || '',
    channels_scanned: 0,
    messages_seen: 0,
    messages_processed: 0,
    messages_skipped: 0,
    created: { tasks: 0, issues: 0, discussions: 0 },
    errors: [],
  };

  for (const channel of channels) {
    summary.channels_scanned += 1;
    let history;
    try {
      history = await fetchChannelHistory(client, channel.id, limitPerChannel);
    } catch (err) {
      summary.errors.push({
        channel: channel.id,
        error: err?.data?.error || err.message,
      });
      continue;
    }

    for (const msg of history) {
      summary.messages_seen += 1;
      
      const hasFiles = msg.files && msg.files.length > 0;
      const safeText = msg.text || "";

      if ((!safeText && !hasFiles) || msg.bot_id || msg.subtype === 'bot_message') {
        summary.messages_skipped += 1;
        continue;
      }
      if (msg.subtype && msg.subtype !== 'file_share') {
        summary.messages_skipped += 1;
        continue;
      }

      const checkDuplicate = await alreadyProcessed(msg.ts);
      if (checkDuplicate.skipped) {
        summary.messages_skipped += 1;
        continue;
      }

      let downloadedFiles = [];
      if (hasFiles) {
        const rawAttachments = msg.files.map((f) => ({
          slackFileId: f.id,
          fileName: f.name,
          mimeType: f.mimetype,
          fileType: f.filetype,
          urlPrivateDownload: f.url_private_download,
          urlPrivate: f.url_private,
        }));
        downloadedFiles = await downloadSlackAttachments(rawAttachments, downloadToken);
      }

      try {
        const sender = await resolveUser(client, msg.user, userCache);
        const threadContext = [];
        if (msg.thread_ts && msg.thread_ts !== msg.ts) {
          try {
            const replies = await client.conversations.replies({
              channel: channel.id,
              ts: msg.thread_ts,
              limit: 10,
            });
            threadContext.push(...(replies.messages || []));
          } catch {}
        }

        const directory = await buildDirectory(client, safeText, userCache);

        const processed = await messageProcessor.process(
          {
            text: safeText,
            sender,
            channel: channel.name || channel.id,
            thread_id: msg.thread_ts || '',
            workspace_id: auth.team_id || '',
            team: auth.team || '',
            message_ts: msg.ts,
            is_edit: false,
            user_directory: directory,
            local_attachments: downloadedFiles,
            thread_context: threadContext,
          },
          { quiet: true }
        );

        summary.messages_processed += 1;
        if (processed?.task_created) summary.created.tasks += 1;
        if (processed?.issue_created) summary.created.issues += 1;
        if (
          processed?.discussion?.id &&
          (processed.action === 'STORE_DISCUSSION' || processed.action === 'LINK_DISCUSSION')
        ) {
          summary.created.discussions += 1;
        }
      } catch (err) {
        summary.errors.push({
          channel: channel.id,
          ts: msg.ts,
          error: err.message,
        });
      }
    }
  }

  if (messageProcessor.io) {
    messageProcessor.io.emit('dashboard:update', {
      action: 'SLACK_SYNC',
      at: new Date().toISOString(),
      summary,
    });
  }

  const dashboard = await getDashboard();
  return { ok: true, sync: summary, dashboard };
}

module.exports = { 
  syncFromSlack, 
  createSlackClient, 
  buildDirectory, 
  resolveUser,
  downloadSlackAttachments ,
  listChannels
};