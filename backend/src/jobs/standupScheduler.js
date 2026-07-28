const cron = require("node-cron");
const { Task, Issue, Team } = require("../models");
const DailySummary = require("../models/DailySummary");
const { callOpenAI } = require("../ai/openai");
const { normalizePersonName } = require("../agent/parser");

/**
 * Calculates target business date:
 * If today is Monday, target Friday (-3 days).
 * If Sunday, target Friday (-2 days).
 * If Saturday, target Friday (-1 day).
 * Otherwise, target yesterday.
 */
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
  // ⏰ Runs strictly at 10:00 AM every day
  cron.schedule("53 17 * * *", async () => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0: Sun, 6: Sat

    // 🟢 CONDITION: Skip execution entirely on Saturday (6) and Sunday (0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`[StandupScheduler] 🛑 Weekend (${dayOfWeek === 0 ? 'Sunday' : 'Saturday'}). Skipping daily stand-up caching.`);
      return;
    }

    // 🟢 CONDITION: On Monday, getTargetSummaryDate automatically picks Friday (-3 days)
    const targetDateStr = getTargetSummaryDate(now);
    console.log(`[StandupScheduler] ⏰ 10:00 AM job started. Pre-caching for target business date: ${targetDateStr}...`);

    try {
      const [reqYear, reqMonth, reqDay] = targetDateStr.split("-").map(Number);
      const startOfDay = new Date(reqYear, reqMonth - 1, reqDay, 0, 0, 0, 0);
      const endOfDay = new Date(reqYear, reqMonth - 1, reqDay, 23, 59, 59, 999);

      // 1. Generate & Cache Workspace-Wide Summary
      await generateAndCacheSummary(null, targetDateStr, startOfDay, endOfDay);

      // 2. Generate & Cache Summary for Each Active Team Channel
      const teams = await Team.find({}).lean();
      for (const team of teams) {
        if (team.channel_id) {
          await generateAndCacheSummary(team.channel_id, targetDateStr, startOfDay, endOfDay);
        }
      }

      console.log(`[StandupScheduler] ✅ Pre-caching complete for ${targetDateStr}.`);
    } catch (err) {
      console.error("[StandupScheduler Error]:", err.message);
    }
  });

  console.log("[StandupScheduler] 🕒 Initialized 10:00 AM daily caching scheduler (Mon-Fri only).");
}

async function generateAndCacheSummary(channel, targetDateStr, startOfDay, endOfDay) {
  // Build query filters for DB tasks and issues
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

  if (channel) {
    taskFilter.channel = channel;
    issueFilter.channel = channel;
  }

  // 1. Fetch from DB
  const [tasks, issues] = await Promise.all([
    Task.find(taskFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
    Issue.find(issueFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
  ]);

  let summaryText = "";
  let generatedBy = "fallback";

  // 2. Parse via OpenAI if records exist
  if (tasks.length || issues.length) {
    const prompt = `You are an AI Engineering Manager writing a Stand-up Minutes of Meeting (MOM) for date: ${targetDateStr}.
Format output grouped strictly by team member with natural bullet points detailing their tasks, issues, or blockers.

Tasks: ${JSON.stringify(tasks)}
Issues: ${JSON.stringify(issues)}`;

    try {
      summaryText = await callOpenAI([{ role: "user", content: prompt }], { maxTokens: 900, temperature: 0.3 });
      if (summaryText && summaryText.trim()) generatedBy = "ai";
    } catch (aiErr) {
      console.error(`[StandupScheduler] OpenAI formatting failed for ${targetDateStr}, using fallback.`);
    }
  }

  // Fallback summary if OpenAI fails or no activity recorded
  if (!summaryText || !summaryText.trim()) {
    summaryText = `Hi Everyone, please find Today Stand-up MOM\n\nDate: ${targetDateStr}\n` +
      (tasks.length || issues.length 
        ? `Tasks (${tasks.length}), Issues (${issues.length}) recorded.` 
        : `No activities recorded for date (${targetDateStr}).`);
  }

  // 3. Cache directly into MongoDB for instant lookups
  const cacheKey = channel ? { date: targetDateStr, channel } : { date: targetDateStr, $or: [{ channel: null }, { channel: "" }] };
  
  await DailySummary.findOneAndUpdate(
    cacheKey,
    {
      date: targetDateStr,
      channel: channel || null,
      summary: summaryText.trim(),
      tasks_count: tasks.length,
      issues_count: issues.length,
      is_stale: false,
      generated_by: generatedBy,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

module.exports = { startStandupScheduler, getTargetSummaryDate };