# Standup Pulse — dashboard

A single-page Angular dashboard showing **Member | Status | Priority | Task** for
every task pulled from your Slack standup pipeline.

## 1. Add the missing backend endpoint

Your backend has the full pipeline already, but no route to *read* tasks back out.
Copy the two files from `../backend-additions/` into your Express project:

- `controllers/tasks.controller.js`
- `routes/tasks.routes.js`

Then in `server.js`, add:

```js
import taskRoutes from './routes/tasks.routes.js';
// ...
app.use('/api/tasks', taskRoutes);
```

## 2. Run the dashboard

```bash
npm install
npm start
```

Visit `http://localhost:4200`. It expects the backend at `http://localhost:8000/api`
(edit `src/environments/environment.ts` if yours runs elsewhere).

## What it shows

- One row per task: member (with initial avatar), status pill, priority pill, task
  title + description.
- A live-sync badge with a pulsing dot and last-synced time.
- Summary counts (total / in progress / completed / blocked).
- Search + status/priority filter chips.
- Responsive: collapses to stacked cards below 700px.
- Empty and error states that point back at the pipeline endpoint.

No new dependencies beyond core Angular — just `HttpClient` and signals.
