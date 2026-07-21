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

		// ✨ FIXED: Bolt expects these inside socketModeOptions with an aggressive ping interval
		appOptions.socketModeOptions = {
			clientPingTimeout: 30000,
			serverPingTimeout: 30000,
			pingInterval: 10000,
		};
	}

	const app = new App(appOptions);

	if (notificationService) {
		notificationService.setSlackClient(app.client);
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

				const result = await messageProcessor.process({
					text: chunk,
					sender,
					channel: event.channel,
					thread_id: event.thread_ts || event.ts,
					workspace_id: event.team || "",
					team: event.team || "",
					message_ts: is_edit ? chunkTs : chunkTs,
					is_edit,
					user_directory,
					slack_client: client,
				});

				console.log(
					`[slack] ${result.action} classification=${result.classification} confidence=${result.confidence}`,
				);

				if (result.task_created || result.issue_created) {
					const isTask = result.task_created;
					const workItem = isTask ? result.task : result.issue;

					const assigneeTag = workItem.assigned_to?.id
						? `<@${workItem.assigned_to.id}>`
						: workItem.assigned_to?.name || "Unassigned";

					const label = isTask
						? `🎯 *Task Tracked:* '${workItem.title}'\nAssigned to: ${assigneeTag} [${workItem.priority}/${workItem.status}]`
						: `🚨 *Issue Tracked:* '${workItem.title}'\nAssigned to: ${assigneeTag} [${workItem.priority}/${workItem.status}]`;

					try {
						// UPDATED: Post an ephemeral reply in the thread that ONLY the sender can see!
						await client.chat.postEphemeral({
							channel: event.channel,
							thread_ts: event.thread_ts || event.ts,
							user: event.user, // <--- This ensures ONLY the person who typed the message sees it
							text: label,
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

	// --- NEW: Bulletproof Block Kit Handlers ---

	// 1. Target says "Yes, I'm Free"
	app.action(
		"accept_sync_btn",
		async ({ action, ack, respond, client, body }) => {
			await ack();

			setTimeout(async () => {
				try {
					const [taskId, senderId] = action.value.split("|");

					await respond({
						text: "✅ Thanks! I've let them know you are looking into it.",
						replace_original: true,
					});

					if (senderId && senderId !== "unknown") {
						const taskText =
							taskId === "general"
								? "connect with you"
								: `look into the blocked task (*${taskId}*)`;
						await client.chat.postMessage({
							channel: senderId,
							text: `🔔 Good news! <@${body.user.id}> is available and will ${taskText} right now.`,
						});
					}
				} catch (err) {
					console.error("[slack] accept_sync error:", err.message);
				}
			}, 0);
		},
	);

	// 2. Target says "Ping Me Later" -> Ask for a timeframe
	app.action("later_sync_btn", async ({ action, ack, respond }) => {
		await ack();

		setTimeout(async () => {
			try {
				const payload = action.value;
				await respond({
					replace_original: true,
					blocks: [
						{
							type: "section",
							text: {
								type: "mrkdwn",
								text: "Got it. When will you be free to connect?",
							},
						},
						{
							type: "actions",
							elements: [
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "5 Mins",
									},
									action_id: "delay_sync_5_btn",
									value: payload,
								},
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "10 Mins",
									},
									action_id: "delay_sync_10_btn",
									value: payload,
								},
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "30 Mins",
									},
									action_id: "delay_sync_30_btn",
									value: payload,
								},
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "1 Hour",
									},
									action_id: "delay_sync_60_btn",
									value: payload,
								},
								{
									type: "button",
									text: {
										type: "plain_text",
										text: "Custom",
									},
									action_id: "custom_sync_btn",
									value: payload,
								},
							],
						},
					],
				});
			} catch (err) {
				console.error("[slack] later_sync error:", err.message);
			}
		}, 0);
	});

	// 3. Open a Modal when they click "Custom"
	app.action("custom_sync_btn", async ({ action, ack, body, client }) => {
		await ack();

		setTimeout(async () => {
			try {
				await client.views.open({
					trigger_id: body.trigger_id,
					view: {
						type: "modal",
						callback_id: "custom_time_modal",
						private_metadata: action.value,
						title: { type: "plain_text", text: "Set Custom Delay" },
						submit: { type: "plain_text", text: "Confirm" },
						close: { type: "plain_text", text: "Cancel" },
						blocks: [
							{
								type: "input",
								block_id: "time_input",
								element: {
									type: "plain_text_input",
									action_id: "minutes",
									placeholder: {
										type: "plain_text",
										text: "e.g., 15",
									},
								},
								label: {
									type: "plain_text",
									text: "Enter minutes to delay",
								},
							},
						],
					},
				});
			} catch (err) {
				console.error("[slack] Modal open failed:", err.message);
			}
		}, 0);
	});

	// --- HELPER FUNCTION: Centralized Scheduler (RESTORED!) ---
	async function scheduleSync(
		client,
		delayMinutes,
		taskId,
		senderId,
		targetUserId,
		respondFunction,
	) {
		const taskText =
			taskId === "general"
				? "connect"
				: `look into the blocked task (*${taskId}*)`;

		if (respondFunction) {
			await respondFunction({
				text: `Understood. I've let them know you'll be free in ${delayMinutes} minutes. You will both get a reminder then.`,
				replace_original: true,
			});
		} else {
			await client.chat.postMessage({
				channel: targetUserId,
				text: `✅ Delay set! I'll remind you both in ${delayMinutes} minutes.`,
			});
		}

		if (senderId && senderId !== "unknown") {
			await client.chat.postMessage({
				channel: senderId,
				text: `🕒 <@${targetUserId}> is currently busy, but will be free in *${delayMinutes} minutes* to ${taskText}.`,
			});
		}

		// Slack rejects post_at values less than 60 s in the future
		const postAt =
			Math.floor(Date.now() / 1000) + Math.max(delayMinutes * 60, 65);

		try {
			await client.chat.scheduleMessage({
				channel: senderId,
				post_at: postAt,
				text: `🔔 *Reminder:* <@${targetUserId}> should be free now to ${taskText}!`,
			});
			await client.chat.scheduleMessage({
				channel: targetUserId,
				post_at: postAt,
				text: `🔔 *Reminder:* You are scheduled to ${taskText} with <@${senderId}> right now!`,
			});
		} catch (err) {
			console.error("[slack] Failed to schedule reminders:", err.message);
		}
	}

	// 4. Handle standard quick-select delay buttons
	app.action(
		/delay_sync_(\d+)_btn/,
		async ({ action, ack, respond, client, body }) => {
			await ack();

			setTimeout(async () => {
				try {
					const delay = parseInt(action.action_id.split("_")[2], 10);
					const [taskId, senderId] = action.value.split("|");
					const targetUserId = body.user.id;

					const openSender = await client.conversations
						.open({ users: senderId })
						.catch(() => null);
					const openTarget = await client.conversations
						.open({ users: targetUserId })
						.catch(() => null);
					const senderChannel = openSender?.channel?.id || senderId;
					const targetChannel =
						openTarget?.channel?.id || targetUserId;

					await scheduleSync(
						client,
						delay,
						taskId,
						senderChannel,
						targetChannel,
						respond,
					);
				} catch (err) {
					console.error("[slack] delay_sync error:", err.message);
				}
			}, 0);
		},
	);

	// 5. Handle the Custom Time Modal Submission
	app.view("custom_time_modal", async ({ ack, view, client, body }) => {
		const minutesInput = view.state.values.time_input.minutes.value;
		const delay = parseInt(minutesInput, 10);

		if (isNaN(delay) || delay <= 0) {
			await ack({
				response_action: "errors",
				errors: {
					time_input:
						"Please enter a valid number of minutes (e.g., 15).",
				},
			});
			return;
		}

		await ack();

		setTimeout(async () => {
			try {
				const [taskId, senderId] = view.private_metadata.split("|");
				const targetUserId = body.user.id;

				const openSender = await client.conversations
					.open({ users: senderId })
					.catch(() => null);
				const openTarget = await client.conversations
					.open({ users: targetUserId })
					.catch(() => null);
				const senderChannel = openSender?.channel?.id || senderId;
				const targetChannel = openTarget?.channel?.id || targetUserId;

				await scheduleSync(
					client,
					delay,
					taskId,
					senderChannel,
					targetChannel,
					null,
				);
			} catch (err) {
				console.error("[slack] custom_time_modal error:", err.message);
			}
		}, 0);
	});

	return app;
}

module.exports = { createSlackApp };
