const cron = require('node-cron');
const { Task, Issue } = require('../models');
const { createSlackClient } = require('../services/slackSync');

async function openDirectMessageChannel(client, slackUserId) {
  try {
    const result = await client.conversations.open({ users: slackUserId });
    return result.channel?.id || slackUserId;
  } catch (error) {
    if (error.data?.error === 'user_not_found') {
      return null;
    }
    throw error;
  }
}

/**
 * Safely send a briefing to a single user via Slack DM.
 * Opens an IM conversation first, then delivers the message.
 */
async function sendBriefingToUser(client, slackUserId, messageText) {
  try {
    const dmChannelId = await openDirectMessageChannel(client, slackUserId);

    if (!dmChannelId) {
      return { success: false, error: 'user_not_found' };
    }

    await client.chat.postMessage({
      channel: dmChannelId,
      text: messageText,
      mrkdwn: true,
    });

    return { success: true };
  } catch (error) {
    if (error.data?.error !== 'user_not_found') {
      console.error(`❌ [Standup Briefing] Failed to deliver to ${slackUserId}:`, error.message);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Dynamically send standup briefings aligned with Task and Issue model enums.
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

    // 1. Build Filters aligned with Task Schema enums: ['TODO', 'PROCESSING', 'COMPLETED', 'BLOCKED'][cite: 9]
    const taskFilter = {
      $or: [
        { status: { $in: ['TODO', 'PROCESSING', 'BLOCKED'] } },
        { status: 'COMPLETED', updated_time: { $gte: lookbackDate } },
      ],
    };

    // 2. Build Filters aligned with Issue Schema enums: ['OPEN', 'HOLD', 'RESOLVED'][cite: 7]
    const issueFilter = {
      $or: [
        { status: { $in: ['OPEN', 'HOLD'] } },
        { status: 'RESOLVED', updated_time: { $gte: lookbackDate } },
      ],
    };

    if (team) {
      taskFilter.team = team;
      issueFilter.team = team;
    }

    if (userId) {
      taskFilter['assigned_to.id'] = userId;
      issueFilter['assigned_to.id'] = userId;
    }

    const [activeTasks, activeIssues] = await Promise.all([
      Task.find(taskFilter).lean(),
      Issue.find(issueFilter).lean(),
    ]);

    if ((!activeTasks || activeTasks.length === 0) && (!activeIssues || activeIssues.length === 0)) {
      console.log('ℹ️ [Standup Briefings] No matching tasks or issues found for this query.');
      return { success: true, count: 0, message: 'No active or recent tasks found.' };
    }

    // Fetch active users from Slack workspace to map old/stale database IDs dynamically
    let workspaceMembers = [];
    try {
      const membersResult = await client.users.list({ limit: 200 });
      console.log(
        "Workspace Users:",
        workspaceMembers.map(m => ({
          id: m.id,
          username: m.name,
          display: m.profile?.display_name,
          real: m.real_name
        }))
      );
      if (membersResult.ok && membersResult.members) {
        workspaceMembers = membersResult.members.filter(m => !m.deleted && !m.is_bot);
      }
    } catch (wsErr) {
      console.warn('⚠️ [Slack Sync] Could not fetch workspace members list:', wsErr.message);
    }

    const userMap = {};

    const getOrCreateUserEntry = (userRef, itemTeam) => {
      let slackUserId = userRef?.id;
      if (!slackUserId || slackUserId === 'Unassigned') return null;

      // Smart Resolution: If ID is invalid, try matching via email, username, or display name from model
      const foundInWorkspace = workspaceMembers.find(m => m.id === slackUserId);
      if (!foundInWorkspace && workspaceMembers.length > 0) {
        const matchedByEmail = userRef.email && workspaceMembers.find(m => m.profile?.email?.toLowerCase() === userRef.email.toLowerCase());
        const matchedByName = workspaceMembers.find(m =>
          (userRef.name && m.name?.toLowerCase() === userRef.name?.toLowerCase()) ||
          (userRef.name && m.real_name?.toLowerCase() === userRef.name?.toLowerCase()) ||
          (userRef.display_name && m.profile?.display_name?.toLowerCase() === userRef.display_name?.toLowerCase())
        );

        if (matchedByEmail) {
          slackUserId = matchedByEmail.id;
        } else if (matchedByName) {
          slackUserId = matchedByName.id;
          console.log(`🔄 [User Resolution] Automatically mapped database user "${userRef.name || userRef.display_name}" to active Slack ID: ${slackUserId}`);
        } else {
          return null;
        }
      }

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

    // 3. Dispatch Personalized Briefings directly via Slack DM
    for (const [slackUserId, userData] of Object.entries(userMap)) {
      if (userId && slackUserId !== userId) continue;

      if (slackUserId === 'USLACKBOT' || slackUserId.startsWith('B')) {
        continue;
      }

      const blockedTasks = userData.tasks.filter((t) => t.status === 'BLOCKED');
      const pendingTasks = userData.tasks.filter((t) => t.status === 'TODO' || t.status === 'PROCESSING');
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

      if (pendingTasks.length > 0 || openIssues.length > 0) {
        messageText += `⏳ *IN PROGRESS / OPEN:*\n`;
        pendingTasks.forEach((t) => {
          messageText += `• 📋 *[Task]* ${t.title} [Status: ${t.status}]\n`;
        });
        openIssues.forEach((i) => {
          messageText += `• 🐛 *[Issue]* ${i.title} [Status: ${i.status}]\n`;
        });
        messageText += `\n`;
      }

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

      const deliveryResult = await sendBriefingToUser(client, slackUserId, messageText);
      if (deliveryResult.success) {
        totalDelivered++;
        console.log(`✅ Standup briefing delivered to ${userData.name} (${slackUserId})`);
      }
    }

    return { success: true, count: totalDelivered };
  } catch (error) {
    console.error('❌ [Standup Briefings Error]:', error.message);
    throw error;
  }
}

const cronSchedule = process.env.STANDUP_CRON_SCHEDULE ||' 00 10 * * * ';
cron.schedule(cronSchedule, async () => {
  try {
    await sendDailyStandupBriefings();
  } catch (error) {
    console.error('❌ [Cron] Unhandled error in daily standup briefing job:', error.message);
  }
});

module.exports = {
  sendDailyStandupBriefings,
  sendBriefingToUser,
  openDirectMessageChannel,
};
