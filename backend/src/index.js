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
const { Discussion, Team , Task , Issue} = require("./models");
const { createSlackApp } = require("./slack/app");
const { startReminderScheduler } = require("./jobs/reminders");
const slackAuthRoutes = require("./routes/slack.js");
const { createAuthRouter } = require("./routes/auth.js");
const seedAdmin = require("./scripts/seed.js");

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

	startReminderScheduler(notificationService);

	startStandupScheduler();

	await cleanupCompletedWork().catch((err) =>
		console.error("[retention warning]", err.message),
	);

	server.listen(PORT, () => {
		console.log(
			`[api] AI Engineering Manager listening on http://localhost:${PORT}`,
		);
	});
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
