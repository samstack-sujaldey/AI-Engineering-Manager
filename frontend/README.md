# TaskStream AI — Angular Frontend (MEAN)

A complete Angular frontend wired to your existing Express/MongoDB backend. No mock data —
every screen calls a real endpoint, with graceful empty/loading/error states instead of
placeholders.

## 1. Run the frontend

```bash
cd frontend
npm install
npm start
```

This runs `ng serve --proxy-config proxy.conf.json` on **http://localhost:4200**, which proxies
every `/api/*` call straight to your backend at `http://localhost:5000` (edit `proxy.conf.json`
if your backend runs on a different port). Using the proxy means you do **not** need to add CORS
headers to your Express app for local development.

## 2. Apply the backend patch files

The `backend-updates/` folder (delivered alongside this project) contains drop-in replacements
and one new route pair. Copy them over your existing files:

| File | What changed |
|---|---|
| `controllers/task.controller.js` | Populates `memberId` → `{name, role, email}` on every task response (needed so the UI can show "Assigned To" without a second lookup), adds `standupId` as a filterable query param, adds `createTask` for the "+ Create Task" button. |
| `routes/task.routes.js` | Adds `POST /api/tasks`. |
| `controllers/member.controller.js` | Adds `getMemberStats` — real counts of a member's current/blocked/completed-today tasks, used by the Team page workload cards. |
| `routes/member.routes.js` | Adds `GET /api/members/:id/stats`. |
| `controllers/dashboard.controller.js` **(new)** | Aggregates the 5 dashboard stat cards (Total / In Progress / Completed / Blocked / Due Today) directly from the `tasks` collection. |
| `routes/dashboard.routes.js` **(new)** | `GET /api/dashboard/summary`. |
| `controllers/standupController.js` | **Bug fix**: the manual "paste a stand-up" flow was writing to a throwaway `ManualStandup` model defined only inside that file — completely disconnected from the real `standups`/`standupMessages` collections used by the Slack pipeline. Manually-pasted stand-ups never showed up anywhere next to Slack ones. Rewrote it to use the real `Standup` + `StandupMessage` models with `source: 'Manual'`, exactly as your schema's `source` enum intends. Also added `getStandups` (list) and `getStandupById` (detail + its extracted tasks) for the Stand-up Summary page. |
| `routes/standup.routes.js` | Adds `GET /api/standups` and `GET /api/standups/:id`. |

**One line to add to your `server.js`/`app.js`:**

```js
import dashboardRoutes from './routes/dashboard.routes.js';
// ...
app.use('/api/dashboard', dashboardRoutes);
```

Everything else (Slack routes/controllers, `parserService.js`, `slack.service.js`) is untouched —
they were already solid and the frontend uses them as-is.

## 3. What each page does

- **Dashboard** (`/dashboard`) — 5 live stat cards, today's most recent stand-up summary, recent
  activity feed, and a team snapshot table (each row's Active/Blocked/Done Today comes from the
  new `/members/:id/stats` endpoint).
- **Tasks** (`/tasks`) — filter by member/status/priority (all real query params on
  `GET /api/tasks`), inline status change (`PATCH /api/tasks/:id/status`), and a Create Task modal
  (`POST /api/tasks`).
- **Stand-up Summary** (`/standup-summary`) — lists every stand-up (Slack **and** manual, now that
  the bug above is fixed), shows the extracted tasks + original raw message for whichever one you
  select, and lets you paste a new stand-up straight into the Gemini parser.
- **Team** (`/team`) — per-member workload cards (current/blocked/done today + a workload bar) and
  the real weekly throughput chart from `GET /api/teams/:id/throughput`.
- **Integrations** (`/integrations`) — Slack connect button, channel list, join, and "Run Pipeline"
  (hits your existing `/api/slack/channels/:id/process` end-to-end route).

## 4. Honest limitations (didn't fabricate anything not backed by your schema)

The screenshots you shared included a few things your current schema/backend doesn't compute yet
— AI confidence score, duplicate-task detection, and sentiment-over-week. Rather than fake those
with random numbers, I left them out of the Stand-up Summary page. If you want them for real,
that's new backend work:
- **Confidence score** — Gemini would need to also return a confidence value per task (extend
  `taskSchema` in `parserService.js`), or you compute one from schema-required-field completeness.
- **Duplicate detection** — a similarity check (e.g. embedding or fuzzy string match) between a
  new task's title and existing open tasks for the same team.
- **Sentiment over week** — would need Gemini (or a separate lightweight classifier) to also
  return a sentiment score per stand-up, stored on the `Standup` document, then charted.

Happy to build any of these next if useful — just say the word.
