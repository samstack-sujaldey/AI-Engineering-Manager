require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { WebClient } = require("@slack/web-api");
const vectorDbService = require("./services/vectorDbService");
const { startStandupScheduler } = require("./jobs/standupScheduler");
const config = require("./config");
const { createApiRouter } = require("./routes/api");
const { NotificationService } = require("./services/notifications");
const { MessageProcessor } = require("./services/messageProcessor");
const { ConnectService } = require("./services/connectService");
const { findWorkByMessageTs } = require("./services/similarity");
const { Discussion, Team } = require("./models");
const { createSlackApp } = require("./slack/app");
const { startReminderScheduler } = require("./jobs/reminders");
const slackAuthRoutes = require("./routes/slackAuth");
const { createAuthRouter } = require("./routes/auth");
const seedAdmin = require("./scripts/seed.js");
const{Task} = require("./models/Task");
const{Issue} = require("./models/Issue");

// Load Standup Scheduler & Retention Cleanup
require("./config/scheduler");
const { cleanupCompletedWork } = require("./utils/retention");

process.env.TZ = "Asia/Kolkata";
const PORT=process.env.PORT || 5000;
async function main() {
	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(config.mongodbUri || process.env.MONGODB_URI);
		console.log("✅ Connected to MongoDB");
	}

	await seedAdmin(); // Seed the admin user before starting the server

	await vectorDbService.init();

	const app = express();
	const server = http.createServer(app);
	const corsOptions = {
		origin:
			process.env.FRONTEND_URL ||
			"https://ai-engineering-manager-git-main-sujal-deys-projects.vercel.app",
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		credentials: true,
	};

	const io = new Server(server, {
		cors: corsOptions,
	});

	// Initialize Slack WebClient for API queries
	const slackClient = new WebClient(
		config.slack?.botToken || process.env.SLACK_BOT_TOKEN,
	);

	const notificationService = new NotificationService({ io });
	const connectService = new ConnectService();
	const messageProcessor = new MessageProcessor({
		notificationService,
		io,
		connectService,
	});

	app.use(helmet({ contentSecurityPolicy: false }));
	app.use(cors(corsOptions)); // Applies the robust configuration defined above
	app.use(express.json({ limit: "1mb" }));
	app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

	app.use("/api", createApiRouter({ messageProcessor }));
	app.use("/api/slack", slackAuthRoutes);
	app.use("/api/auth", createAuthRouter());

	// Pipeline Endpoint: Sync historical channel activity
	app.post("/api/slack/pipeline/:channelId", async (req, res) => {
		try {
			const { channelId } = req.params;
			const targetLimit = parseInt(
				req.query.limit || req.body?.limit || 50,
				10,
			);

			console.log(
				`[pipeline] Starting sync for channel: ${channelId}...`,
			);

			const userDirectory = {};
			try {
				const usersRes = await slackClient.users.list({});
				if (usersRes?.members) {
					usersRes.members.forEach((u) => {
						userDirectory[u.id] = {
							id: u.id,
							name: u.name,
							real_name:
								u.profile?.real_name || u.real_name || u.name,
							display_name:
								u.profile?.display_name ||
								u.profile?.real_name ||
								u.real_name ||
								u.name,
						};
					});
				}
				console.log(
					`[pipeline] User Directory loaded (${Object.keys(userDirectory).length} workspace members)`,
				);
			} catch (userErr) {
				console.warn(
					"[pipeline warning] User Directory fetch failed, fallback to raw IDs:",
					userErr.message,
				);
			}

			let rawMessages = [];
			let cursor;

			do {
				const fetchCount = Math.min(
					100,
					targetLimit - rawMessages.length,
				);
				const slackRes = await slackClient.conversations.history({
					channel: channelId,
					limit: fetchCount,
					cursor,
				});

				if (slackRes.messages) {
					rawMessages.push(...slackRes.messages);
				}
				cursor = slackRes.response_metadata?.next_cursor;
			} while (cursor && rawMessages.length < targetLimit);

			const userMessages = rawMessages
				.filter(
					(m) =>
						m.text &&
						m.text.trim().length > 0 &&
						(!m.subtype || m.subtype === "file_share") &&
						!m.bot_id,
				)
				.reverse();

			console.log(
				`[pipeline] Processing ${userMessages.length} user messages in chronological order...`,
			);

			const tasks = [];
			const issues = [];
			const discussions = [];

			for (const msg of userMessages) {
				try {
					const sender = userDirectory[msg.user] || {
						id: msg.user,
						name: msg.user,
						real_name: msg.user,
						display_name: msg.user,
					};

					const existingWork = await findWorkByMessageTs(msg.ts);
					const existingDiscussion = await Discussion.findOne({
						slack_message_ts: msg.ts,
					}).lean();
					if (
						existingWork.task ||
						existingWork.issue ||
						existingDiscussion
					) {
						console.log(
							`[pipeline] Skipping already processed message: ${msg.ts}`,
						);
						continue;
					}

					const rawPayload = {
						text: msg.text,
						sender,
						channel: channelId,
						thread_id: msg.thread_ts || msg.ts,
						message_ts: msg.ts,
						workspace_id: req.body?.workspace_id || "",
						team: req.body?.team || "",
						is_edit: false,
						user_directory: userDirectory,
					};

					const result = await messageProcessor.process(rawPayload, {
						quiet: true,
					});

					if (result) {
						if (result.classification === "TASK" || result.task) {
							tasks.push(result.task || result);
						} else if (
							result.classification === "ISSUE" ||
							result.issue
						) {
							issues.push(result.issue || result);
						} else {
							discussions.push(result);
						}
					}
				} catch (msgErr) {
					console.warn(
						`[pipeline warning] Failed to process message (${msg.ts}):`,
						msgErr.message,
					);
				}
			}

			console.log(
				`[pipeline complete] Extracted Tasks: ${tasks.length} | Issues: ${issues.length} | Discussions: ${discussions.length}`,
			);

			try {
				const members = Object.values(userDirectory).map((u) => ({
					id: u.id || "",
					name: u.name || "",
					display_name: u.display_name || u.real_name || u.name || "",
					real_name: u.real_name || u.name || "",
					email: u.email || "",
				}));

				const teamId = `team_${channelId}`;
				await Team.findOneAndReplace(
					{ channel_id: channelId },
					{
						team_id: teamId,
						channel_id: channelId,
						channel_name: req.body?.channel_name || channelId,
						workspace_id: req.body?.workspace_id || "",
						team: req.body?.team || "",
						members,
						member_count: members.length,
						last_synced_at: new Date(),
					},
					{ upsert: true, new: true },
				);
				console.log(
					`[pipeline] Team synced for channel: ${channelId} (${members.length} members)`,
				);
			} catch (teamErr) {
				console.warn(
					`[pipeline warning] Failed to sync team:`,
					teamErr.message,
				);
			}

			return res.json({
				success: true,
				messages_processed: rawMessages.length,
				user_messages_analyzed: userMessages.length,
				tasks_count: tasks.length,
				issues_count: issues.length,
				discussions_count: discussions.length,
				tasks,
				issues,
				discussions,
			});
		} catch (error) {
			console.error("[pipeline fatal error]", error);
			return res.status(500).json({
				success: false,
				error: error.message || "Pipeline execution failed",
			});
		}
	});

	// Global Error Handler Middleware
	app.use((err, _req, res, _next) => {
		console.error("[api]", err);
		res.status(err.status || 500).json({
			error: err.message || "Internal Server Error",
		});
	});

	io.on("connection", (socket) => {
		console.log("[socket] client connected", socket.id);
		socket.on("disconnect", () =>
			console.log("[socket] client disconnected", socket.id),
		);
	});

	const slackApp = createSlackApp({
		messageProcessor,
		notificationService,
		connectService,
	});
	if (slackApp) {
		try {
			if (config.slack.socketMode) {
				await slackApp.start();
			} else {
				await slackApp.start(PORT + 1);
			}
			console.log("[slack] Bolt app started");
		} catch (err) {
			const slackErr = err?.data?.error || err.message;
			console.error(
				`[slack] Failed to start (${slackErr}). API will keep running without Slack. ` +
				"Fix tokens in backend/.env: SLACK_BOT_TOKEN (xoxb-…), SLACK_SIGNING_SECRET, SLACK_APP_TOKEN (xapp-…).",
			);
			if (slackErr === "invalid_auth") {
				console.error(
					"[slack] invalid_auth usually means the bot token was revoked, regenerated, or copied incorrectly. " +
					"Reinstall the app to the workspace and copy the Bot User OAuth Token from OAuth & Permissions.",
				);
			}
		}
	}

	// Express backend example
	// Example Express Backend Route for Search
	app.get('/api/search', async (req, res) => {
		try {
			const searchQuery = req.query.q;
			if (!searchQuery) {
				return res.json({ tasks: [], issues: [], members: [] });
			}

			const regex = new RegExp(searchQuery, 'i'); // Case-insensitive search

			// Replace Task, Issue, and User with your actual Mongoose/Database models
			const matchingTasks = await Task.find({
				$or: [
					{ title: regex },
					{ description: regex }
				]
			}).limit(20);

			const matchingIssues = await Issue.find({
				$or: [
					{ title: regex },
					{ description: regex }
				]
			}).limit(20);

			res.json({
				tasks: matchingTasks,
				issues: matchingIssues,
				query: searchQuery
			});
		} catch (err) {
			console.error('Database search error:', err);
			res.status(500).json({ error: 'Internal server error during search' });
		}
	});



	// 🟢 Get All Slack Channels for Dropdown
	app.get("/api/slack/channels", async (req, res) => {
		try {
			const slackRes = await slackClient.conversations.list({
				types: "public_channel,private_channel",
				exclude_archived: true,
				limit: 100,
			});

			const channels = (slackRes.channels || []).map((ch) => ({
				id: ch.id,
				name: ch.name,
				is_private: ch.is_private,
			}));

			return res.json({
				success: true,
				channels,
			});
		} catch (error) {
			console.error("[channels endpoint error]", error);
			return res.status(500).json({
				success: false,
				error: error.message || "Failed to fetch Slack channels",
				channels: [],
			});
		}
	});

	startReminderScheduler(notificationService);

	startStandupScheduler();

	await cleanupCompletedWork().catch((err) =>
		console.error("[retention warning]", err.message),
	);

	server.listen(PORT, () => {
		console.log(
			`[api] AI Engineering Manager listening on http://localhost:${config.port}`,
		);
	});
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
