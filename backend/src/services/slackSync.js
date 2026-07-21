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

async function alreadyProcessed(messageTs) {
  const { task, issue } = await findWorkByMessageTs(messageTs);
  if (task || issue) return true;
  const discussion = await Discussion.findOne({ slack_message_ts: messageTs }).lean();
  return !!discussion;
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

  // Oldest first so thread continuity works
  return messages.reverse();
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

  // Authenticate to prevent ReferenceError and fetch workspace identity
  const auth = await client.auth.test();

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
    summary.channels_scanned++;
    try {
      const messages = await fetchChannelHistory(client, channel.id, limitPerChannel);
      
      for (const msg of messages) {
        summary.messages_seen++;
        if (!msg.text || msg.subtype) {
          summary.messages_skipped++;
          continue;
        }

        if (await alreadyProcessed(msg.ts)) {
          summary.messages_skipped++;
          continue;
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

          const directory = await buildDirectory(client, msg.text, userCache);

          const processed = await messageProcessor.process({
            text: msg.text,
            sender,
            channel: channel.name || channel.id,
            thread_id: msg.thread_ts || '',
            workspace_id: auth.team_id || '',
            team: auth.team || '',
            message_ts: msg.ts,
            user_directory: directory,
            thread_context: threadContext,
          });

          if (processed) {
            summary.messages_processed++;
            if (processed.type === 'TASK') summary.created.tasks++;
            if (processed.type === 'ISSUE') summary.created.issues++;
            if (processed.type === 'DISCUSSION') summary.created.discussions++;
          } else {
            summary.messages_skipped++;
          }
        } catch (msgErr) {
          summary.messages_skipped++;
          summary.errors.push({
            channel: channel.name || channel.id,
            message: msgErr.message,
          });
        }
      }
    } catch (chErr) {
      summary.errors.push({
        channel: channel.name || channel.id,
        message: chErr.message,
      });
    }
  }

  return summary;
}

module.exports = {
  createSlackClient,
  listChannels,
  syncFromSlack,
};
