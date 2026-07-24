const DailySummary = require('../models/DailySummary');
const { callOpenRouter } = require('../ai/openai');
const { Task, Issue } = require('../models');

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
  const targetDate = dateStr || getYesterdayDateString();

  try {
    await DailySummary.updateOne({ date: targetDate }, { $set: { is_stale: true } });
  } catch (err) {
    console.error('[Cache] Failed to mark summary stale:', err.message);
  }

  if (debounceTimer) clearTimeout(debounceTimer);

  // Reduced delay to 3 seconds for instant summary generation
  debounceTimer = setTimeout(async () => {
    console.log(`[AI Summary] Running background update for yesterday (${targetDate})...`);
    await regenerateSummaryInBackground(targetDate);
  }, 3000); 
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
    const formattedTasks = tasks.map(t => ({
      title: t.title,
      status: t.status,
      assigned_to: t.assigned_to?.name || t.owner?.name || 'Unassigned',
      blocked_reason: t.blocked_reason || null
    }));

    // Format issues with assigned team member and priority/status
    const formattedIssues = issues.map(i => ({
      title: i.title,
      status: i.status,
      priority: i.priority,
      assigned_to: i.assigned_to?.name || i.owner?.name || 'Unassigned'
    }));

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

    const summaryText = await callOpenRouter(
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