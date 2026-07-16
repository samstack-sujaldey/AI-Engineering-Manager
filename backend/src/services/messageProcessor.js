const { Task, Issue, Discussion, Activity } = require("../models");
const { parseMessage } = require("../agent/parser");
const {
	findSimilarTask,
	findSimilarIssue,
	findWorkByThread,
	findWorkByMessageTs,
} = require("./similarity");
const { newId } = require("../utils/helpers");
const config = require("../config");

class MessageProcessor {
	constructor({ notificationService, io } = {}) {
		this.notifications = notificationService || null;
		this.io = io || null;
	}

	setIo(io) {
		this.io = io;
	}

	/**
	 * Process one Slack message end-to-end.
	 * Returns the structured parser result enriched with persisted IDs.
	 */
	async process(raw, options = {}) {
		const {
			text,
			sender,
			channel = "",
			thread_id = "",
			workspace_id = "",
			team = "",
			message_ts = "",
			is_edit = false,
			user_directory = {},
		} = raw;
		const { quiet = false } = options;

		// Resolve existing records for edit / thread continuity
		let existing_task = null;
		let existing_issue = null;

		if (is_edit && message_ts) {
			const byMsg = await findWorkByMessageTs(message_ts);
			existing_task = byMsg.task;
			existing_issue = byMsg.issue;
		}

		const threadRoot = thread_id || message_ts;
		if (!existing_task && !existing_issue && threadRoot) {
			const byThread = await findWorkByThread(threadRoot, channel);
			existing_task = byThread.task;
			existing_issue = byThread.issue;
		}

		const parsed = parseMessage({
			text,
			sender,
			channel,
			thread_id: threadRoot,
			workspace_id,
			team,
			message_ts,
			is_edit,
			user_directory,
			existing_task,
			existing_issue,
			now: new Date(),
		});

		// Dedup before create
		if (
			parsed.classification === "TASK" &&
			parsed.action === "CREATE_TASK" &&
			parsed.task
		) {
			const sim = await findSimilarTask(
				parsed.task.title,
				parsed.task.description,
				workspace_id,
				channel,
			);
			if (sim) {
				parsed.action = "UPDATE_TASK";
				parsed.task_created = false;
				parsed.task_updated = true;
				parsed.task.id = sim.task.task_id;
				existing_task = sim.task;
				parsed.meta = {
					...parsed.meta,
					similarity_score: sim.score,
					deduped: true,
				};
			}
		}

		if (
			parsed.classification === "ISSUE" &&
			parsed.action === "CREATE_ISSUE" &&
			parsed.issue
		) {
			const sim = await findSimilarIssue(
				parsed.issue.title,
				parsed.issue.description,
				workspace_id,
				channel,
			);
			if (sim) {
				parsed.action = "UPDATE_ISSUE";
				parsed.issue_created = false;
				parsed.issue_updated = true;
				parsed.issue.id = sim.issue.issue_id;
				existing_issue = sim.issue;
				parsed.meta = {
					...parsed.meta,
					similarity_score: sim.score,
					deduped: true,
				};
			}
		}

		const result = await this.persist(parsed, {
			text,
			sender,
			channel,
			thread_id: threadRoot,
			workspace_id,
			team,
			message_ts,
			existing_task,
			existing_issue,
		});

		if (this.io && !quiet) {
			this.io.emit("dashboard:update", {
				action: result.action,
				classification: result.classification,
				task_id: result.task?.id || null,
				issue_id: result.issue?.id || null,
				at: new Date().toISOString(),
			});
		}

		return result;
	}

	async persist(parsed, ctx) {
		const senderRef = parsed.sender;

		switch (parsed.action) {
			case "CREATE_TASK":
				return this.createTask(parsed, ctx, senderRef);
			case "UPDATE_TASK":
			case "UPDATE_LINKED_WORK":
				if (parsed.task?.id || ctx.existing_task) {
					return this.updateTask(parsed, ctx, senderRef);
				}
				if (parsed.issue?.id || ctx.existing_issue) {
					return this.updateIssue(parsed, ctx, senderRef);
				}
				return this.storeDiscussion(parsed, ctx, senderRef);
			case "CREATE_ISSUE":
				return this.createIssue(parsed, ctx, senderRef);
			case "UPDATE_ISSUE":
				return this.updateIssue(parsed, ctx, senderRef);
			case "ACKNOWLEDGE_DEPENDENCY":
				return this.acknowledge(parsed, ctx, senderRef);
			case "LINK_DISCUSSION":
			case "STORE_DISCUSSION":
			default:
				return this.storeDiscussion(parsed, ctx, senderRef);
		}
	}

