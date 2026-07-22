// src/inngest/issueResolverAgent.js
const { inngest } = require('./client');
const { Task, Issue } = require('../models');
const { callOpenRouter } = require('../ai/gemini');
const { NotificationService } = require('../services/notifications');

const notificationService = new NotificationService();

const issueResolverAgent = inngest.createFunction(
  {
    id: 'issue-resolver-agent',
    triggers: [{ event: 'issue/created' }],
  },
  async ({ event, step }) => {
    const { issueId } = event.data;
    console.log(`[Inngest Agent] Received trigger for issueId: ${issueId}`);

    // 1. Fetch Issue from Mongo
    const issue = await step.run('fetch-issue', async () => {
      const found = await Issue.findOne({ issue_id: issueId }).lean();
      return found || (await Issue.findById(issueId).lean());
    });

    if (!issue) {
      console.log(`[Inngest Agent] ⚠️ Issue document not found for ID: ${issueId}`);
      return { skipped: true, reason: 'Issue not found' };
    }

    console.log(`[Inngest Agent] Found issue "${issue.title}". Running AI cause analysis...`);

    // 2. Analyze Cause and Match Related Task using AI
    const analysis = await step.run('analyze-cause-and-task', async () => {
      const activeTasks = await Task.find({
        status: { $in: ['TODO', 'PROCESSING', 'BLOCKED'] },
      }).limit(20).lean();

      const prompt = `
You are an AI Engineering Manager. Analyze this issue to find its root cause and identify which active task it is related to.

Issue Title: ${issue.title}
Issue Description: ${issue.description}

Active Tasks List:
${JSON.stringify(activeTasks.map(t => ({ id: t.task_id, title: t.title, owner: t.assigned_to?.name || t.owner?.name })))}

Return ONLY a JSON object:
{
  "root_cause": "concise description of why this happened",
  "related_task_id": "matching task_id or null",
  "suggested_timeframe": "suggested resolution timeline"
}
`;

      // ⚡ Increased maxTokens to 1000 to prevent OpenRouter models from cutting off JSON output
      const rawResponse = await callOpenRouter(
        [{ role: 'user', content: prompt }], 
        { maxTokens: 1000, temperature: 0.1 }
      );

      try {
        const cleaned = rawResponse.replace(/```(?:json)?/g, '').trim();
        return JSON.parse(cleaned);
      } catch {
        return {
          root_cause: issue.description || 'Unspecified technical issue',
          related_task_id: null,
          suggested_timeframe: '1-2 days',
        };
      }
    });

    // 3. Save root cause back to DB
    await step.run('save-issue-analysis', async () => {
      await Issue.updateOne(
        { issue_id: issue.issue_id },
        {
          $set: {
            root_cause: analysis.root_cause,
            related_task: analysis.related_task_id,
          },
        }
      );
    });

    // 4. Send Slack DM asking for resolution time
    await step.run('send-slack-dm', async () => {
      const targetUserId = issue.assigned_to?.id || issue.owner?.id;
      if (!targetUserId) {
        console.log('[Inngest Agent] No assigned user ID found to send Slack DM.');
        return;
      }

      const message = 
        `🐞 *Issue Tracking Alert*\n` +
        `An issue "*${issue.title}*" was logged.\n` +
        `> *Cause:* ${analysis.root_cause}\n` +
        `> *Suggested Timeframe:* ${analysis.suggested_timeframe}\n\n` +
        `Could you please reply with when you will have time to discuss or resolve this?`;

      await notificationService.createAndSend({
        type: 'MISSING_BLOCK_REASON',
        target_user_id: targetUserId,
        target_user_name: issue.assigned_to?.name || 'Developer',
        message,
        issue_id: issue.issue_id,
        task_id: analysis.related_task_id,
      });
    });

    return { success: true, issueId: issue.issue_id };
  }
);

module.exports = { issueResolverAgent };