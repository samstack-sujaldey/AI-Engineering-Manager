const express = require("express");
const axios = require("axios");
const router = express.Router();

// 1. The Install Endpoint (Triggered by your Angular button)
router.get("/install", (req, res) => {
	const clientId = process.env.SLACK_CLIENT_ID;
	const redirectUri = process.env.SLACK_REDIRECT_URI;

	// Define the permissions your app needs
	const scopes = "channels:history,channels:read,chat:write,users:read";

	// Redirect user to the Slack authorization page
	const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`;
	res.redirect(slackAuthUrl);
});

// 2. The Redirect Callback Endpoint (Triggered by Slack after user approves)
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

module.exports = router;
