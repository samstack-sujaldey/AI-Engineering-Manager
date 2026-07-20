const { App } = require("@slack/bolt");
const config = require("../config");
const { toUser } = require("../agent/parser");
const axios = require("axios");
const pdfParse = require("pdf-parse");

function looksLikePlaceholder(value, prefixes = []) {
	if (!value) return true;
	const lower = value.toLowerCase();
	if (
		lower.includes("your-") ||
		lower.includes("change-me") ||
		lower.includes("placeholder")
	) {
		return true;
	}
	return prefixes.length > 0 && !prefixes.some((p) => value.startsWith(p));
}

function createSlackApp({ messageProcessor, notificationService }) {
	const { botToken, signingSecret, appToken, socketMode } = config.slack;

	if (!botToken || !signingSecret) {
		console.warn(
			"[slack] Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET — Slack disabled",
		);
		return null;
	}

	if (
		looksLikePlaceholder(botToken, ["xoxb-"]) ||
		looksLikePlaceholder(signingSecret)
	) {
		console.warn(
			"[slack] SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET look like placeholders — Slack disabled. " +
				"Paste real values from https://api.slack.com/apps → your app → OAuth & Permissions / Basic Information.",
		);
		return null;
	}

	const appOptions = {
		token: botToken,
		signingSecret,
	};

	if (socketMode) {
		if (!appToken || looksLikePlaceholder(appToken, ["xapp-"])) {
			console.warn(
				"[slack] Valid SLACK_APP_TOKEN (xapp-…) required for Socket Mode — Slack disabled. " +
					"Enable Socket Mode and create an App-Level Token with connections:write.",
			);
			return null;
		}
		appOptions.socketMode = true;
		appOptions.appToken = appToken;
	}

	const app = new App(appOptions);

	if (notificationService) {
		notificationService.setSlackClient(app.client);
	}

	// Build a user-directory keyed by Slack id from the @mentions in a message
	async function buildDirectory(client, text) {
		const ids = [...(text || "").matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
		const directory = {};
		await Promise.all(
			ids.map(async (id) => {
				try {
					const info = await client.users.info({ user: id });
					const u = info.user || {};
					directory[id] = {
						id: u.id,
						name: u.name,
						display_name:
							u.profile?.display_name || u.real_name || u.name,
						email: u.profile?.email || "",
						real_name: u.real_name,
					};
				} catch {
					directory[id] = { id, name: id, display_name: id };
				}
			})
		);
		return directory;
	}

	async function resolveSender(client, userId) {
		try {
			const info = await client.users.info({ user: userId });
			const u = info.user || {};
			return toUser({
				id: u.id,
				name: u.name,
				display_name: u.profile?.display_name || u.real_name || u.name,
				email: u.profile?.email || "",
				real_name: u.real_name,
			});
		} catch {
			return toUser({ id: userId, name: userId, display_name: userId });
		}
	}

	// NEW: Cache all workspace users for plain-text name matching
	let workspaceUsersCache = null;
	async function getWorkspaceUsers(client) {
		if (workspaceUsersCache) return workspaceUsersCache;
		workspaceUsersCache = {};
		try {
			let cursor;
			do {
				const res = await client.users.list({ cursor, limit: 200 });
				for (const u of res.members || []) {
					if (u.deleted || u.is_bot) continue;
					workspaceUsersCache[u.id] = {
						id: u.id,
						name: u.name,
						display_name:
							u.profile?.display_name || u.real_name || u.name,
						email: u.profile?.email || "",
						real_name: u.real_name,
					};
				}
				cursor = res.response_metadata?.next_cursor;
			} while (cursor);
		} catch (err) {
			console.error(
				"[slack] Failed to fetch workspace users",
				err.message,
			);
		}
		return workspaceUsersCache;
	}

	// UPDATED FOR PDF-PARSE v2.x API
	async function extractPdfText(url, token) {
		try {
			const response = await axios.get(url, {
				headers: { Authorization: `Bearer ${token}` },
				responseType: "arraybuffer",
			});

			// The new pdf-parse requires a Uint8Array
			const fileData = new Uint8Array(response.data);

			// Destructure the newly exposed PDFParse class
			const { PDFParse } = require("pdf-parse");

			if (!PDFParse) {
				throw new Error(
					"PDFParse class not found in pdf-parse library.",
				);
			}

			// Initialize the modern parser
			const parser = new PDFParse(fileData);

			// Extract the text
			const result = await parser.getText();

			// Clean up memory (recommended by the new library docs)
			if (typeof parser.destroy === "function") {
				await parser.destroy();
			}

			// Return the text (safeguard against both string and object return formats)
			return typeof result === "string" ? result : result.text || "";
		} catch (err) {
			console.error("[slack] Failed to extract PDF:", err.message);
			return "";
		}
	}

	async function handleMessage(event, client, { is_edit = false } = {}) {
		if (event.bot_id || event.subtype === "bot_message") return;

		const text = event.text || "";
		const sender = await resolveSender(client, event.user);
		const user_directory = await getWorkspaceUsers(client);

		// 1. DECLARE RESULT OUTSIDE THE IF BLOCK
		let result = null;

		// 2. Process the normal chat message text
		if (text.trim()) {
			// Split multi-line messages if they contain multiple distinct task assignments
			const lines = text
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);
			const explicitLines = lines.filter(
				(l) => /task\s*-/i.test(l) || /issue\s*-/i.test(l),
			);
			const textsToProcess =
				explicitLines.length > 1 ? explicitLines : [text];

			for (let i = 0; i < textsToProcess.length; i++) {
				const chunk = textsToProcess[i];
				const chunkTs =
					explicitLines.length > 1 ? `${event.ts}_${i}` : event.ts;

				result = await messageProcessor.process({
					text: chunk,
					sender,
					channel: event.channel,
					thread_id: event.thread_ts || event.ts,
					workspace_id: event.team || "",
					team: event.team || "",
					message_ts: is_edit ? chunkTs : chunkTs,
					is_edit,
					user_directory,
				});

				console.log(
					`[slack] ${result.action} classification=${result.classification} confidence=${result.confidence}`,
				);

				if (result.task_created || result.issue_created) {
					const label = result.task_created
						? `Task *${result.task.title}* assigned to ${result.task.assigned_to?.name || "Unassigned"}`
						: `Issue *${result.issue.title}* assigned to ${result.issue.assigned_to?.name || "Unassigned"}`;
					try {
						// NEW: Post an ephemeral (invisible) confirmation that ONLY the sender sees!
						await client.chat.postEphemeral({
							channel: event.channel,
							user: event.user, // The person who sent the message
							text: `✅ Tracked Privately: ${label}`,
						});
					} catch (err) {
						console.error(
							"[slack] ephemeral confirmation failed:",
							err.message,
						);
					}
				}
			}
		}

		// 3. Process PDF files attached to the message
		if (event.files && event.files.length > 0) {
			for (const file of event.files) {
				if (
					file.mimetype === "application/pdf" &&
					file.url_private_download
				) {
					const pdfContent = await extractPdfText(
						file.url_private_download,
						client.token,
					);

					if (pdfContent) {
						// 1. Split the document by "Name: " so each chunk belongs to one specific person
						const userBlocks = pdfContent.split(/(?=Name:\s*)/i);

						for (const block of userBlocks) {
							// Ignore document headers/footers that don't contain a user assignment
							if (!block.toLowerCase().trim().startsWith("name:"))
								continue;

							// Extract the assigned user's name
							const nameMatch =
								block.match(/Name:\s*([A-Za-z]+)/i);
							const assigneeName = nameMatch
								? nameMatch[1].toLowerCase()
								: "";

							if (!assigneeName) continue;

							// 2. Split the user's block by "Task 1:", "Task 2:", etc.
							const taskChunks = block.split(/Task\s*\d+:/i);

							// 3. Loop through the extracted tasks (skipping index 0, which is just the "Name:" header)
							for (let i = 1; i < taskChunks.length; i++) {
								// Clean up the task text and remove any footer text like "Project:" or "Prepared By:"
								let taskDesc = taskChunks[i]
									.replace(/Project:[\s\S]*/i, "")
									.replace(/Prepared By:[\s\S]*/i, "")
									.replace(/\n/g, " ")
									.trim();

								if (taskDesc.length > 3) {
									// 4. Translate the PDF block into a clear sentence for the AI parser!
									const simulatedMessage = `@${assigneeName} please implement: ${taskDesc}`;

									const lineDirectory = await buildDirectory(
										client,
										simulatedMessage,
									);
									const mergedDirectory = {
										...user_directory,
										...lineDirectory,
									};

									await messageProcessor.process({
										text: simulatedMessage,
										sender,
										channel: event.channel,
										thread_id: event.thread_ts || event.ts,
										workspace_id: event.team || "",
										team: event.team || "",
										message_ts: event.ts,
										is_edit: false,
										user_directory: mergedDirectory,
									});
								}
							}
						}

						try {
							await client.chat.postMessage({
								channel: event.channel,
								thread_ts: event.thread_ts || event.ts,
								text: `✅ Processed PDF document: *${file.name}*`,
							});
						} catch (err) {}
					}
				}
			}
		}

		// Now this will safely return either the parsed object or null
		return result;
	}

	// Single message listener — handles new messages and edits via subtype
	app.event("message", async ({ event, client }) => {
		try {
			if (event.subtype === "message_changed" && event.message) {
				await handleMessage(
					{
						...event.message,
						channel: event.channel,
						team: event.team || event.message.team,
						ts: event.message.ts,
					},
					client,
					{ is_edit: true },
				);
				return;
			}

			if (event.subtype && event.subtype !== "file_share") return;
			await handleMessage(event, client, { is_edit: false });
		} catch (err) {
			console.error("[slack] message handler error:", err);
		}
	});

	return app;
}

module.exports = { createSlackApp };
