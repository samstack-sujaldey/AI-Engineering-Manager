const { WebClient } = require('@slack/web-api');
const config = require('../config');
const { toUser } = require('../agent/parser');
const { findWorkByMessageTs } = require('./similarity');
const { Discussion } = require('../models');
const { getDashboard } = require('./dashboard');

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

// FIXED: Enhanced status wrapper to return meaningful states back to the execution trace loop
async function alreadyProcessed(messageTs) {
  const { task, issue } = await findWorkByMessageTs(messageTs);
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

async function syncFromSlack(messageProcessor, options = {}) {
  const {
    limitPerChannel = parseInt(process.env.SLACK_SYNC_LIMIT || '50', 10),
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

  let downloadToken;
  try {
    downloadToken = await module.exports.getSlackAccessToken(); 
  } catch (tokenErr) {
    downloadToken = config.slack.botToken;
  }

  const channels = await listChannels(client, { channelIds });
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
      
      // FIXED: Allow processing if there are attachments present, even if raw message text field is blank
      const hasFiles = msg.files && msg.files.length > 0;
      const safeText = msg.text || "";

      if ((!safeText && !hasFiles) || msg.bot_id || msg.subtype === 'bot_message') {
        console.log(`[Sync Debug] Skipping item ts=${msg.ts}: Identified as bot notification or lacks content.`);
        summary.messages_skipped += 1;
        continue;
      }
      if (msg.subtype && msg.subtype !== 'file_share') {
        console.log(`[Sync Debug] Skipping item ts=${msg.ts}: Excluded due to message subtype alignment.`);
        summary.messages_skipped += 1;
        continue;
      }

      let downloadedFiles = [];
      try {
        const checkDuplicate = await alreadyProcessed(msg.ts);
        if (checkDuplicate.skipped) {
          console.log(`[Sync Debug] Skipping duplicate item ts=${msg.ts}: Already indexed as [${checkDuplicate.type}].`);
          summary.messages_skipped += 1;
          continue;
        }

        if (hasFiles) {
          const rawAttachments = msg.files.map(f => ({
            slackFileId: f.id,
            fileName: f.name,
            mimeType: f.mimetype,
            fileType: f.filetype,
            urlPrivateDownload: f.url_private_download,
            urlPrivate: f.url_private
          }));
          downloadedFiles = await module.exports.downloadSlackAttachments(rawAttachments, downloadToken);
        }

        const sender = await resolveUser(client, msg.user, userCache);
        const user_directory = await buildDirectory(client, safeText, userCache);
        
        console.log(`[Sync Debug] Handing off message context (ts=${msg.ts}) directly to MessageProcessor core.`);
        const result = await messageProcessor.process(
          {
            text: safeText,
            sender,
            channel: channel.id,
            thread_id: msg.thread_ts || msg.ts,
            workspace_id: auth.team_id || '',
            team: auth.team || '',
            message_ts: msg.ts,
            is_edit: false,
            user_directory,
            local_attachments: downloadedFiles
          },
          { quiet: true }
        );

        summary.messages_processed += 1;
        if (result.task_created) summary.created.tasks += 1;
        if (result.issue_created) summary.created.issues += 1;
        if (
          result.discussion?.id &&
          (result.action === 'STORE_DISCUSSION' || result.action === 'LINK_DISCUSSION')
        ) {
          summary.created.discussions += 1;
        }
      } catch (err) {
        console.error(`[Sync Error] Failed parsing operations for timeline item ts=${msg.ts}:`, err.message);
        summary.errors.push({
          channel: channel.id,
          ts: msg.ts,
          error: err.message,
        });
      } finally {
        if (downloadedFiles.length > 0) {
          await module.exports.cleanupTemporaryFiles(downloadedFiles);
        }
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

module.exports = { syncFromSlack, createSlackClient };