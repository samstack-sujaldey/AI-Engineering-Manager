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
  // ⏰ Runs strictly at 10:00 AM daily (TZ is set to Asia/Kolkata)
  cron.schedule("0 10 * * *", async () => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0: Sun, 6: Sat

    // 🟢 1. Weekend Skip Guard
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`[StandupScheduler] 🛑 Weekend detected (${dayOfWeek === 0 ? "Sunday" : "Saturday"}). Skipping stand-up summary generation.`);
      return;
    }

    const targetDateStr = getTargetSummaryDate(now);
    console.log(`[StandupScheduler] ⏰ 10:00 AM reached. Pre-caching standup summary for business date: ${targetDateStr}...`);

    try {
      const [reqYear, reqMonth, reqDay] = targetDateStr.split("-").map(Number);
      const startOfDay = new Date(reqYear, reqMonth - 1, reqDay, 0, 0, 0, 0);
      const endOfDay = new Date(reqYear, reqMonth - 1, reqDay, 23, 59, 59, 999);

      // 🟢 2. Workspace-wide summary
      try {
        await generateAndCacheSummary(null, targetDateStr, startOfDay, endOfDay);
      } catch (err) {
        console.error(`[StandupScheduler] ❌ Failed workspace-wide summary for ${targetDateStr}:`, err.message);
      }

      // 🟢 3. Channel-specific summaries
      const teams = await Team.find({}).lean();
      for (const team of teams) {
        if (!team.channel_id) continue;
        try {
          await generateAndCacheSummary(team.channel_id, targetDateStr, startOfDay, endOfDay);
        } catch (err) {
          console.error(`[StandupScheduler] ❌ Failed summary for channel ${team.channel_id} on ${targetDateStr}:`, err.message);
        }
      }

      console.log(`[StandupScheduler] ✅ Finished pre-caching stand-up summaries for ${targetDateStr}.`);
    } catch (err) {
      console.error("[StandupScheduler Error]:", err.message);
    }
  });

  console.log("[StandupScheduler] 🕒 Initialized 10:00 AM daily stand-up background caching job (Mon-Fri).");
}

