const { Task, Issue, Notification } = require("../models");
const { similarity } = require("../utils/helpers");
const config = require("../config");

async function findSimilarTask(
	title,
	description,
	workspaceId,
	channel,
	threshold = config.similarityThreshold,
) {
	const filter = {};

	const candidates = await Task.find({
		...filter,
		status: { $ne: "COMPLETED" },
	})
		.sort({ updated_time: -1 })
		.limit(100)
		.lean();

	let best = null;
	let bestScore = 0;

	const cleanProbe = `${title} ${description || ""}`
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	for (const task of candidates) {
		const cleanTaskTitle = task.title
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		let score = Math.max(
			similarity(cleanProbe, cleanTaskTitle),
			similarity(
				cleanProbe,
				`${cleanTaskTitle} ${task.description || ""}`
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, " "),
			),
		);

		// Substring Boost!
		if (cleanTaskTitle.length > 3 && cleanProbe.includes(cleanTaskTitle)) {
			score = 1.0;
		}

		if (score > bestScore) {
			bestScore = score;
			best = task;
		}
	}

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
	threshold = config.similarityThreshold,
) {
	const filter = {};

	const candidates = await Issue.find({
		...filter,
		status: { $ne: "RESOLVED" },
	})
		.sort({ updated_time: -1 })
		.limit(100)
		.lean();

	let best = null;
	let bestScore = 0;

	const cleanProbe = `${title} ${description || ""}`
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	for (const issue of candidates) {
		const cleanIssueTitle = issue.title
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		let score = Math.max(
			similarity(cleanProbe, cleanIssueTitle),
			similarity(
				cleanProbe,
				`${cleanIssueTitle} ${issue.description || ""}`
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, " "),
			),
		);

		// Substring Boost!
		if (
			cleanIssueTitle.length > 3 &&
			cleanProbe.includes(cleanIssueTitle)
		) {
			score = 1.0;
		}

		if (score > bestScore) {
			bestScore = score;
			best = issue;
		}
	}

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

async function findWorkByMessageTs(messageTs) {
	if (!messageTs) return { task: null, issue: null };
	let [task, issue] = await Promise.all([
		Task.findOne({ slack_message_ts: messageTs }).lean(),
		Issue.findOne({ slack_message_ts: messageTs }).lean(),
	]);

	if (!task && !issue) {
		// FIXED: Changed `thread` to `messageTs` to prevent ReferenceError
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