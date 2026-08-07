const { Task, Issue, Notification } = require("../models");
const { similarity } = require("../utils/helpers");
const config = require("../config");

async function findSimilarTask(
	title,
	description,
	workspaceId,
	channel,
	customThreshold = null,
) {
	const filter = {};
	if (workspaceId) filter.workspace_id = workspaceId;
	if (channel) filter.channel = channel;

	// Only check active (non-completed) tasks to speed up similarity matching
	filter.status = { $ne: "COMPLETED" };

	const candidates = await Task.find(filter)
		.sort({ updated_time: -1 })
		.limit(30)
		.lean();

	let best = null;
	let bestScore = 0;
	const probe = `${title} ${description || ""}`;

	for (const task of candidates) {
		const score = Math.max(
			similarity(probe, task.title),
			similarity(probe, `${task.title} ${task.description || ""}`),
		);
		if (score > bestScore) {
			bestScore = score;
			best = task;
		}
	}

	const threshold =
		customThreshold !== null ? customThreshold : config.similarityThreshold;
	if (best && bestScore >= threshold) {
		return { task: best, score: bestScore };
	}
	return null;
}

async function findSimilarIssue(
	title,
	description,
	workspaceId,
	channel,
	customThreshold = null,
	userId = null, // 🟢 ADDED: Pass the user ID to check for same-person rule
) {
	const filter = {};
	if (workspaceId) filter.workspace_id = workspaceId;
	if (channel) filter.channel = channel;

	filter.status = { $ne: "RESOLVED" };

	// 🟢 FIX: Apply "Same User, Same Day" Rule
	if (userId) {
		// Only check issues owned by this specific person
		filter["owner.id"] = userId;

		
		// 🟢 FIX: Use robust UTC-anchored or generalized day boundaries to prevent server drift
		const now = new Date();
		const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
		const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

		
		filter.created_time = { $gte: startOfDay, $lte: endOfDay };
	}

	const candidates = await Issue.find(filter)
		.sort({ updated_time: -1 })
		.limit(30)
		.lean();

	let best = null;
	let bestScore = 0;
	const probe = `${title} ${description || ""}`;

	for (const issue of candidates) {
		const score = Math.max(
			similarity(probe, issue.title),
			similarity(probe, `${issue.title} ${issue.description || ""}`),
		);
		if (score > bestScore) {
			bestScore = score;
			best = issue;
		}
	}

	const threshold =
		customThreshold !== null ? customThreshold : config.similarityThreshold;
	if (best && bestScore >= threshold) {
		return { issue: best, score: bestScore };
	}
	return null;
}

async function findWorkByThread(thread, channel) {
	if (!thread) return { task: null, issue: null };
	let [task, issue] = await Promise.all([
		Task.findOne({ thread, channel }).sort({ updated_time: -1 }).lean(),
		Issue.findOne({ thread, channel }).sort({ updated_time: -1 }).lean(),
	]);

	if (!task && !issue) {
		const notif = await Notification.findOne({
			slack_dm_ts: thread,
		}).lean();
		if (notif) {
			if (notif.task_id)
				task = await Task.findOne({ task_id: notif.task_id }).lean();
			if (notif.issue_id)
				issue = await Issue.findOne({
					issue_id: notif.issue_id,
				}).lean();
		}
	}

	return { task, issue };
}

async function findWorkByMessageTs(messageTs, channel) {
	if (!messageTs) return { task: null, issue: null };
	const filter = { slack_message_ts: messageTs };
	if (channel) filter.channel = channel;
	let [task, issue] = await Promise.all([
		Task.findOne(filter).lean(),
		Issue.findOne(filter).lean(),
	]);

	if (!task && !issue) {
		const notif = await Notification.findOne({
			slack_dm_ts: messageTs,
		}).lean();
		if (notif) {
			if (notif.task_id)
				task = await Task.findOne({ task_id: notif.task_id }).lean();
			if (notif.issue_id)
				issue = await Issue.findOne({
					issue_id: notif.issue_id,
				}).lean();
		}
	}

	return { task, issue };
}

module.exports = {
	findSimilarTask,
	findSimilarIssue,
	findWorkByThread,
	findWorkByMessageTs,
};
