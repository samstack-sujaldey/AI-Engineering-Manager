# AI Engineering Manager — Slack Task Intelligence

Enterprise agent that monitors Slack conversations and builds a live project-management system from natural language.

The **AI parser is stateless**. Every message is analyzed and returned as structured JSON. The application layer owns persistence, reminders, Slack DMs, and the dashboard.

## Architecture

```
Slack message / API
        │
        ▼
┌───────────────────┐
│  Stateless Parser │  classify → extract → structured JSON
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Message Processor │  dedupe → create/update Task|Issue|Discussion
└─────────┬─────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
 MongoDB      Notifications / Hourly reminders / Socket.IO
                     │
                     ▼
              Forgeboard Dashboard (Angular)
```

## Classifications

| Type | When |
|------|------|
| `TASK` | Actionable work |
| `ISSUE` | Bug, outage, failure, regression |
| `GENERAL_DISCUSSION` | Ideas, questions, planning — linked to existing work when possible |

Confidence below **70%** → `GENERAL_DISCUSSION` + human-review flag (no Task/Issue created).

Similarity ≥ **90%** → update existing Task/Issue (never duplicate).

## Quick start

### Prerequisites

- Node.js 20+
- MongoDB running locally (or set `MONGODB_URI`)
- Optional: Slack app credentials for live channel monitoring

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm test                 # parser unit tests (no DB)
npm start                # API + Socket.IO + reminders (+ Slack if configured)
npm run seed             # optional sample data (needs MongoDB)
```

API: `http://localhost:4000`

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check |
| `GET /api/dashboard` | Full dashboard payload |
| `POST /api/slack/sync` | Pull Slack history → process → dashboard payload |
| `POST /api/parse` | Stateless parse only |
| `POST /api/messages/process` | Parse + persist |
| `GET /api/tasks` | List tasks |
| `GET /api/issues` | List issues |

### Frontend (Forgeboard)

```bash
cd frontend/frontend
npm install
npm start
```

Open `http://localhost:4200`.

## Slack setup

1. Create a Slack app with **Socket Mode**.
2. Bot scopes: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `mpim:history`, `chat:write`, `users:read`, `users:read.email`.
3. Subscribe to `message.channels`, `message.groups`, `message.im`, `message.mpim`.
4. Invite the bot into the channels you want tracked.
5. Put tokens in `backend/.env` and **save the file**:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
SLACK_SOCKET_MODE=true
```

Dashboard **Refresh** calls `POST /api/slack/sync`, which pulls recent channel history and populates tasks/issues.

Optional: `SLACK_SYNC_CHANNELS=C0123,C0456` (limit to specific channels), `SLACK_SYNC_LIMIT=50` (messages per channel).

Without Slack tokens the API and dashboard still work via `POST /api/messages/process` or `npm run seed`.

## Example parse output

```bash
curl -X POST http://localhost:4000/api/parse \
  -H "Content-Type: application/json" \
  -d '{
    "text": "<@U2> please finish the payment API tomorrow.",
    "sender": { "id": "U1", "name": "john", "display_name": "John" },
    "user_directory": { "U2": { "id": "U2", "name": "sarah", "display_name": "Sarah" } }
  }'
```

Returns structured JSON with `classification`, `owner`, `assigned_to`, `assigned_by`, `task`, `notifications`, etc.

## Ownership rules

| Message | Owner / Assigned To |
|---------|---------------------|
| `I'll finish the login API tomorrow.` | Sender |
| `@Sarah please finish the payment API.` | Sarah (Assigned By = sender) |
| `Can someone update the documentation?` | Unassigned (`needs_assignment: true`) |

## Notifications & reminders

Immediate Slack DMs when:

- Due date missing
- Status `BLOCKED` without a reason
- Another user is blocking work

Hourly reminders continue until the missing data is supplied or acknowledgement (`OK`, `Got it`, …) is received. Message edits re-parse and cancel resolved reminders.

## Dashboard shows

Tasks & Issues with **Assigned To**, **Assigned By**, **Reporter**, **Created By**, **Owner**, priority, status, due date, overdue / blocked / urgent queues, waiting due date / block reason / acknowledgement, discussion timeline, dependencies, recent activity, task/issue progress, and owner workload.
