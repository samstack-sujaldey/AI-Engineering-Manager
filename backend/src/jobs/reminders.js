const cron = require("node-cron");
const { Task, Issue, Notification } = require("../models");
const config = require("../config");

/**
 * Reminder loop for:
 * - Missing due dates
 * - Missing block reasons
 * - Unacknowledged dependent-user notifications
 */
function startReminderScheduler(notificationService) {
	if (!notificationService) {
		console.warn("[reminders] No notification service — scheduler skipped");
		return null;
	}

	// 🟢 FIX 1: Run every single minute so tasks trigger exactly when due
	const job = cron.schedule("* * * * *", async () => {
		try {
			// Re-assert pending flags from tasks/issues that still need data
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
					message: `Your task '${t.title}' is marked as blocked. Please tell me what is blocking it.`,
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

			const overdueTasks = await Task.find({
				status: { $ne: "COMPLETED" },
				due_date: { $lt: new Date(), $ne: null },
				"owner.id": { $exists: true, $ne: "" },
			}).limit(50);

			for (const t of overdueTasks) {
				// 🟢 FIX 2: Check for 59 minutes to prevent cron overlap skips
				const recentNotice = await Notification.findOne({
					task_id: t.task_id,
					type: "GENERAL",
					message: { $regex: /Overdue/i },
					createdAt: {
						$gte: new Date(Date.now() - 59 * 60 * 1000),
					},
				});

				if (!recentNotice) {
					// 🟢 FIX 3: Force Indian Standard Time (IST) formatting
					const formattedTime = new Date(t.due_date).toLocaleString(
						"en-IN",
						{ timeZone: "Asia/Kolkata" },
					);

					await notificationService.createAndSend({
						type: "GENERAL",
						target_user_id: t.owner.id,
						target_user_name: t.owner.name,
						message: `🚨 *Overdue Task:* Your task '${t.title}' was due on ${formattedTime}. Please update the status to "done" or reply with a new due date!`,
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

	console.log("[reminders] Reminder scheduler started (checks every 1 min)");
	return job;
}

module.exports = { startReminderScheduler };