	async createTask(parsed, ctx, senderRef) {
		const t = parsed.task;
		const taskId = newId("tsk");
		const dueDate = t.due_date ? new Date(t.due_date) : null;

		const doc = await Task.create({
			task_id: taskId,
			title: t.title,
			description: t.description || ctx.text,
			owner: parsed.owner || { id: "", name: "Unassigned" },
			assigned_to: parsed.assigned_to || { id: "", name: "Unassigned" },
			assigned_by: parsed.assigned_by || senderRef,
			reporter: parsed.reporter || senderRef,
			created_by: senderRef,
			last_updated_by: senderRef,
			mentioned_users: parsed.mentioned_users || [],
			watcher_users: parsed.meta?.watchers || [],
			reviewer_users: parsed.meta?.reviewers || [],
			priority: t.priority || "MEDIUM",
			status: t.status || "TODO",
			due_date: dueDate,
			due_date_pending: !dueDate,
			needs_assignment:
				!!t.needs_assignment || !!parsed.meta?.needs_assignment,
			blocked_reason: t.blocked_reason || "",
			block_reason_pending: t.status === "BLOCKED" && !t.blocked_reason,
			dependencies: t.dependencies || [],
			tags: [],
			confidence_score: parsed.confidence,
			channel: ctx.channel,
			thread: ctx.thread_id,
			workspace_id: ctx.workspace_id,
			team: ctx.team,
			slack_message_ts: ctx.message_ts,
			entities: parsed.meta?.entities || {},
			history: [
				{
					event: "CREATED",
					by: senderRef,
					details: { action: "CREATE_TASK" },
				},
			],
		});

		await this.logActivity({
			type: "TASK_CREATED",
			summary: `Task created: ${doc.title}`,
			actor: senderRef,
			task_id: taskId,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		await this.dispatchNotifications(parsed.notifications, {
			task_id: taskId,
		});

		if (doc.due_date_pending) {
			doc.due_date_notification_at = new Date();
			await doc.save();
		}
		if (doc.block_reason_pending) {
			doc.block_reason_notification_at = new Date();
			await doc.save();
		}

		// Track dependent user acknowledgement
		const depNtf = (parsed.notifications || []).find(
			(n) => n.type === "DEPENDENT_USER",
		);
		if (depNtf) {
			doc.awaiting_acknowledgement = {
				user: {
					id: depNtf.target_user_id,
					name: depNtf.target_user_name,
				},
				acknowledged: false,
				notification_at: new Date(),
			};
			await doc.save();
		}

		return {
			...parsed,
			task_created: true,
			task_updated: false,
			task: this.taskSnapshot(doc),
		};
	}

	async updateTask(parsed, ctx, senderRef) {
		const taskId = parsed.task?.id || ctx.existing_task?.task_id;
		const doc = await Task.findOne({ task_id: taskId });
		if (!doc) {
			// Fall back to create if missing
			return this.createTask(
				{ ...parsed, action: "CREATE_TASK", task_created: true },
				ctx,
				senderRef,
			);
		}

		const t = parsed.task || {};
		const updates = parsed.updates || {};

		if (t.title && !ctx.existing_task) doc.title = t.title;
		if (t.description) doc.description = t.description;
		if (parsed.owner) doc.owner = parsed.owner;
		if (parsed.assigned_to) doc.assigned_to = parsed.assigned_to;
		if (parsed.assigned_by) doc.assigned_by = parsed.assigned_by;
		if (parsed.mentioned_users?.length) {
			doc.mentioned_users = mergeUsers(
				doc.mentioned_users,
				parsed.mentioned_users,
			);
		}

		const nextStatus = updates.status || t.status;
		const nextPriority = updates.priority || t.priority;
		const nextDue = updates.due_date || t.due_date;
		const nextBlock = updates.blocked_reason || t.blocked_reason;

		if (nextStatus) doc.status = nextStatus;
		if (nextPriority) doc.priority = nextPriority;
		if (nextDue) {
			doc.due_date = new Date(nextDue);
			doc.due_date_pending = false;
			if (this.notifications) {
				await this.notifications.cancelForEntity({
					task_id: doc.task_id,
					types: ["MISSING_DUE_DATE", "DUE_DATE_REMINDER"],
				});
			}
		}
		if (nextBlock) {
			doc.blocked_reason = nextBlock;
			doc.block_reason_pending = false;
			if (this.notifications) {
				await this.notifications.cancelForEntity({
					task_id: doc.task_id,
					types: ["MISSING_BLOCK_REASON", "BLOCK_REASON_REMINDER"],
				});
			}
		}

		if (t.dependencies?.length) {
			doc.dependencies = [
				...new Set([...(doc.dependencies || []), ...t.dependencies]),
			];
		}

		if (parsed.meta?.needs_assignment != null) {
			doc.needs_assignment = parsed.meta.needs_assignment;
		}

		// Re-evaluate pending flags
		if (doc.status === "BLOCKED" && !doc.blocked_reason) {
			doc.block_reason_pending = true;
		}
		if (!doc.due_date) {
			doc.due_date_pending = true;
		}

		doc.last_updated_by = senderRef;
		doc.history.push({
			event: "UPDATED",
			by: senderRef,
			details: { action: parsed.action, updates },
		});

		// Link discussion if present
		if (
			parsed.discussion ||
			parsed.classification === "GENERAL_DISCUSSION"
		) {
			const discussion = await this.createDiscussionRecord(
				parsed,
				ctx,
				senderRef,
				{
					task_id: doc.task_id,
					issue_id: null,
				},
			);
			doc.related_discussions = [
				...new Set([
					...(doc.related_discussions || []),
					discussion.discussion_id,
				]),
			];
		}

		await doc.save();

		await this.logActivity({
			type: "TASK_UPDATED",
			summary: `Task updated: ${doc.title}`,
			actor: senderRef,
			task_id: doc.task_id,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		// Fire missing-info notifications on newly blocked / missing due
		await this.dispatchNotifications(parsed.notifications, {
			task_id: doc.task_id,
		});

		return {
			...parsed,
			task_created: false,
			task_updated: true,
			task: this.taskSnapshot(doc),
		};
	}

	async createIssue(parsed, ctx, senderRef) {
		const i = parsed.issue;
		const issueId = newId("iss");

		const doc = await Issue.create({
			issue_id: issueId,
			title: i.title,
			description: i.description || ctx.text,
			reporter: parsed.reporter || senderRef,
			owner: parsed.owner || { id: "", name: "Unassigned" },
			assigned_to: parsed.assigned_to || { id: "", name: "Unassigned" },
			assigned_by: parsed.assigned_by || senderRef,
			created_by: senderRef,
			last_updated_by: senderRef,
			mentioned_users: parsed.mentioned_users || [],
			priority: i.priority || "HIGH",
			status: i.status || "HOLD", // Map to HOLD
			blocked_reason: i.blocked_reason || "",
			block_reason_pending: i.status === "HOLD" && !i.blocked_reason,
			dependencies: i.dependencies || [],
			confidence_score: parsed.confidence,
			channel: ctx.channel,
			thread: ctx.thread_id,
			workspace_id: ctx.workspace_id,
			team: ctx.team,
			slack_message_ts: ctx.message_ts,
			entities: parsed.meta?.entities || {},
			history: [
				{
					event: "CREATED",
					by: senderRef,
					details: { action: "CREATE_ISSUE" },
				},
			],
		});

		await this.logActivity({
			type: "ISSUE_CREATED",
			summary: `Issue created: ${doc.title}`,
			actor: senderRef,
			issue_id: issueId,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		await this.dispatchNotifications(parsed.notifications, {
			issue_id: issueId,
		});

		return {
			...parsed,
			issue_created: true,
			issue_updated: false,
			issue: this.issueSnapshot(doc),
		};
	}

	async updateIssue(parsed, ctx, senderRef) {
		const issueId = parsed.issue?.id || ctx.existing_issue?.issue_id;
		const doc = await Issue.findOne({ issue_id: issueId });

		if (!doc) {
			return this.createIssue(
				{ ...parsed, action: "CREATE_ISSUE", issue_created: true },
				ctx,
				senderRef,
			);
		}

		const i = parsed.issue || {};
		const updates = parsed.updates || {};

		if (i.description) doc.description = i.description;
		if (parsed.owner) doc.owner = parsed.owner;
		if (parsed.assigned_to) doc.assigned_to = parsed.assigned_to;
		if (parsed.mentioned_users?.length) {
			doc.mentioned_users = mergeUsers(
				doc.mentioned_users,
				parsed.mentioned_users,
			);
		}

		const nextStatus = updates.status || i.status;
		const nextPriority = updates.priority || i.priority;
		const nextBlock = updates.blocked_reason || i.blocked_reason;
		const nextRoot = i.root_cause;

		if (nextStatus) doc.status = nextStatus;
		if (nextPriority) doc.priority = nextPriority;

		if (nextBlock) {
			doc.blocked_reason = nextBlock;
			doc.block_reason_pending = false;
		}

		if (nextRoot) doc.root_cause = nextRoot;

		if (
			parsed.discussion ||
			parsed.classification === "GENERAL_DISCUSSION"
		) {
			const discussion = await this.createDiscussionRecord(
				parsed,
				ctx,
				senderRef,
				{
					task_id: null,
					issue_id: doc.issue_id,
				},
			);
			doc.related_discussions = [
				...new Set([
					...(doc.related_discussions || []),
					discussion.discussion_id,
				]),
			];
		}

		doc.last_updated_by = senderRef;
		doc.history.push({
			event: "UPDATED",
			by: senderRef,
			details: { action: parsed.action, updates },
		});
		await doc.save();

		await this.logActivity({
			type: "ISSUE_UPDATED",
			summary: `Issue updated: ${doc.title}`,
			actor: senderRef,
			issue_id: doc.issue_id,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		await this.dispatchNotifications(parsed.notifications, {
			issue_id: doc.issue_id,
		});

		return {
			...parsed,
			issue_created: false,
			issue_updated: true,
			issue: this.issueSnapshot(doc),
		};
	}

	async storeDiscussion(parsed, ctx, senderRef) {
		if (parsed.updates && parsed.updates.status) {
			if (parsed.discussion?.task_id) {
				await Task.updateOne(
					{ task_id: parsed.discussion.task_id },
					{ $set: { status: parsed.updates.status } },
				);
			} else if (parsed.discussion?.issue_id) {
				await Issue.updateOne(
					{ issue_id: parsed.discussion.issue_id },
					{ $set: { status: parsed.updates.status } },
				);
			}
		}

		const discussion = await this.createDiscussionRecord(
			parsed,
			ctx,
			senderRef,
			{
				task_id: parsed.discussion?.task_id || null,
				issue_id: parsed.discussion?.issue_id || null,
			},
		);

		if (discussion.task_id) {
			await Task.updateOne(
				{ task_id: discussion.task_id },
				{
					$addToSet: {
						related_discussions: discussion.discussion_id,
					},
				},
			);
		}
		if (discussion.issue_id) {
			await Issue.updateOne(
				{ issue_id: discussion.issue_id },
				{
					$addToSet: {
						related_discussions: discussion.discussion_id,
					},
				},
			);
		}

		await this.logActivity({
			type: "DISCUSSION",
			summary: `Discussion: ${(parsed.discussion?.content || ctx.text || "").slice(0, 80)}`,
			actor: senderRef,
			discussion_id: discussion.discussion_id,
			task_id: discussion.task_id,
			issue_id: discussion.issue_id,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		await this.dispatchNotifications(parsed.notifications, {
			task_id: discussion.task_id,
			issue_id: discussion.issue_id,
		});

		return {
			...parsed,
			discussion: {
				id: discussion.discussion_id,
				content: discussion.content,
				task_id: discussion.task_id,
				issue_id: discussion.issue_id,
				flagged_for_review: discussion.flagged_for_review,
			},
		};
	}

	async acknowledge(parsed, ctx, senderRef) {
		const taskId = parsed.task?.id;
		const issueId = parsed.issue?.id;

		if (taskId) {
			await Task.updateOne(
				{ task_id: taskId },
				{
					$set: {
						"awaiting_acknowledgement.acknowledged": true,
						last_updated_by: senderRef,
					},
					$push: {
						history: {
							event: "ACKNOWLEDGED",
							by: senderRef,
							at: new Date(),
						},
					},
				},
			);
		}
		if (issueId) {
			await Issue.updateOne(
				{ issue_id: issueId },
				{
					$set: {
						"awaiting_acknowledgement.acknowledged": true,
						last_updated_by: senderRef,
					},
				},
			);
		}

		if (this.notifications) {
			await this.notifications.acknowledge({
				task_id: taskId,
				issue_id: issueId,
				user_id: senderRef.id,
			});
		}

		await this.logActivity({
			type: "ACKNOWLEDGED",
			summary: `${senderRef.name || senderRef.display_name} acknowledged dependency`,
			actor: senderRef,
			task_id: taskId,
			issue_id: issueId,
			channel: ctx.channel,
			thread: ctx.thread_id,
		});

		return { ...parsed, acknowledgement: true };
	}

	async createDiscussionRecord(parsed, ctx, senderRef, links) {
		return Discussion.create({
			discussion_id: newId("dsc"),
			content: parsed.discussion?.content || ctx.text,
			author: senderRef,
			channel: ctx.channel,
			thread: ctx.thread_id,
			workspace_id: ctx.workspace_id,
			team: ctx.team,
			task_id: links.task_id,
			issue_id: links.issue_id,
			slack_message_ts: ctx.message_ts,
			mentioned_users: parsed.mentioned_users || [],
			flagged_for_review:
				!!parsed.discussion?.flagged_for_review ||
				!!parsed.meta?.needs_human_review,
			confidence_score: parsed.confidence,
			timestamp: new Date(),
		});
	}

	async dispatchNotifications(list = [], ids = {}) {
		if (!this.notifications || !list.length) return;
		for (const n of list) {
			await this.notifications.createAndSend({
				...n,
				task_id: ids.task_id || n.task_id || null,
				issue_id: ids.issue_id || n.issue_id || null,
				scheduleReminder: true,
			});
		}
	}

	async logActivity(entry) {
		await Activity.create({
			activity_id: newId("act"),
			type: entry.type,
			summary: entry.summary,
			actor: entry.actor,
			task_id: entry.task_id || null,
			issue_id: entry.issue_id || null,
			discussion_id: entry.discussion_id || null,
			channel: entry.channel || "",
			thread: entry.thread || "",
			payload: entry.payload || {},
		});
	}

	taskSnapshot(doc) {
		return {
			id: doc.task_id,
			title: doc.title,
			description: doc.description,
			priority: doc.priority,
			status: doc.status,
			due_date: doc.due_date ? doc.due_date.toISOString() : "",
			dependencies: doc.dependencies || [],
			owner: doc.owner,
			assigned_to: doc.assigned_to,
			assigned_by: doc.assigned_by,
			reporter: doc.reporter,
			created_by: doc.created_by,
			needs_assignment: doc.needs_assignment,
			due_date_pending: doc.due_date_pending,
			block_reason_pending: doc.block_reason_pending,
			blocked_reason: doc.blocked_reason,
		};
	}

	issueSnapshot(doc) {
		return {
			id: doc.issue_id,
			title: doc.title,
			description: doc.description,
			status: doc.status,
			priority: doc.priority,
			root_cause: doc.root_cause || "",
			blocked_reason: doc.blocked_reason || "",
			owner: doc.owner,
			assigned_to: doc.assigned_to,
			reporter: doc.reporter,
		};
	}
}

function mergeUsers(existing = [], incoming = []) {
	const map = new Map();
	for (const u of [...existing, ...incoming]) {
		const key = u.id || u.name;
		if (!key) continue;
		map.set(key, u);
	}
	return [...map.values()];
}

module.exports = { MessageProcessor };
