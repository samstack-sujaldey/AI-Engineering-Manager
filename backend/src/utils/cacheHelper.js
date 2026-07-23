const DailySummary = require('../models/DailySummary');
const { callOpenRouter } = require('../ai/gemini');
const { Task, Issue, Discussion } = require('../models');

let debounceTimer = null;

/**
 * Marks cache stale immediately, then schedules an AI summary update in the background.
 */
async function invalidateDailySummary(dateStr = null) {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];

  try {
    // 1. Instantly mark as stale in DB (<2ms)
    await DailySummary.updateOne({ date: targetDate }, { $set: { is_stale: true } });
  } catch (err) {
    console.error('[Cache] Failed to mark summary stale:', err.message);
  }

  // 2. Debounce AI call: If 30 requests come in within 30 seconds, 
  // clear previous timers and run ONLY ONCE at the end.
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    console.log(`[AI Summary] Running debounced background update for ${targetDate}...`);
    await regenerateSummaryInBackground(targetDate);
  }, 30000); // 30-second buffer
}

/**
 * Regenerates the summary in background without blocking task submission
 */
async function regenerateSummaryInBackground(targetDateStr) {
  try {
    const [year, month, day] = targetDateStr.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

    const [tasks, issues, discussions] = await Promise.all([
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

      Discussion.find({
        timestamp: { $gte: startOfDay, $lte: endOfDay },
        channel: { $ne: 'daily-wrapup' },
      }).lean().catch(() => []),
    ]);

    const uniqueTasks = Object.values(
      tasks.reduce((acc, t) => {
        const key = (t.title || '').toLowerCase().trim();
        if (!acc[key]) acc[key] = { title: t.title, status: t.status, assignees: new Set() };
        const assignee = t.assigned_to?.name || t.owner?.name;
        if (assignee && assignee !== 'Unassigned') acc[key].assignees.add(assignee);
        return acc;
      }, {})
    ).map(t => ({
      title: t.title,
      status: t.status,
      assignees: Array.from(t.assignees).join(', ') || 'Unassigned',
    }));

    const prompt = `
Generate a 3-section engineering stand-up summary for ${targetDateStr}:

1. 📌 **Tasks Activity**
2. 🐞 **Issues & Bugs**
3. 💬 **General Discussions**

Data:
Tasks: ${JSON.stringify(uniqueTasks)}
Issues: ${JSON.stringify(issues.map(i => ({ title: i.title, priority: i.priority, status: i.status })))}
Discussions: ${JSON.stringify(discussions.map(d => ({ author: d.author?.name, text: d.content })))}
`;

    const summaryText = await callOpenRouter(
      [{ role: 'user', content: prompt }],
      { maxTokens: 350, temperature: 0.1 }
    );

    if (summaryText) {
      await DailySummary.findOneAndUpdate(
        { date: targetDateStr },
        {
          summary: summaryText,
          tasks_count: tasks.length,
          issues_count: issues.length,
          discussions_count: discussions.length,
          is_stale: false,
        },
        { upsert: true, new: true }
      );
      console.log(`[AI Summary] Updated and cached for ${targetDateStr}`);
    }
  } catch (err) {
    console.error('[AI Summary Background Error]:', err.message);
  }
}

module.exports = { invalidateDailySummary, regenerateSummaryInBackground };