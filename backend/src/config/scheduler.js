const cron = require('node-cron');
const { Task, Issue } = require('../models');
const { createSlackClient } = require('../services/slackSync');

/**
 * Dynamically send standup briefings based on provided options.
 * @param {Object} options
 * @param {string} [options.team] - Filter tasks/issues by team name
 * @param {string} [options.userId] - Filter briefing for a specific Slack User ID
 * @param {number} [options.lookbackHours] - Hours to look back for completed items (default: 24)
 * @param {string} [options.meetingTime] - Display string for meeting time (default: '10:15 AM')
 */
async function sendDailyStandupBriefings(options = {}) {
  const {
    team = null,
    userId = null,
    lookbackHours = 24,
    meetingTime = process.env.STANDUP_MEETING_TIME || '10:15 AM',
  } = options;

  console.log(`⏰ [Cron/Dynamic] Generating briefings (Team: ${team || 'All'}, User: ${userId || 'All'})...`);

  try {
    const client = createSlackClient();
    const lookbackDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    // 1. Build MongoDB Filters Dynamically
    const taskFilter = {
      $or: [
        { status: { $in: ['BLOCKED', 'PROCESSING', 'TODO'] } },
        { status: 'COMPLETED', updated_time: { $gte: lookbackDate } },
      ],
    };

    const issueFilter = {
      $or: [
        { status: { $in: ['OPEN', 'HOLD'] } },
        { status: 'RESOLVED', updatedAt: { $gte: lookbackDate } },
        { status: 'RESOLVED', updated_time: { $gte: lookbackDate } },
      ],
    };

    // Apply dynamic team or user filters if provided
    if (team) {
      taskFilter.team = team;
      issueFilter.team = team;
    }

    if (userId) {
      taskFilter['assigned_to.id'] = userId;
      issueFilter['assigned_to.id'] = userId;
    }

    // 2. Query DB
    const [activeTasks, activeIssues] = await Promise.all([
      Task.find(taskFilter).lean(),
      Issue.find(issueFilter).lean(),
    ]);

    if ((!activeTasks || activeTasks.length === 0) && (!activeIssues || activeIssues.length === 0)) {
      console.log('ℹ️ [Standup Briefings] No matching tasks or issues found for this query.');
      return { success: true, count: 0, message: 'No active or recent tasks found.' };
    }

    // 3. Group by Slack User ID
    const userMap = {};

    const getOrCreateUserEntry = (userRef, itemTeam) => {
      const slackUserId = userRef?.id;
      if (!slackUserId || slackUserId === 'Unassigned') return null;

      if (!userMap[slackUserId]) {
        userMap[slackUserId] = {
          name: userRef?.display_name || userRef?.name || 'Teammate',
          team: itemTeam || team || 'Daily',
          tasks: [],
          issues: [],
        };
      }
      return userMap[slackUserId];
    };

    for (const task of activeTasks) {
      const entry = getOrCreateUserEntry(task.assigned_to, task.team);
      if (entry) entry.tasks.push(task);
    }

    for (const issue of activeIssues) {
      const entry = getOrCreateUserEntry(issue.assigned_to, issue.team);
      if (entry) entry.issues.push(issue);
    }

    let totalDelivered = 0;

    // 4. Dispatch Personalized Briefings
    for (const [slackUserId, userData] of Object.entries(userMap)) {
      if (userId && slackUserId !== userId) continue;

      const blockedTasks = userData.tasks.filter((t) => t.status === 'BLOCKED');
      const pendingTasks = userData.tasks.filter((t) => t.status === 'PROCESSING' || t.status === 'TODO');
      const completedTasks = userData.tasks.filter((t) => t.status === 'COMPLETED');

      const holdIssues = userData.issues.filter((i) => i.status === 'HOLD');
      const openIssues = userData.issues.filter((i) => i.status === 'OPEN');
      const resolvedIssues = userData.issues.filter((i) => i.status === 'RESOLVED');

      if (
        blockedTasks.length === 0 &&
        pendingTasks.length === 0 &&
        completedTasks.length === 0 &&
        holdIssues.length === 0 &&
        openIssues.length === 0 &&
        resolvedIssues.length === 0
      ) {
        continue;
      }

      const firstName = userData.name.split(' ')[0];

      let messageText = `👋 *Hi ${firstName}!*\n`;
      messageText += `Here is your status summary for the *${userData.team}* daily standup meeting (${meetingTime}):\n\n`;

      // 🚨 Blocked & On Hold
      if (blockedTasks.length > 0 || holdIssues.length > 0) {
        messageText += `🚨 *BLOCKED / ON HOLD:*\n`;
        blockedTasks.forEach((t) => {
          messageText += `• 📋 *[Task]* *${t.title}*\n`;
          if (t.blocked_reason) messageText += `   ↳ _Reason: ${t.blocked_reason}_\n`;
        });
        holdIssues.forEach((i) => {
          messageText += `• 🐛 *[Issue]* *${i.title}* [ON HOLD]\n`;
          if (i.blocked_reason) messageText += `   ↳ _Reason: ${i.blocked_reason}_\n`;
        });
        messageText += `\n`;
      }

      // ⏳ Active & Open
      if (pendingTasks.length > 0 || openIssues.length > 0) {
        messageText += `⏳ *IN PROGRESS / OPEN:*\n`;
        pendingTasks.forEach((t) => {
          messageText += `• 📋 *[Task]* ${t.title} [Status: ${t.status}]\n`;
        });
        openIssues.forEach((i) => {
          messageText += `• 🐛 *[Issue]* ${i.title} [Status: OPEN]\n`;
        });
        messageText += `\n`;
      }

      // ✅ Recently Completed / Resolved
      if (completedTasks.length > 0 || resolvedIssues.length > 0) {
        messageText += `✅ *RESOLVED / COMPLETED (Last ${lookbackHours}h):*\n`;
        completedTasks.forEach((t) => {
          messageText += `• 📋 *[Task]* ~${t.title}~ — *COMPLETED*\n`;
        });
        resolvedIssues.forEach((i) => {
          messageText += `• 🐛 *[Issue]* ~${i.title}~ — *RESOLVED*\n`;
        });
        messageText += `\n`;
      }

      messageText += `👉 _Please sync your updates before starting the meeting._`;

      await client.chat.postMessage({
        channel: slackUserId,
        text: messageText,
        mrkdwn: true,
      });

      totalDelivered++;
      console.log(`✅ Standup briefing delivered to ${userData.name} (${slackUserId})`);
    }

    return { success: true, count: totalDelivered };
  } catch (error) {
    console.error('❌ [Standup Briefings Error]:', error.message);
    throw error;
  }
}

// ⏰ Dynamic Cron Schedule (Defaults to 10:00 AM daily or uses STANDUP_CRON_SCHEDULE from .env)
const cronSchedule = process.env.STANDUP_CRON_SCHEDULE || '0 10 * * *';
cron.schedule(cronSchedule, async () => {
  await sendDailyStandupBriefings();
});

module.exports = {
  sendDailyStandupBriefings,
};