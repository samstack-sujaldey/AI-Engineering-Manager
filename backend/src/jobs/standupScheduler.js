const cron = require("node-cron");
const { Task, Issue, Discussion, Team } = require("../models");
const DailySummary = require("../models/DailySummary");
const { callOpenAI } = require("../ai/openai");
const { normalizePersonName } = require("../agent/parser");

function getTargetSummaryDate(date = new Date()) {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat

  if (dayOfWeek === 1) {
    d.setDate(d.getDate() - 3); // Monday -> Friday
  } else if (dayOfWeek === 0) {
    d.setDate(d.getDate() - 2); // Sunday -> Friday
  } else if (dayOfWeek === 6) {
    d.setDate(d.getDate() - 1); // Saturday -> Friday
  } else {
    d.setDate(d.getDate() - 1); // Tue-Fri -> Yesterday
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startStandupScheduler() {
  // ⏰ Runs strictly at 10:00 AM daily
  cron.schedule("12 10 * * *", async () => {
    const now = new Date();
    const dayOfWeek = now.getDay();

    // Skip Saturday and Sunday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`[StandupScheduler] 🛑 Weekend. Skipping stand-up summary generation.`);
      return;
    }

    const targetDateStr = getTargetSummaryDate(now);
    console.log(`[StandupScheduler] ⏰ Running 10:00 AM job for target date: ${targetDateStr}...`);

    try {
      const [reqYear, reqMonth, reqDay] = targetDateStr.split("-").map(Number);
      const startOfDay = new Date(reqYear, reqMonth - 1, reqDay, 0, 0, 0, 0);
      const endOfDay = new Date(reqYear, reqMonth - 1, reqDay, 23, 59, 59, 999);

      // 1. Workspace-wide summary
      await generateAndCacheSummary(null, targetDateStr, startOfDay, endOfDay);

      // 2. Channel-specific summaries
      const teams = await Team.find({}).lean();
      for (const team of teams) {
        if (team.channel_id) {
          await generateAndCacheSummary(team.channel_id, targetDateStr, startOfDay, endOfDay);
        }
      }

      console.log(`[StandupScheduler] ✅ Finished pre-caching for ${targetDateStr}.`);
    } catch (err) {
      console.error("[StandupScheduler Error]:", err.message);
    }
  });

  console.log("[StandupScheduler] 🕒 Initialized 10:00 AM daily job.");
}

async function generateAndCacheSummary(channel, targetDateStr, startOfDay, endOfDay) {
  const [reqYear, reqMonth, reqDay] = targetDateStr.split("-").map(Number);
  const displayDateStr = `${String(reqDay).padStart(2, "0")}.${String(reqMonth).padStart(2, "0")}.${String(reqYear).slice(2)}`;
  const duration = process.env.STANDUP_DURATION || "15 Minutes";

  // Build filters for Tasks, Issues, and Discussions
  const taskFilter = {
    $or: [
      { created_time: { $gte: startOfDay, $lte: endOfDay } },
      { updated_time: { $gte: startOfDay, $lte: endOfDay } },
      { due_date: { $gte: startOfDay, $lte: endOfDay } },
    ],
  };
  const issueFilter = {
    $or: [
      { created_time: { $gte: startOfDay, $lte: endOfDay } },
      { updated_time: { $gte: startOfDay, $lte: endOfDay } },
    ],
  };
  const discussionFilter = {
    timestamp: { $gte: startOfDay, $lte: endOfDay },
  };

  if (channel) {
    taskFilter.channel = channel;
    issueFilter.channel = channel;
    discussionFilter.channel = channel;
  }

  // 🟢 OPTIMIZATION #2: Field projections + .lean() queries run in parallel
  const [tasks, issues, discussions] = await Promise.all([
    Task.find(taskFilter, {
      title: 1,
      status: 1,
      priority: 1,
      blocked_reason: 1,
      "assigned_to.name": 1,
      "owner.name": 1,
      _id: 0,
    })
      .lean()
      .catch(() => []),
    Issue.find(issueFilter, {
      title: 1,
      status: 1,
      priority: 1,
      blocked_reason: 1,
      "assigned_to.name": 1,
      "owner.name": 1,
      _id: 0,
    })
      .lean()
      .catch(() => []),
    Discussion.find(discussionFilter, {
      content: 1,
      "author.name": 1,
      _id: 0,
    })
      .lean()
      .catch(() => []),
  ]);

  // Group records by Individual
  const memberDataMap = {};
  const getMemberGroup = (rawName) => {
    const cleanName = normalizePersonName(rawName) || "Unassigned";
    if (!memberDataMap[cleanName]) {
      memberDataMap[cleanName] = { tasks: [], issues: [], discussions: [] };
    }
    return memberDataMap[cleanName];
  };

  for (const t of tasks) getMemberGroup(t.assigned_to?.name || t.owner?.name).tasks.push(t);
  for (const i of issues) getMemberGroup(i.assigned_to?.name || i.owner?.name).issues.push(i);
  for (const d of discussions) getMemberGroup(d.author?.name).discussions.push(d);

  const momHeader = `Hi Everyone, please find Today Stand-up MOM\n\nDate: ${displayDateStr}\nDuration: ${duration}\nTeam-wise Task Updates`;

  let summaryText = "";

  if (!Object.keys(memberDataMap).length) {
    summaryText = `${momHeader}\n\nNo activities recorded for date (${displayDateStr}).`;
  } else {
    // Construct single, compact raw payload for the entire team
    let rawPayload = "";
    for (const [memberName, data] of Object.entries(memberDataMap)) {
      rawPayload += `\nMember: ${memberName}\n`;
      if (data.tasks.length) {
        rawPayload += `Tasks:\n` + data.tasks.map(t => `- ${t.title} [${t.status || 'TODO'}]${t.blocked_reason ? ` (Blocker: ${t.blocked_reason})` : ''}`).join('\n') + '\n';
      }
      if (data.issues.length) {
        rawPayload += `Issues:\n` + data.issues.map(i => `- ${i.title} [${i.status || 'OPEN'}]${i.blocked_reason ? ` (Blocker: ${i.blocked_reason})` : ''}`).join('\n') + '\n';
      }
      if (data.discussions.length) {
        rawPayload += `Discussions:\n` + data.discussions.map(d => `- ${d.content}`).join('\n') + '\n';
      }
    }

    // Single-pass OpenAI formatting call
    const prompt = `You are an AI Engineering Manager. Format this aggregated raw standup data into a clean Stand-up MOM string.

INSTRUCTIONS:
1. Include this EXACT header at the top:
${momHeader}

2. Group strictly by member name using bold headers (**Member Name**).
3. Under each member, format every task, issue, and discussion as bullet points (* ).
4. ONLY include an "Issues:" subsection under a member if they have issues logged. If no issues exist for a member, omit the Issues subsection completely.
5. Do NOT add a "Present Members" line.
6. Write each bullet as a natural, concise sentence.

Raw Team Work Data:
${rawPayload}`;

    try {
      const aiFormatted = await callOpenAI([{ role: "user", content: prompt }], {
        maxTokens: 800,
        temperature: 0.2,
      });

      if (aiFormatted && aiFormatted.trim()) {
        summaryText = aiFormatted.trim();
      } else {
        throw new Error("OpenAI returned empty response");
      }
    } catch (aiErr) {
      console.warn(`[StandupScheduler] OpenAI single-pass failed: ${aiErr.message}. Using structured DB output directly.`);

      let fallbackBody = "";
      for (const [memberName, data] of Object.entries(memberDataMap)) {
        fallbackBody += `\n**${memberName}**\n`;
        for (const t of data.tasks) fallbackBody += `* ${t.title}${t.status ? ` [${t.status}]` : ''}${t.blocked_reason ? ` 🚨 Blocker: ${t.blocked_reason}` : ''}\n`;
        if (data.issues.length > 0) {
          fallbackBody += `  Issues:\n`;
          for (const i of data.issues) fallbackBody += `  * ${i.title}${i.status ? ` [${i.status}]` : ''}${i.blocked_reason ? ` 🚨 Blocker: ${i.blocked_reason}` : ''}\n`;
        }
        for (const d of data.discussions) fallbackBody += `* Discussion: ${d.content}\n`;
      }
      summaryText = `${momHeader}\n${fallbackBody}`;
    }
  }

  // Cache final document into MongoDB
  const cacheKey = channel ? { date: targetDateStr, channel } : { date: targetDateStr, $or: [{ channel: null }, { channel: "" }] };

  await DailySummary.findOneAndUpdate(
    cacheKey,
    {
      date: targetDateStr,
      channel: channel || null,
      summary: summaryText.trim(),
      tasks_count: tasks.length,
      issues_count: issues.length,
      discussions_count: discussions.length,
      is_stale: false,
      generated_by: "single_pass_ai",
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

module.exports = { startStandupScheduler, getTargetSummaryDate };