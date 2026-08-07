const { Task, Issue } = require("../models");
const { callOpenAI, getEmbedding } = require("../ai/openai");
const { similarity } = require("../utils/helpers");
const vectorDbService = require("./vectorDbService");

async function findRelatedWorkWithAI({
	title,
	description,
	workspaceId,
	channel,
	limit = 5,
}) {
	const probe = `${title} ${description || ""}`;
	let chromaMatches = [];

	// 1. Query ChromaDB for historical Slack discussions
	try {
		const queryVector = await getEmbedding(probe);
		if (queryVector) {
			const vectorResults =
				await vectorDbService.searchSimilarIssues(queryVector);

			if (vectorResults && vectorResults.ids && vectorResults.ids[0]) {
				const ids = vectorResults.ids[0];
				const docs = vectorResults.documents[0];
				const metas = vectorResults.metadatas[0];

				for (let i = 0; i < ids.length; i++) {
					const meta = metas[i] || {};
					const docText = docs[i] || "";

					if (
						docText &&
						!docText
							.toLowerCase()
							.includes(`issue - ${title.toLowerCase()}`)
					) {
						chromaMatches.push({
							type: "discussion",
							id: ids[i],
							title: "Previous Slack Work / Thread",
							description: docText,
							status: "PAST_THREAD",
							reason: "Similar work/discussion found in Vector DB",
							related_users:
								meta.sender_id && meta.sender_id !== "unknown"
									? [
											{
												id: meta.sender_id,
												name: meta.sender_name,
												display_name: meta.sender_name,
											},
										]
									: [],
						});
					}
				}
			}
		}
	} catch (err) {
		console.error(
			"[VectorDB] Failed to fetch similar discussions:",
			err.message,
		);
	}

	// 2. MongoDB Fallback Lookup
	const filter = { workspace_id: workspaceId };
	if (channel) filter.channel = channel;

	let tasks = [];
	let issues = [];
	try {
		[tasks, issues] = await Promise.all([
			Task.find({ ...filter, status: { $ne: "COMPLETED" } })
				.sort({ updated_time: -1 })
				.limit(30)
				.lean(),
			Issue.find({ ...filter, status: { $ne: "RESOLVED" } })
				.sort({ updated_time: -1 })
				.limit(30)
				.lean(),
		]);
	} catch (err) {
		console.error("[MongoDB] Failed to fetch fallback work items:", err.message);
	}

	const candidates = [
		...tasks.map((t) => ({ type: "task", ...t })),
		...issues.map((i) => ({ type: "issue", ...i })),
	];

	let dbMatches = candidates
		.map((c) => {
			const score = Math.max(
				similarity(probe, c.title),
				similarity(probe, `${c.title} ${c.description || ""}`),
			);
			return { candidate: c, score };
		})
		.filter((m) => m.score > 0.3)
		.map((m) => {
			const c = m.candidate;
			const users = [];
			if (c.owner?.id) users.push(c.owner);
			if (c.assigned_to?.id) users.push(c.assigned_to);
			const uniqueUsers = users.filter(
				(u, idx, self) => self.findIndex((x) => x.id === u.id) === idx,
			);

			return {
				type: c.type,
				id: c.type === "task" ? c.task_id : c.issue_id,
				title: c.title,
				description: c.description,
				status: c.status,
				reason: `Similar MongoDB item (score ${(m.score * 100).toFixed(0)}%)`,
				related_users: uniqueUsers,
			};
		});

	// 🟢 FIX: Ensure absolute ID uniqueness across combined matches
	const combined = [...chromaMatches, ...dbMatches];
	const uniqueMap = new Map();
	
	for (const item of combined) {
		if (item.id && !uniqueMap.has(item.id)) {
			uniqueMap.set(item.id, item);
		}
	}

	return Array.from(uniqueMap.values()).slice(0, limit);
}

module.exports = { findRelatedWorkWithAI };
