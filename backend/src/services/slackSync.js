const { WebClient } = require('@slack/web-api');
const config = require('../config');
const { toUser } = require('../agent/parser');
const { findWorkByMessageTs } = require('./similarity');
const { Discussion, Team } = require('../models');
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

// 🟢 Helper to detect bots and integration accounts
function isBotUser(u = {}) {
  const name = (u.name || u.real_name || u.display_name || '').toLowerCase();
  const id = (u.id || '').toLowerCase();
  return (
    u.is_bot === true ||
    u.is_app_user === true ||
    id === 'uslackbot' ||
    name.includes('github') ||
    name.includes('slackbot') ||
    name.includes('ai_engineering') ||
    name.includes('bot')
  );
}

async function resolveUser(client, userId, cache) {
  if (!userId) return toUser({ id: '', name: 'Unassigned', display_name: 'Unassigned' });
  if (cache.has(userId)) return cache.get(userId);

  try {
    const info = await client.users.info({ user: userId });
    const u = info.user || {};

    // 🟢 1. Check if user is a bot or integration
    if (isBotUser(u)) {
      const botFallback = toUser({ id: '', name: 'Unassigned', display_name: 'Unassigned' });
      cache.set(userId, botFallback);
      return botFallback;
    }

    const realDisplayName = u.profile?.real_name || u.profile?.display_name || u.real_name || u.name;

    const user = toUser({
      id: u.id,
      name: u.name,
      display_name: realDisplayName,
      email: u.profile?.email || '',
      real_name: u.real_name,
    });
    cache.set(userId, user);
    return user;
  } catch {
    const fallback = toUser({ id: '', name: 'Unassigned', display_name: 'Unassigned' });
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

// 🟢 Safely download attachments to a temporary directory
async function downloadSlackAttachments(files = [], token) {
  const crypto = require('crypto');
  const downloaded = [];
  
  // 🟢 Dynamically resolve the temp folder inside the backend directory for any environment (local or production)
  const localTempDir = path.join(process.cwd(), 'temp');

  try {
    // Automatically creates the 'temp' folder if it doesn't exist yet
    await fs.mkdir(localTempDir, { recursive: true });
  } catch (err) {
    console.error(`[slackSync] Failed to create local temp directory:`, err.message);
  }

  for (const f of files) {
    const downloadUrl = f.urlPrivateDownload || f.urlPrivate;
    if (!downloadUrl) continue;
    
    try {
      const response = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
      });
      const ext = path.extname(f.fileName || '') || '';
      const tempName = `${crypto.randomUUID()}${ext}`;
      
      // 🟢 Save the file directly into the auto-provisioned backend/temp folder
      const localPath = path.join(localTempDir, tempName);
      
      await fs.writeFile(localPath, response.data);
      downloaded.push({ ...f, localPath });
      console.log(`[slackSync] Successfully downloaded attachment: ${f.fileName} -> ${localPath}`);
    } catch (err) {
      console.error(`[slackSync] Failed to download file ${f.fileName}:`, err.message);
    }
  }
  return downloaded;
}

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

  const botPattern = /github|jira|jirabot|slackbot|ai_engineering|bot/i;

  for (const channel of channels) {
    summary.channels_scanned += 1;

    // 🟢 2. Sync channel members to Team collection — FILTER OUT BOTS STRICTLY
    try {
      const membersResult = await client.conversations.members({ channel: channel.id });
      const rawMemberIds = membersResult.members || [];
      const humanMembers = [];

      for (const mId of rawMemberIds) {
        const resolved = await resolveUser(client, mId, userCache);
        
        if (resolved && resolved.name !== 'Unassigned') {
          const checkName = `${resolved.name || ''} ${resolved.display_name || ''} ${resolved.real_name || ''}`;
          
          // Check if user is a bot or system account
          const isBot = 
            resolved.id === 'USLACKBOT' ||
            botPattern.test(checkName);

          if (!isBot) {
            humanMembers.push(resolved);
          }
        }
      }

      const cleanChanName = (channel.name || channel.id).replace(/^#/, '').trim();
      await Team.findOneAndUpdate(
        { channel_id: channel.id },
        {
          team_id: `team_${channel.id}`,
          channel_id: channel.id,
          channel_name: cleanChanName,
          members: humanMembers,
          member_count: humanMembers.length,
          last_synced_at: new Date(),
        },
        { upsert: true }
      );
    } catch (e) {
      console.warn(`[slackSync] Member sync warning for ${channel.id}:`, e.message);
    }

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

      // 🟢 3. Skip messages authored by bots/apps or webhook integrations
      if ((!safeText && !hasFiles) || msg.bot_id || msg.app_id || msg.subtype === 'bot_message') {
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

      try {
        const sender = await resolveUser(client, msg.user, userCache);
        const checkSenderName = `${sender.name || ''} ${sender.display_name || ''} ${sender.real_name || ''}`;
        
        if (sender.name === 'Unassigned' || botPattern.test(checkSenderName)) {
          summary.messages_skipped += 1;
          continue;
        }

        const cleanChanName = (channel.name || channel.id).replace(/^#/, '').trim();
        const directory = await buildDirectory(client, safeText, userCache);

        const processed = await messageProcessor.process(
          {
            text: safeText,
            sender,
            channel: channel.id,
            channel_name: cleanChanName,
            thread_id: msg.thread_ts || '',
            workspace_id: auth.team_id || '',
            team: cleanChanName,
            message_ts: msg.ts,
            is_edit: false,
            user_directory: directory,
            thread_context: [],
          },
          { quiet: true }
        );

        summary.messages_processed += 1;
        if (processed?.task_created) summary.created.tasks += 1;
        if (processed?.issue_created) summary.created.issues += 1;
      } catch (err) {
        summary.errors.push({
          channel: channel.id,
          ts: msg.ts,
          error: err.message,
        });
      }
    }
  }

  const dashboard = await getDashboard();
  return { ok: true, sync: summary, dashboard };
}

module.exports = { 
  syncFromSlack, 
  createSlackClient, 
  buildDirectory, 
  resolveUser,
  listChannels,
  downloadSlackAttachments
};