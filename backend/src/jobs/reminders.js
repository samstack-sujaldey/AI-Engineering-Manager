const cron = require("node-cron");
const { Task, Issue } = require("../models");
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

	// Every 5 minutes check; interval between reminder resends controlled by next_reminder_at
	const job = cron.schedule("*/60 * * * *", async () => {
		try {
			// Re-assert pending flags from tasks/issues that still need data
			const tasksMissingDue = await Task.find({
				due_date_pending: true,
				status: { $ne: "COMPLETED" },
				"owner.id": { $ne: "" },
			}).limit(50);

			for (const t of tasksMissingDue) {
				const last = t.due_date_notification_at
					? new Date(t.due_date_notification_at).getTime()
					: 0;
				if (Date.now() - last < config.reminderIntervalMs) continue;
				await notificationService.createAndSend({
					type: "DUE_DATE_REMINDER",
					target_user_id: t.owner.id,
					target_user_name: t.owner.name,
					message: `I couldn't determine the due date for your task '${t.title}'. Please reply with the due date or update your original message.`,
					task_id: t.task_id,
					scheduleReminder: true,
				});
				t.due_date_notification_at = new Date();
				await t.save();
			}

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
					message:
						"Your task is marked as blocked. Please tell me what is blocking it.",
					task_id: t.task_id,
					scheduleReminder: true,
				});
				t.block_reason_notification_at = new Date();
				await t.save();
			}

			const waitingAck = await Task.find({
				"awaiting_acknowledgement.acknowledged": false,
				"awaiting_acknowledgement.user.id": { $exists: true, $ne: "" },
			}).limit(50);

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

			await notificationService.processDueReminders();
		} catch (err) {
			console.error("[reminders] scheduler error:", err);
		}
	});

	console.log(
		"[reminders] Hourly reminder scheduler started (checks every 5 min)",
	);
	return job;
}

module.exports = { startReminderScheduler };
