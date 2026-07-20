const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

process.env.TZ = "Asia/Kolkata";

const config = require("./config");
const { createApiRouter } = require("./routes/api");
const { NotificationService } = require("./services/notifications");
const { MessageProcessor } = require("./services/messageProcessor");
const { createSlackApp } = require("./slack/app");
const { startReminderScheduler } = require("./jobs/reminders");

async function main() {
	await mongoose.connect(config.mongodbUri);
	console.log("[db] Connected to MongoDB");

	const app = express();
	const server = http.createServer(app);
	const io = new Server(server, {
		cors: { origin: config.corsOrigin, methods: ["GET", "POST", "PATCH"] },
	});

	const notificationService = new NotificationService({ io });
	const messageProcessor = new MessageProcessor({ notificationService, io });

	app.use(helmet({ contentSecurityPolicy: false }));
	app.use(cors({ origin: config.corsOrigin }));
	app.use(express.json({ limit: "1mb" }));
	app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

	app.use("/api", createApiRouter({ messageProcessor }));

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

	const slackApp = createSlackApp({ messageProcessor, notificationService });
	if (slackApp) {
		try {
			if (config.slack.socketMode) {
				await slackApp.start();
			} else {
				// HTTP mode — use a separate port from the Express API
				await slackApp.start(config.port + 1);
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

	server.listen(config.port, () => {
		console.log(
			`[api] AI Engineering Manager listening on http://localhost:${config.port}`,
		);
	});
}

main().catch((err) => {
	console.error("Fatal startup error:", err);
	process.exit(1);
});
