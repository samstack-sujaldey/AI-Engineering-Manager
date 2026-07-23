const { Notification, Task, Issue } = require("../models");
const { newId } = require("../utils/helpers");
const config = require("../config");

/**
 * Queues / sends Slack DMs. Client is injected to keep parser stateless.
 */
class NotificationService {
	constructor({ slackClient, io } = {}) {
		this.slack = slackClient || null;
		this.io = io || null;
	}

	setSlackClient(client) {
		this.slack = client;
	}

	setIo(io) {
		this.io = io;
	}

	async createAndSend({
		type,
		target_user_id,
		target_user_name = "",
		message,
		task_id = null,
		issue_id = null,
		meta = {},
		scheduleReminder = true,
	}) {
		if (!target_user_id || !message) return null;

		const nextReminder = scheduleReminder
			? new Date(Date.now() + config.reminderIntervalMs)
			: null;

		const doc = await Notification.create({
			notification_id: newId("ntf"),
			type,
			target_user_id,
			target_user_name,
			message,
			task_id,
			issue_id,
			status: "PENDING",
			next_reminder_at: nextReminder,
			meta,
		});

		await this.deliver(doc);
		return doc;
	}

	async deliver(notification) {
		let slackTs = "";
		if (this.slack && notification.target_user_id) {
			try {
				let targetChannel = notification.target_user_id; // Default to DM
				let threadTs = undefined;
				let finalMessage = notification.message;

				// Fetch original channel and thread if it belongs to a task
				if (notification.task_id) {
					const task = await Task.findOne({
						task_id: notification.task_id,
					}).lean();
					if (task && task.channel && task.slack_message_ts) {
						targetChannel = task.channel;
						threadTs = task.thread || task.slack_message_ts;
					}
				} else if (notification.issue_id) {
					const issue = await Issue.findOne({
						issue_id: notification.issue_id,
					}).lean();
					if (issue && issue.channel && issue.slack_message_ts) {
						targetChannel = issue.channel;
						threadTs = issue.thread || issue.slack_message_ts;
					}
				}

				// If routing to a public thread, ensure they are explicitly tagged so it hits the Activity feed!
				if (
					threadTs &&
					!finalMessage.includes(`<@${notification.target_user_id}>`)
				) {
					finalMessage = `<@${notification.target_user_id}> ${finalMessage}`;
				}

				// Send the threaded reply (or DM if no thread is found)
				const result = await this.slack.chat.postMessage({
					channel: targetChannel,
					thread_ts: threadTs,
					text: finalMessage,
				});
				slackTs = result.ts || "";
			} catch (err) {
				console.error(
					"[notification] Slack delivery failed:",
					err.message,
				);
			}
		}

		notification.status = "SENT";
		notification.sent_at = new Date();
		notification.slack_dm_ts = slackTs;
		await notification.save();

		if (this.io) {
			this.io.emit("notification", {
				id: notification.notification_id,
				type: notification.type,
				message: notification.message,
				task_id: notification.task_id,
				issue_id: notification.issue_id,
			});
		}

		return notification;
	}

	async cancelForEntity({ task_id, issue_id, types = [] }) {
		const filter = { status: { $in: ["PENDING", "SENT"] } };
		if (task_id) filter.task_id = task_id;
		if (issue_id) filter.issue_id = issue_id;
		if (types.length) filter.type = { $in: types };

		await Notification.updateMany(filter, {
			$set: { status: "CANCELLED", next_reminder_at: null },
		});
	}

	async acknowledge({ task_id, issue_id, user_id }) {
		const filter = {
			type: { $in: ["DEPENDENT_USER", "ACKNOWLEDGEMENT_REMINDER"] },
			status: { $in: ["PENDING", "SENT"] },
			target_user_id: user_id,
		};
		if (task_id) filter.task_id = task_id;
		if (issue_id) filter.issue_id = issue_id;

		await Notification.updateMany(filter, {
			$set: { status: "ACKNOWLEDGED", next_reminder_at: null },
		});
	}

	async processDueReminders() {
		const due = await Notification.find({
			status: "SENT",
			next_reminder_at: { $lte: new Date() },
			type: {
				$in: [
					"MISSING_DUE_DATE",
					"DUE_DATE_REMINDER",
					"MISSING_BLOCK_REASON",
					"BLOCK_REASON_REMINDER",
					"DEPENDENT_USER",
					"ACKNOWLEDGEMENT_REMINDER",
				],
			},
		}).limit(100);

		for (const n of due) {
			const reminderType = mapReminderType(n.type);

			const reminder = await this.createAndSend({
				type: reminderType,
				target_user_id: n.target_user_id,
				target_user_name: n.target_user_name,
				message: n.message,
				task_id: n.task_id,
				issue_id: n.issue_id,
				meta: { parent_notification_id: n.notification_id },
				scheduleReminder: true, // The NEW notification will carry the baton
			});

			// FIX: Retire the OLD notification so it doesn't trigger again!
			n.next_reminder_at = null;
			n.status = "ACKNOWLEDGED";
			await n.save();

			if (reminder) {
				console.log(
					`[reminder] Sent ${reminderType} to ${n.target_user_id}`,
				);
			}
		}

		return due.length;
	}
}

function mapReminderType(type) {
	if (type === "MISSING_DUE_DATE" || type === "DUE_DATE_REMINDER")
		return "DUE_DATE_REMINDER";
	if (type === "MISSING_BLOCK_REASON" || type === "BLOCK_REASON_REMINDER")
		return "BLOCK_REASON_REMINDER";
	if (type === "DEPENDENT_USER" || type === "ACKNOWLEDGEMENT_REMINDER")
		return "ACKNOWLEDGEMENT_REMINDER";
	return type;
}

module.exports = { NotificationService };
