const express = require("express");
const { Inngest } = require("inngest");
const { serve } = require("inngest/express");

const app = express();
const port = Number(process.env.PORT || 3000);
const slackToken = process.env.SLACK_BOT_TOKEN;
const defaultChannels = (process.env.SLACK_CHANNEL_IDS || "")
  .split(",")
  .map((channel) => channel.trim())
  .filter(Boolean);

app.use(express.json());

const inngest = new Inngest({ id: "ai-engineering-manager" });
const slack = Boolean(slackToken);

const dashboardState = {
  lastUpdated: null,
  status: slack ? "ready" : "missing_slack_token",
  channels: [],
  messages: [],
  summary: {
    totalMessages: 0,
    channelCount: 0,
    topAuthors: [],
    keywordCounts: {},
  },
  error: slack ? null : "Set SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS to fetch Slack data.",
};

function countKeywords(messages) {
  const keywords = ["blocked", "incident", "deploy", "review", "urgent", "bug"];
  return keywords.reduce((counts, keyword) => {
    counts[keyword] = messages.filter((message) =>
      String(message.text || "").toLowerCase().includes(keyword)
    ).length;
    return counts;
  }, {});
}

function topAuthors(messages) {
  const counts = new Map();
  for (const message of messages) {
    const author = message.user || message.username || "unknown";
    counts.set(author, (counts.get(author) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([author, count]) => ({ author, count }));
}

function buildSummary(channels, messages) {
  return {
    totalMessages: messages.length,
    channelCount: channels.length,
    topAuthors: topAuthors(messages),
    keywordCounts: countKeywords(messages),
  };
}

async function slackApi(method, params) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${slackToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json();

  if (!payload.ok) {
    throw new Error(`Slack ${method} failed: ${payload.error || response.statusText}`);
  }

  return payload;
}

async function fetchSlackChannel(channelId, limit) {
  const [channelInfo, history] = await Promise.all([
    slackApi("conversations.info", { channel: channelId }),
    slackApi("conversations.history", { channel: channelId, limit }),
  ]);

  const channelName = channelInfo.channel?.name || channelId;
  const messages = (history.messages || []).map((message) => ({
    id: `${channelId}-${message.ts}`,
    channelId,
    channelName,
    user: message.user || message.bot_id || message.username || "unknown",
    text: message.text || "",
    ts: message.ts,
    isoTime: message.ts
      ? new Date(Number.parseFloat(message.ts) * 1000).toISOString()
      : null,
  }));

  return {
    channel: { id: channelId, name: channelName, messageCount: messages.length },
    messages,
  };
}

const syncSlackDashboard = inngest.createFunction(
  { id: "sync-slack-dashboard", name: "Sync Slack dashboard" },
  [{ event: "slack/dashboard.sync" }, { cron: process.env.SLACK_SYNC_CRON || "*/30 * * * *" }],
  async ({ event, step }) => {
    if (!slack) {
      dashboardState.status = "missing_slack_token";
      dashboardState.error = "Set SLACK_BOT_TOKEN before syncing Slack data.";
      return dashboardState;
    }

    const channelIds = event.data?.channels?.length ? event.data.channels : defaultChannels;
    const limit = Number(event.data?.limit || process.env.SLACK_MESSAGE_LIMIT || 25);

    if (!channelIds.length) {
      dashboardState.status = "missing_channels";
      dashboardState.error = "Set SLACK_CHANNEL_IDS or send channels in the sync event payload.";
      return dashboardState;
    }

    const results = await step.run("fetch-slack-channel-history", async () => {
      return Promise.all(channelIds.map((channelId) => fetchSlackChannel(channelId, limit)));
    });

    const channels = results.map((result) => result.channel);
    const messages = results.flatMap((result) => result.messages);

    await step.run("update-dashboard-state", async () => {
      dashboardState.lastUpdated = new Date().toISOString();
      dashboardState.status = "synced";
      dashboardState.channels = channels;
      dashboardState.messages = messages;
      dashboardState.summary = buildSummary(channels, messages);
      dashboardState.error = null;
      return dashboardState;
    });

    return dashboardState;
  }
);

app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [syncSlackDashboard],
  })
);

app.get("/api/slack-dashboard", (_req, res) => {
  res.json(dashboardState);
});

app.post("/api/slack-dashboard/sync", async (req, res, next) => {
  try {
    const channels = Array.isArray(req.body?.channels) ? req.body.channels : defaultChannels;
    const limit = req.body?.limit;
    const result = await inngest.send({
      name: "slack/dashboard.sync",
      data: { channels, limit },
    });

    res.status(202).json({ message: "Slack dashboard sync queued.", result });
  } catch (error) {
    next(error);
  }
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Engineering Manager Slack Dashboard</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px; }
    button { background: #38bdf8; border: 0; border-radius: 8px; color: #082f49; cursor: pointer; font-weight: 700; padding: 10px 14px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 18px; }
    .muted { color: #94a3b8; }
    .message { border-top: 1px solid #334155; padding: 12px 0; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <main>
    <h1>Slack Engineering Signals</h1>
    <p class="muted">Fetched by an Inngest durable function from configured Slack channels.</p>
    <button id="sync">Sync now</button>
    <p id="status" class="muted">Loading…</p>
    <section class="grid" id="summary"></section>
    <section class="card"><h2>Recent messages</h2><div id="messages"></div></section>
  </main>
  <script>
    const status = document.querySelector('#status');
    const summary = document.querySelector('#summary');
    const messages = document.querySelector('#messages');

    async function loadDashboard() {
      const response = await fetch('/api/slack-dashboard');
      const data = await response.json();
      status.textContent = data.error || ('Status: ' + data.status + (data.lastUpdated ? ' · Updated ' + new Date(data.lastUpdated).toLocaleString() : ''));
      status.className = data.error ? 'error' : 'muted';
      const keywords = Object.entries(data.summary.keywordCounts || {}).map(([key, value]) => key + ': ' + value).join(' · ');
      summary.innerHTML = [
        ['Messages', data.summary.totalMessages],
        ['Channels', data.summary.channelCount],
        ['Top authors', (data.summary.topAuthors || []).map((item) => item.author + ' (' + item.count + ')').join(', ') || '—'],
        ['Keywords', keywords || '—'],
      ].map(([label, value]) => '<article class="card"><div class="muted">' + label + '</div><strong>' + value + '</strong></article>').join('');
      messages.innerHTML = (data.messages || []).slice(0, 30).map((message) => '<div class="message"><strong>#' + message.channelName + '</strong> <span class="muted">' + (message.isoTime || '') + ' · ' + message.user + '</span><p>' + escapeHtml(message.text) + '</p></div>').join('') || '<p class="muted">No Slack messages yet.</p>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    }

    document.querySelector('#sync').addEventListener('click', async () => {
      status.textContent = 'Queueing sync…';
      await fetch('/api/slack-dashboard/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setTimeout(loadDashboard, 1500);
    });

    loadDashboard();
    setInterval(loadDashboard, 30000);
  </script>
</body>
</html>`);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Unexpected server error" });
});

app.listen(port, () => {
  console.log(`Dashboard listening on http://localhost:${port}`);
});
