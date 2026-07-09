import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import SlackIntegration from "../models/slackIntegration.model.js";
import Team from "../models/Team.js";
import Member from "../models/Member.js";
import Standup from "../models/Standup.js";
import StandupMessage from "../models/StandupMessage.js";
import Task from "../models/Task.js";
import Activity from "../models/Activity.js";
import { parseStandupMessage } from "./parserService.js";

// ─────────────────────────────────────────────
// Helper: get an authenticated Slack WebClient
// ─────────────────────────────────────────────
export const getSlackClient = async () => {
	const integration = await SlackIntegration.findOne({ connected: true });
	if (!integration) {
		throw new Error(
			"Slack is not connected. Please complete the OAuth flow at /api/slack/install",
		);
	}
	return new WebClient(integration.accessToken);
};

// Escapes regex metacharacters so a Slack display name like "C++ Dev" or
// "J. Doe (QA)" can't break — or silently widen — a $regex match.
function escapeRegex(str = "") {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchChannelMessages
// Directly hits the Slack API and returns raw messages from a given channel.
// ─────────────────────────────────────────────────────────────────────────────
export const fetchChannelMessages = async (channelId, limit = 50) => {
	if (!channelId) {
		throw new Error("channelId is required to fetch Slack messages.");
	}

	const client = await getSlackClient();

	const result = await client.conversations.history({
		channel: channelId,
		limit,
	});

	if (!result.ok) {
		throw new Error(`Slack API error: ${result.error}`);
	}

	const userMessages = (result.messages || []).filter(
		(m) =>
			m.type === "message" &&
			!m.subtype &&
			m.user &&
			m.text &&
			m.text.trim() !== "",
	);

	const enriched = await Promise.all(
		userMessages.map(async (msg) => {
			let userName = "Unknown User";
			let email = null;

			try {
				const userInfo = await client.users.info({ user: msg.user });
				if (userInfo.ok) {
					userName =
						userInfo.user.real_name ||
						userInfo.user.profile?.display_name ||
						userInfo.user.name ||
						"Unknown User";
					email = userInfo.user.profile?.email || null;
				}
			} catch (err) {
				console.warn(
					`⚠️  Could not fetch user info for ${msg.user}:`,
					err.message,
				);
			}

			return {
				slackUserId: msg.user,
				userName,
				email,
				rawMessage: msg.text,
				ts: msg.ts, // stable per-channel Slack message id — used for de-dup
			};
		}),
	);

	return enriched;
};

// ─────────────────────────────────────────────────────────────────────────────
// processSlackData
// Idempotently ingests { channel, messages } into MongoDB:
//   - upserts the Team
//   - finds/creates each Member
//   - upserts each Standup keyed on (slackChannelId, slackTs) so re-running
//     the pipeline on the same messages never creates duplicates
//   - only queues genuinely new / not-yet-parsed messages for AI parsing
// ─────────────────────────────────────────────────────────────────────────────
export async function processSlackData(slackPayload) {
	const { channel, messages } = slackPayload || {};

	if (!channel || !channel.channelId) {
		throw new Error("processSlackData requires a channel.channelId.");
	}

	if (!messages || messages.length === 0) {
		return {
			success: true,
			processedCount: 0,
			newCount: 0,
			alreadyParsedCount: 0,
			skippedEmptyCount: 0,
			aiReadyText: "",
			teamId: null,
		};
	}

	const team = await Team.findOneAndUpdate(
		{ slackChannelId: channel.channelId },
		{
			name: channel.channelName || channel.channelId,
			slackChannelId: channel.channelId,
			slackChannelName: channel.channelName || channel.channelId,
			isSlackConnected: true,
		},
		{ new: true, upsert: true },
	);

	const compiledAiText = [];
	let newCount = 0;
	let alreadyParsedCount = 0;
	let skippedEmptyCount = 0;

	for (const msg of messages) {
		try {
			if (!msg.rawMessage || msg.rawMessage.trim() === "") {
				skippedEmptyCount++;
				continue;
			}

			// ── Resolve or create the Member ──────────────────
			let member = null;
			if (msg.slackUserId) {
				member = await Member.findOne({ slackUserId: msg.slackUserId });
			}
			if (!member && msg.email) {
				member = await Member.findOne({ email: msg.email });
			}

			if (!member) {
				const safeEmail =
					msg.email ||
					`${msg.slackUserId || "unknown"}-${crypto.randomUUID()}@slack.placeholder`;
				member = await Member.create({
					name: msg.userName || "Unknown User",
					email: safeEmail,
					slackUserId: msg.slackUserId || null,
					role: "Developer",
					teamId: team._id,
					isActive: true,
				});
				console.log(
					`👤 Created new member: ${member.name} (${member.slackUserId || "no slack id"})`,
				);
			} else if (!member.teamId) {
				member.teamId = team._id;
				await member.save();
			}

			// Fall back to a synthetic key for payloads without a real Slack ts
			// (e.g. manually POSTed /webhook test bodies) so ingestion never crashes.
			const slackTs = msg.ts || `no-ts-${crypto.randomUUID()}`;

			// ── Atomic de-dupe: upsert keyed on (channel, ts) ──
			const upsertResult = await Standup.findOneAndUpdate(
				{ slackChannelId: channel.channelId, slackTs },
				{
					$setOnInsert: {
						submittedBy: member._id,
						teamId: team._id,
						slackChannelId: channel.channelId,
						slackTs,
						source: "Slack",
						parsingStatus: "Pending",
						message: msg.rawMessage,
						parsed: false,
					},
				},
				{ upsert: true, new: true, includeResultMetadata: true },
			);

			const standupDoc = upsertResult.value;
			const wasInserted = !!upsertResult.lastErrorObject?.upserted;

			if (wasInserted) {
				newCount++;
				await StandupMessage.create({
					standupId: standupDoc._id,
					memberId: member._id,
					rawMessage: msg.rawMessage,
					parsed: false,
				});
			}

			if (standupDoc.parsed) {
				// Already fully processed (raw data saved + tasks created) in a
				// previous call — this is exactly the "hit /process twice" case.
				alreadyParsedCount++;
				continue;
			}

			compiledAiText.push(
				`Member: ${member.name}\nMessage: ${msg.rawMessage}\n---`,
			);
		} catch (err) {
			// One malformed message shouldn't fail the whole batch.
			console.error("❌ Error ingesting one Slack message:", err.message);
		}
	}

	return {
		success: true,
		processedCount: messages.length,
		newCount,
		alreadyParsedCount,
		skippedEmptyCount,
		aiReadyText: compiledAiText.join("\n"),
		teamId: team._id,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// saveParsedTasksToDatabase
// Persists AI-parsed tasks, matched back to Member + their unparsed Standup.
// Guards against re-creating a Task if this exact (standup, title) pair was
// already saved in a previous run.
// ─────────────────────────────────────────────────────────────────────────────
export async function saveParsedTasksToDatabase(parsedTasks) {
	const savedTasks = [];
	if (!parsedTasks || parsedTasks.length === 0) return savedTasks;

	for (const taskData of parsedTasks) {
		try {
			const ownerName = (taskData.owner || "").trim();
			if (!ownerName) {
				console.warn(
					"⚠️  Parsed task has no owner — skipping.",
					taskData,
				);
				continue;
			}

			const taskTitle = (taskData.taskName || "").trim();
			if (!taskTitle) {
				console.warn(
					`⚠️  Parsed task for "${ownerName}" has no title — skipping.`,
				);
				continue;
			}

			const member = await Member.findOne({
				name: {
					$regex: new RegExp(`^${escapeRegex(ownerName)}$`, "i"),
				},
			});

			if (!member) {
				console.warn(
					`⚠️  No member found for owner: "${ownerName}" — skipping task.`,
				);
				continue;
			}

			// Only ever attach to a standup that hasn't been fully processed yet —
			// this is what stops a re-run from grabbing an already-completed standup.
			const targetStandup = await Standup.findOne({
				submittedBy: member._id,
				parsed: false,
			}).sort({ createdAt: -1 });

			if (!targetStandup) {
				console.warn(
					`⚠️  No unparsed standup found for member: ${member.name} — skipping task.`,
				);
				continue;
			}

			// Idempotency guard: same standup + same title already saved → skip.
			const existingTask = await Task.findOne({
				standupId: targetStandup._id,
				title: taskTitle,
			});
			if (existingTask) {
				console.log(
					`↩️  Task already saved for this standup, skipping: "${taskTitle}"`,
				);
				continue;
			}

			const status = normalizeStatus(taskData.status);
			const priority = normalizePriority(taskData.priority);
			const workflowStage = normalizeWorkflowStage(
				taskData.workflowStage,
			);

			const task = await Task.create({
				memberId: member._id,
				standupId: targetStandup._id,
				title: taskTitle,
				description: taskData.blockerDescription || null,
				status,
				workflowStage,
				priority,
			});

			await Activity.create({
				taskId: task._id,
				actorType: "AI_AGENT",
				actorId: "gemini-standup-parser",
				activityType: "STATUS_CHANGE",
				previousStatus: null,
				currentStatus: status,
				newValue: { title: task.title, priority, workflowStage },
				message: "Task created from Slack standup via AI parsing.",
			});

			await StandupMessage.findOneAndUpdate(
				{ standupId: targetStandup._id, memberId: member._id },
				{ parsed: true },
			);

			await Standup.findByIdAndUpdate(targetStandup._id, {
				parsingStatus: "Completed",
				parsed: true,
			});

			savedTasks.push(task);
			console.log(`✅ Saved task: "${task.title}" for ${member.name}`);
		} catch (err) {
			console.error(
				`❌ Error saving task "${taskData?.taskName}":`,
				err.message,
			);
		}
	}

	return savedTasks;
}

// ─────────────────────────────────────────────────────────────────────────────
// runFullPipeline
// Single entrypoint used by both the /process route and the /webhook route,
// so the de-dup + parsing + saving logic only lives in one place.
// ─────────────────────────────────────────────────────────────────────────────
export async function runFullPipeline(channelId, limit = 50) {
	const rawMessages = await fetchChannelMessages(channelId, limit);

	if (rawMessages.length === 0) {
		return {
			message: "No messages found in channel.",
			channelId,
			processedCount: 0,
			newCount: 0,
			alreadyParsedCount: 0,
			parsedTaskCount: 0,
			savedTaskCount: 0,
			tasks: [],
		};
	}

	const client = await getSlackClient();
	const chanInfo = await client.conversations.info({ channel: channelId });
	const channelName = chanInfo.ok ? chanInfo.channel.name : channelId;

	const ingestResult = await processSlackData({
		channel: { channelId, channelName },
		messages: rawMessages,
	});

	if (!ingestResult.aiReadyText) {
		return {
			message:
				ingestResult.alreadyParsedCount > 0
					? "All fetched messages were already processed in a previous run — nothing new to do."
					: "Messages saved but there was no parseable text.",
			channelId,
			channelName,
			...ingestResult,
			parsedTaskCount: 0,
			savedTaskCount: 0,
			tasks: [],
		};
	}

	const parsedTasks = await parseStandupMessage(ingestResult.aiReadyText);
	const savedTasks = await saveParsedTasksToDatabase(parsedTasks);

	return {
		message: "Slack standup pipeline completed successfully.",
		channelId,
		channelName,
		...ingestResult,
		parsedTaskCount: parsedTasks.length,
		savedTaskCount: savedTasks.length,
		tasks: savedTasks,
	};
}

// ─────────────────────────────────────────────
// Normalisation helpers
// ─────────────────────────────────────────────

function normalizeStatus(raw = "") {
	const s = (raw || "").toUpperCase();
	if (s === "COMPLETED" || s === "DONE" || s === "FINISHED")
		return "COMPLETED";
	if (s === "BLOCKED" || s === "WAITING" || s === "STUCK") return "BLOCKED";
	return "PROCESSING";
}

function normalizePriority(raw = "") {
	const p = (raw || "").toLowerCase();
	if (p.includes("critical")) return "Critical";
	if (p.includes("high") || p.includes("urgent")) return "High";
	if (p.includes("low")) return "Low";
	return "Medium";
}

function normalizeWorkflowStage(raw = "") {
	const w = (raw || "").toUpperCase();
	if (w === "QA" || w.includes("TEST")) return "QA";
	if (w === "REVIEW" || w.includes("PR")) return "REVIEW";
	if (w === "PRODUCTION" || w.includes("PROD") || w.includes("DEPLOY"))
		return "PRODUCTION";
	return "DEVELOPMENT";
}
