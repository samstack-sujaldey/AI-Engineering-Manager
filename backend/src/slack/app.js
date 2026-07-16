const { App } = require('@slack/bolt');
const config = require('../config');
const { toUser } = require('../agent/parser');

function looksLikePlaceholder(value, prefixes = []) {
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.includes('your-') || lower.includes('change-me') || lower.includes('placeholder')) {
    return true;
  }
  return prefixes.length > 0 && !prefixes.some((p) => value.startsWith(p));
}

function createSlackApp({ messageProcessor, notificationService }) {
  const { botToken, signingSecret, appToken, socketMode } = config.slack;

  if (!botToken || !signingSecret) {
    console.warn('[slack] Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET — Slack disabled');
    return null;
  }

  if (looksLikePlaceholder(botToken, ['xoxb-']) || looksLikePlaceholder(signingSecret)) {
    console.warn(
      '[slack] SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET look like placeholders — Slack disabled. ' +
        'Paste real values from https://api.slack.com/apps → your app → OAuth & Permissions / Basic Information.'
    );
    return null;
  }

  const appOptions = {
    token: botToken,
    signingSecret,
  };

  if (socketMode) {
    if (!appToken || looksLikePlaceholder(appToken, ['xapp-'])) {
      console.warn(
        '[slack] Valid SLACK_APP_TOKEN (xapp-…) required for Socket Mode — Slack disabled. ' +
          'Enable Socket Mode and create an App-Level Token with connections:write.'
      );
      return null;
    }
    appOptions.socketMode = true;
    appOptions.appToken = appToken;
  }

  const app = new App(appOptions);

  if (notificationService) {
    notificationService.setSlackClient(app.client);
  }

  async function resolveSender(client, userId) {
    try {
      const info = await client.users.info({ user: userId });
      const u = info.user || {};
      return toUser({
        id: u.id,
        name: u.name,
        display_name: u.profile?.display_name || u.real_name || u.name,
        email: u.profile?.email || '',
        real_name: u.real_name,
      });
    } catch {
      return toUser({ id: userId, name: userId, display_name: userId });
    }
  }

  async function buildDirectory(client, text) {
    const ids = [...text.matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
    const directory = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const info = await client.users.info({ user: id });
          const u = info.user || {};
          directory[id] = {
            id: u.id,
            name: u.name,
            display_name: u.profile?.display_name || u.real_name || u.name,
            email: u.profile?.email || '',
            real_name: u.real_name,
          };
        } catch {
          directory[id] = { id, name: id };
        }
      })
    );
    return directory;
  }

  async function handleMessage(event, client, { is_edit = false } = {}) {
    if (!event?.text || event.bot_id || event.subtype === 'bot_message') return;

    const text = event.text;
    const sender = await resolveSender(client, event.user);
    const user_directory = await buildDirectory(client, text);

    const result = await messageProcessor.process({
      text,
      sender,
      channel: event.channel,
      thread_id: event.thread_ts || event.ts,
      workspace_id: event.team || '',
      team: event.team || '',
      message_ts: is_edit ? event.ts : event.ts,
      is_edit,
      user_directory,
    });

    console.log(
      `[slack] ${result.action} classification=${result.classification} confidence=${result.confidence}`
    );

    if (result.task_created || result.issue_created) {
      const label = result.task_created
        ? `Task *${result.task.title}* → ${result.task.assigned_to?.name || 'Unassigned'} [${result.task.priority}/${result.task.status}]`
        : `Issue *${result.issue.title}* → ${result.issue.assigned_to?.name || 'Unassigned'} [${result.issue.priority}/${result.issue.status}]`;

      try {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.thread_ts || event.ts,
          text: `Tracked: ${label}`,
        });
      } catch (err) {
        console.error('[slack] confirmation failed:', err.message);
      }
    }

    return result;
  }

  // Single message listener — handles new messages and edits via subtype
  app.event('message', async ({ event, client }) => {
    try {
      if (event.subtype === 'message_changed' && event.message) {
        await handleMessage(
          {
            ...event.message,
            channel: event.channel,
            team: event.team || event.message.team,
            ts: event.message.ts,
          },
          client,
          { is_edit: true }
        );
        return;
      }

      if (event.subtype && event.subtype !== 'file_share') return;
      await handleMessage(event, client, { is_edit: false });
    } catch (err) {
      console.error('[slack] message handler error:', err);
    }
  });

  return app;
}

module.exports = { createSlackApp };