async function generateAndCacheSummary(channel, requestedDateStr, startOfDay, endOfDay) {
  const [reqYear, reqMonth, reqDay] = requestedDateStr.split("-").map(Number);
  const displayDateStr = `${String(reqDay).padStart(2, "0")}.${String(reqMonth).padStart(2, "0")}.${String(reqYear).slice(2)}`;

  const taskBaseFilter = {
    $or: [
      { created_time: { $gte: startOfDay, $lte: endOfDay } },
      { updated_time: { $gte: startOfDay, $lte: endOfDay } },
      { due_date: { $gte: startOfDay, $lte: endOfDay } },
    ],
  };
  const issueBaseFilter = {
    $or: [
      { created_time: { $gte: startOfDay, $lte: endOfDay } },
      { updated_time: { $gte: startOfDay, $lte: endOfDay } },
    ],
  };

  if (channel) {
    taskBaseFilter.channel = channel;
    issueBaseFilter.channel = channel;
  }

  const [tasks, issues] = await Promise.all([
    Task.find(taskBaseFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
    Issue.find(issueBaseFilter, "title status priority blocked_reason assigned_to owner").lean().catch(() => []),
  ]);

  const memberNames = [];
  const seenNames = new Set();
  const addMember = (name) => {
    const clean = normalizePersonName(name);
    if (clean && clean !== "Unassigned" && !seenNames.has(clean)) {
      seenNames.add(clean);
      memberNames.push(clean);
    }
  };
  for (const t of tasks) addMember(t.assigned_to?.name || t.owner?.name);
  for (const i of issues) addMember(i.assigned_to?.name || i.owner?.name);
  const presentMembers = memberNames.length > 0 ? memberNames.join(", ") : "—";
  const duration = process.env.STANDUP_DURATION || "15 Minutes";

  const momHeader = `Hi Everyone, please find Today Stand-up MOM

Date: ${displayDateStr}
Duration: ${duration}
Present Members: ${presentMembers}
Team-wise Task Updates`;

  let summaryText = "";
  let generatedBy = "fallback";

  if (!tasks.length && !issues.length) {
    summaryText = `${momHeader}\nNo activities recorded for date (${displayDateStr}).`;
  } else {
    const prompt = `You are an AI Engineering Manager writing a Stand-up Minutes of Meeting (MOM) for ${displayDateStr}.

Format the output EXACTLY like this template (keep this exact structure and header — do not add or remove header lines):

Hi Everyone, please find Today Stand-up MOM
Date: ${displayDateStr}
Duration: ${duration}
Present Members: ${presentMembers}
Team-wise Task Updates

**[Member Name]**
* Natural, complete-sentence bullet describing what they did, are working on, or are blocked by — written like a real human standup note, not "Task: X, Status: Y".

**[Next Member Name]**
* ...

INSTRUCTIONS:
1. Group strictly by team member — one section per name listed in "Present Members" above, in that order. Wrap each member's name in ** ** exactly as shown, on its own line.
2. Write each bullet as a natural sentence, not a mechanical field dump.
3. If an item has a blocked reason, weave it naturally into that bullet's sentence.
4. Do not invent work that isn't in the data below — only phrase what's given more naturally, don't add facts.
5. Skip a member's section entirely if they have no activity today.

Data for ${requestedDateStr}:
Tasks: ${JSON.stringify(tasks.map((t) => ({ member: normalizePersonName(t.assigned_to?.name || t.owner?.name || "Unassigned"), title: t.title, status: t.status, blocker: t.blocked_reason })))}
Issues: ${JSON.stringify(issues.map((i) => ({ member: normalizePersonName(i.assigned_to?.name || i.owner?.name || "Unassigned"), title: i.title, status: i.status, blocker: i.blocked_reason })))}`;

    try {
      summaryText = await callOpenAI([{ role: "user", content: prompt }], {
        maxTokens: 900,
        temperature: 0.3,
      });

      if (summaryText && summaryText.trim()) {
        generatedBy = "ai";
        console.log(`[StandupScheduler] ✅ AI summary generated for ${requestedDateStr}${channel ? ` (channel: ${channel})` : " (workspace-wide)"}`);
      } else {
        console.warn(`[StandupScheduler] ⚠️ callOpenAI returned empty for ${requestedDateStr}${channel ? ` (channel: ${channel})` : " (workspace-wide)"} — using deterministic fallback.`);
      }
    } catch (aiErr) {
      console.error(`[StandupScheduler] ❌ callOpenAI threw for ${requestedDateStr}${channel ? ` (channel: ${channel})` : " (workspace-wide)"}:`, aiErr.message);
      summaryText = "";
    }

    if (!summaryText || !summaryText.trim()) {
      const byMember = {};
      const pushItem = (name, line) => {
        const key = name || "Unassigned";
        if (!byMember[key]) byMember[key] = [];
        byMember[key].push(line);
      };
      for (const t of tasks) {
        const name = normalizePersonName(t.assigned_to?.name || t.owner?.name || "Unassigned");
        const status = t.status ? ` [${t.status}]` : "";
        pushItem(name, `${t.title}${status}${t.blocked_reason ? ` — blocked: ${t.blocked_reason}` : ""}`);
      }
      for (const i of issues) {
        const name = normalizePersonName(i.assigned_to?.name || i.owner?.name || "Unassigned");
        const status = i.status ? ` [${i.status}]` : "";
        pushItem(name, `${i.title}${status}${i.blocked_reason ? ` — blocked: ${i.blocked_reason}` : ""}`);
      }

      let body = "";
      for (const [name, lines] of Object.entries(byMember)) {
        body += `\n**${name}**\n`;
        for (const line of lines) body += `* ${line}\n`;
      }

      summaryText = `${momHeader}\n${body}`;
    }
  }

  // 🟢 Fixed: Align cacheKey with routes/api.js lookup
  const cacheKey = channel ? { date: requestedDateStr, channel } : { date: requestedDateStr, channel: null };
  await DailySummary.findOneAndUpdate(
    cacheKey,
    {
      summary: summaryText.trim(),
      tasks_count: tasks.length,
      issues_count: issues.length,
      discussions_count: 0,
      is_stale: false,
      generated_by: generatedBy,
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

module.exports = { startStandupScheduler, getTargetSummaryDate };