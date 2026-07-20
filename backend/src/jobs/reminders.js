const cron = require("node-cron");
const { Task, Issue, Notification } = require("../models");
const config = require("../config");
const { Activity } = require("../models");

// Completed tasks stay in MongoDB for this long, then are auto-deleted.
const COMPLETED_RETENTION_DAYS = 7;

/**
 * Deletes completed tasks that have been completed for longer than the
 * retention window. They remain queryable in the DB (e.g. for audits) until then.
 */
async function purgeOldCompletedTasks() {
	try {
		const cutoff = new Date(Date.now() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
		const result = await Task.deleteMany({
			status: "COMPLETED",
			completed_at: { $lte: cutoff },
		});
		if (result.deletedCount > 0) {
			console.log(`[cleanup] Deleted ${result.deletedCount} completed task(s) older than ${COMPLETED_RETENTION_DAYS} days`);
		}
	} catch (err) {
		console.error("[cleanup] failed to purge completed tasks:", err);
	}
}

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

			const overdueTasks = await Task.find({
				status: { $ne: "COMPLETED" },
				due_date: { $lt: new Date(), $ne: null },
				"owner.id": { $exists: true, $ne: "" },
			}).limit(50);

			for (const t of overdueTasks) {
				// Prevent spam: Check if we already sent an overdue notice in the last 24 hours
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
		"[reminders] Hourly reminder scheduler started (checks every 5 min)",
	);

	// Daily cleanup of completed tasks past the retention window (runs at 03:17).
	const cleanupJob = cron.schedule("17 3 * * *", () => {
		purgeOldCompletedTasks();
	});
	console.log("[cleanup] Completed-task purge scheduled (daily)");

	return job;
}

module.exports = { startReminderScheduler, purgeOldCompletedTasks };
