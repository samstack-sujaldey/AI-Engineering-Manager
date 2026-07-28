const DailySummary = require('../models/DailySummary');
const { callOpenAI} = require('../ai/openai');
const { Task, Issue } = require('../models');
const { normalizePersonName } = require('../agent/parser');

let debounceTimer = null;

/**
 * Gets formatted date string YYYY-MM-DD for yesterday
 */
function getYesterdayDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Marks cache stale immediately, then schedules an AI summary update.
 */
async function invalidateDailySummary(dateStr = null) {
  // 🟢 Disabled: We rely exclusively on the 10:00 AM scheduled pre-cache job. 
  // Real-time chat messages or WebSocket updates will no longer invalidate or regenerate summaries.
  return;
}

/**
 * Generates yesterday's summary with 2 sections: Tasks and Issues with Team Members & Status.
 */
async function regenerateSummaryInBackground(targetDateStr) {
  try {
    const targetDate = targetDateStr || getYesterdayDateString();
    const [year, month, day] = targetDate.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

    const [tasks, issues] = await Promise.all([
      Task.find({
        $or: [
          { created_time: { $gte: startOfDay, $lte: endOfDay } },
          { updated_time: { $gte: startOfDay, $lte: endOfDay } },
          { status: { $in: ['TODO', 'PROCESSING', 'BLOCKED'] } },
        ],
      }).lean().catch(() => []),

      Issue.find({
        $or: [
          { created_time: { $gte: startOfDay, $lte: endOfDay } },
          { updated_time: { $gte: startOfDay, $lte: endOfDay } },
          { status: { $in: ['OPEN', 'HOLD'] } },
        ],
      }).lean().catch(() => []),
    ]);

    // Format tasks with assigned team member and current status
    const formattedTasks = tasks.map(t => {
      const assignee = t.assigned_to || t.owner || {};
      const rawName = assignee.display_name || assignee.real_name || assignee.name || 'Unassigned';
      return {
        title: t.title,
        status: t.status,
        assigned_to: normalizePersonName(rawName),
        blocked_reason: t.blocked_reason || null
      };
    });

    // Format issues with assigned team member and priority/status
    const formattedIssues = issues.map(i => {
      const assignee = i.assigned_to || i.owner || {};
      const rawName = assignee.display_name || assignee.real_name || assignee.name || 'Unassigned';
      return {
        title: i.title,
        status: i.status,
        priority: i.priority,
        assigned_to: normalizePersonName(rawName)
      };
    });

    const prompt = `
Generate an engineering daily summary for Yesterday (${targetDate}):

Create EXACTLY two sections:

1. 📌 **Tasks Summary**
- List yesterday's tasks, their assigned team member, and status (TODO, PROCESSING, BLOCKED, COMPLETED).
- Highlight blocker reasons if a task is blocked.

2. 🚨 **Issues & Bugs Summary**
- List yesterday's issues, assigned team member, priority, and status (OPEN, HOLD, RESOLVED).

Data to summarize:
Tasks: ${JSON.stringify(formattedTasks)}
Issues: ${JSON.stringify(formattedIssues)}
`;

    const summaryText = await callOpenAI(
      [{ role: 'user', content: prompt }],
      { maxTokens: 400, temperature: 0.1 }
    );

    if (summaryText) {
      await DailySummary.findOneAndUpdate(
        { date: targetDate },
        {
          summary: summaryText,
          tasks_count: tasks.length,
          issues_count: issues.length,
          is_stale: false,
        },
        { upsert: true, returnDocument: 'after' }
      );
      console.log(`[AI Summary] Updated and cached for yesterday (${targetDate})`);
    }
  } catch (err) {
    console.error('[AI Summary Error]:', err.message);
  }
}

module.exports = { invalidateDailySummary, regenerateSummaryInBackground };