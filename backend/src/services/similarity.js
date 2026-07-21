const { Task, Issue, Notification } = require("../models");
const { similarity } = require("../utils/helpers");
const config = require("../config");

async function findSimilarTask(title, description, workspaceId, channel) {
	const filter = {};
	if (workspaceId) filter.workspace_id = workspaceId;
	if (channel) filter.channel = channel;

	const candidates = await Task.find({
		...filter,
		status: { $ne: "COMPLETED" },
	})
		.sort({ updated_time: -1 })
		.limit(50)
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

	if (best && bestScore >= config.similarityThreshold) {
		return { task: best, score: bestScore };
	}
	return null;
}

async function findSimilarIssue(title, description, workspaceId, channel) {
	const filter = {};
	if (workspaceId) filter.workspace_id = workspaceId;
	if (channel) filter.channel = channel;

	const candidates = await Issue.find({
		...filter,
		status: { $ne: "COMPLETED" },
	})
		.sort({ updated_time: -1 })
		.limit(50)
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

	if (best && bestScore >= config.similarityThreshold) {
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

async function findWorkByMessageTs(messageTs) {
	if (!messageTs) return { task: null, issue: null };
	let [task, issue] = await Promise.all([
		Task.findOne({ slack_message_ts: messageTs }).lean(),
		Issue.findOne({ slack_message_ts: messageTs }).lean(),
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