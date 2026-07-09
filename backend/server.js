import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import slackRoutes from "./routes/slack.routes.js";
import standupRoutes from "./routes/standup.routes.js";
import taskRoutes from "./routes/tasks.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Middleware ───────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────
app.use("/api/slack", slackRoutes);
app.use("/api/standup", standupRoutes);
app.use("/api/tasks", taskRoutes);

// Health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────
connectDB()
	.then(() => {
		app.listen(PORT, () => {
			console.log(`\n🚀 Server running on http://localhost:${PORT}`);
			console.log(`\n📋 Available endpoints:`);
			console.log(`   GET  /health`);
			console.log(
				`   GET  /api/slack/install              → Start Slack OAuth`,
			);
			console.log(
				`   GET  /api/slack/oauth/callback       → Slack OAuth callback`,
			);
			console.log(
				`   GET  /api/slack/channels             → List channels`,
			);
			console.log(
				`   POST /api/slack/channels/:id/join    → Join a channel`,
			);
			console.log(
				`   GET  /api/slack/channels/:id/messages → Fetch raw messages`,
			);
			console.log(
				`   POST /api/slack/channels/:id/process → 🔥 FULL PIPELINE`,
			);
			console.log(
				`   POST /api/slack/webhook              → Receive Slack events`,
			);
			console.log(
				`   POST /api/standup                    → Manual standup submit\n`,
			);
		});
	})
	.catch((error) => {
		console.error("❌ Failed to connect to MongoDB:", error.message);
		process.exit(1);
	});
