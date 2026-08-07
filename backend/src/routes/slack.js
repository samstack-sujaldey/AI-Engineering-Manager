const express = require("express");
const axios = require("axios");
const router = express.Router();
const { createSlackClient,listChannels } = require("../services/slackSync");

// Install Endpoint (Triggered by your Angular button)
router.get("/install", (req, res) => {
	const clientId = process.env.SLACK_CLIENT_ID;
	const redirectUri = process.env.SLACK_REDIRECT_URI;

	// Define the permissions your app needs
	const scopes = "channels:history,channels:read,chat:write,users:read";

	// Redirect user to the Slack authorization page
	const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`;
	res.redirect(slackAuthUrl);
});

// Redirect Callback Endpoint (Triggered by Slack after user approves)
router.get("/oauth_redirect", async (req, res) => {
	const code = req.query.code;

	if (!code) {
		return res.status(400).send("Authorization failed: No code provided");
	}

	try {
		// Exchange the temporary code for a permanent access token
		const response = await axios.post(
			"https://slack.com/api/oauth.v2.access",
			null,
			{
				params: {
					client_id: process.env.SLACK_CLIENT_ID,
					client_secret: process.env.SLACK_CLIENT_SECRET,
					code: code,
					redirect_uri: process.env.SLACK_REDIRECT_URI,
				},
			},
		);

		if (response.data.ok) {
			const accessToken = response.data.access_token;
			const teamId = response.data.team.id;
			const teamName = response.data.team.name;

			// TODO: Save the accessToken and teamId to your database (e.g., in a Workspace model)
			// Example: await Workspace.findOneAndReplace({ teamId }, { accessToken, teamName }, { upsert: true });

			res.redirect(`${process.env.FRONTEND_URL}/dashboard?slackConnected=true`);
		} else {
			res.status(400).send(`Error from Slack: ${response.data.error}`);
		}
	} catch (error) {
		console.error("Slack OAuth Error:", error);
		res.status(500).send("Internal Server Error while connecting Slack");
	}
});

// slack routes
  router.post("/sync", async (req, res, next) => {
    try {
      if (!messageProcessor) {
        return res.status(503).json({ error: "Message processor not ready" });
      }
      const limit = req.body?.limit_per_channel
        ? parseInt(req.body.limit_per_channel, 10)
        : undefined;
      const channelIds = Array.isArray(req.body?.channels)
        ? req.body.channels
        : undefined;
      const channelId = req.body?.channel_id || undefined;

      const result = await syncFromSlack(messageProcessor, {
        ...(limit ? { limitPerChannel: limit } : {}),
        ...(channelId ? { channelId } : {}),
      });
      res.json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code || "slack_sync_failed",
        });
      }
      next(err);
    }
  });

  router.get("/channels", async (_req, res, next) => {
    try {
      const client = createSlackClient();
      const rawChannels = await listChannels(client);

      const channels = rawChannels.map((ch) => ({
        id: ch.id,
        name: `#${ch.name}`,
        members: ch.num_members || 4,
        status: "Bot in channel",
      }));

      res.json({ channels });
    } catch (err) {
      next(err);
    }
  });

  // Pipeline Endpoint: Sync historical channel activity
  router.post("/pipeline/:channelId", async (req, res) => {
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
			
			let channelName = req.body?.channel_name || '';
			if (!channelName || channelName === channelId) {
				try {
					const channelInfo = await slackClient.conversations.info({ channel: channelId });
					channelName = (channelInfo.channel?.name || channelId).replace(/^#/, '').trim();
				} catch (channelErr) {
					console.warn('[pipeline] Failed to fetch channel name from Slack:', channelErr.message);
					channelName = channelId;
				}
			}
			
			await Team.findOneAndReplace(
				{ channel_id: channelId },
				{
					team_id: teamId,
					channel_id: channelId,
					channel_name: channelName,
					workspace_id: req.body?.workspace_id || "",
					team: req.body?.team || channelName,
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

  // 🟢 Get All Slack Channels for Dropdown
	router.get("/channels", async (req, res) => {
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

module.exports = router;
