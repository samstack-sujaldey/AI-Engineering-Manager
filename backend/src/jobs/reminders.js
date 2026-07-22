const cron = require("node-cron");
const { Task, Issue, Notification } = require("../models");
const config = require("../config");

/**
 * Hourly reminder loop for:
 * - Missing due dates
 * - Missing block reasons
 * - Unacknowledged dependent-user notifications
 */
function startReminderScheduler(notificationService) {
	if (!notificationService) {
		console.warn("[reminders] No notification service — scheduler skipped");
		return null;
	}

	// Every 1 minute check; interval between reminder resends controlled by timestamps
	const job = cron.schedule("*/1 * * * *", async () => {
		try {
			const now = new Date();

			// 1. Check for tasks missing block reasons
			const tasksMissingBlock = await Task.find({
				block_reason_pending: true,
				status: "BLOCKED",
				"owner.id": { $ne: "" },
			}).limit(50);

			for (const t of tasksMissingBlock) {
				const last = t.block_reason_notification_at
					? new Date(t.block_reason_notification_at).getTime()
					: 0;

				if (Date.now() - last < config.reminderIntervalMs) continue;

				await notificationService.createAndSend({
					type: "BLOCK_REASON_REMINDER",
					target_user_id: t.owner.id,
					target_user_name: t.owner.name,
					message: `⚠️ *Blocked Task Reminder:* Your task *'${t.title}'* is marked as blocked, but no reason was provided. Please reply directly to its original thread with the reason!`,
					task_id: t.task_id,
					scheduleReminder: true,
				});

				t.block_reason_notification_at = new Date();
				await t.save();
			}

			// 2. Check for tasks missing due dates
			const tasksMissingDueDate = await Task.find({
				due_date_pending: true,
				due_date_notification_at: { $lte: now },
				status: { $ne: "COMPLETED" },
				"owner.id": { $ne: "" },
			}).limit(50);

			for (const t of tasksMissingDueDate) {
				await notificationService.createAndSend({
					type: "MISSING_DUE_DATE",
					target_user_id: t.owner.id,
					target_user_name: t.owner.name,
					message: `📅 *Reminder:* This task ('${t.title}') is still missing a due date. Please reply in this thread with a deadline!`,
					task_id: t.task_id,
					scheduleReminder: false,
				});

				// ✨ FIXED: Removed the stray comma so math calculates 1 hour (3600000 ms) correctly
				t.due_date_notification_at = new Date(Date.now() + 3600000);
				await t.save();
			}

			const waitingAck = await Task.find({
				"awaiting_acknowledgement.acknowledged": false,
				"awaiting_acknowledgement.user.id": { $exists: true, $ne: "" },
			}).limit(50);

			const overdueTasks = await Task.find({
				status: { $ne: "COMPLETED" },
				due_date: { $lt: new Date(), $ne: null },
				"owner.id": { $exists: true, $ne: "" },
			}).limit(50);

			for (const t of overdueTasks) {
				const recentNotice = await Notification.findOne({
					task_id: t.task_id,
					type: "GENERAL",
					message: { $regex: /Overdue/i },
					createdAt: {
						$gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
					},
				});

				if (!recentNotice) {
					await notificationService.createAndSend({
						type: "GENERAL",
						target_user_id: t.owner.id,
						target_user_name: t.owner.name,
						message: `🚨 *Overdue Task:* Your task '${t.title}' was due on ${new Date(t.due_date).toLocaleDateString()}. Please update the status to "done" or reply with a new due date!`,
						task_id: t.task_id,
						scheduleReminder: false,
					});
				}
			}

			for (const t of waitingAck) {
				const last = t.awaiting_acknowledgement.notification_at
					? new Date(
							t.awaiting_acknowledgement.notification_at,
						).getTime()
					: 0;
				if (Date.now() - last < config.reminderIntervalMs) continue;
				const u = t.awaiting_acknowledgement.user;
				await notificationService.createAndSend({
					type: "ACKNOWLEDGEMENT_REMINDER",
					target_user_id: u.id,
					target_user_name: u.name,
					message: `@${u.name}, ${t.owner?.name || "Someone"}'s task '${t.title}' is currently blocked waiting on you. Please reply 'OK' once you've acknowledged it.`,
					task_id: t.task_id,
					scheduleReminder: true,
				});
				t.awaiting_acknowledgement.notification_at = new Date();
				await t.save();
			}
		} catch (err) {
			console.error("[reminders] scheduler error:", err);
		}
	});

	console.log(
		"[reminders] Hourly reminder scheduler started (checks every 1 min)",
	);
	return job;
}

module.exports = { startReminderScheduler };
