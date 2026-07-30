const { App } = require("@slack/bolt");
const config = require("../config");
const {
  toUser,
  extractDueDate,
  extractMentionedUsers,
} = require("../agent/parser");
const { ConnectService } = require("../services/connectService");
const {
  buildDirectory,
  downloadSlackAttachments,
} = require("../services/slackSync");
const {extractAttachments}=require('../attachments/extractor')
const axios = require("axios");

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

function createSlackApp({
  messageProcessor,
  notificationService,
  connectService,
}) {
  const { botToken, signingSecret, appToken, socketMode } = config.slack;
  const connect = connectService || new ConnectService();

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

  async function handleMessage(event, client, { is_edit = false,botUserId = null } = {}) {
    console.log(
      `[Connect] handleMessage called - channel: ${event.channel}, user: ${event.user}, subtype: ${event.subtype || "none"}, bot_id: ${event.bot_id || "none"}`,
    );
    if (event.bot_id || event.subtype === "bot_message") return null;

	let text = event.text || "";
	const lowerText = text.toLowerCase();
    const channelId = event.channel || "";

	// 🟢 GATEKEEPER START 🟢
 const isDM = channelId.startsWith("D");
    const isBotTagged = botUserId && text.includes(`<@${botUserId}>`);
    const hasAiemKeyword = text.toLowerCase().includes("@aiem");

    // 2. Check if this message is a reply inside a thread that already tracks a task or issue
    const threadRoot = event.thread_ts || event.ts;
    const isThreadReply = event.thread_ts && event.thread_ts !== event.ts;
    
    let hasExistingWorkInThread = false;
    if (isThreadReply) {
        // Query your database helpers to see if a task or issue is tied to this thread root
        const { findWorkByThread } = require("../services/similarity");
        const existingWork = await findWorkByThread(threadRoot, channelId);
        hasExistingWorkInThread = !!(existingWork.task || existingWork.issue);
    }

    const pendingConnect = connect.getByTarget(event.user);
    const relatedWorkPrompt = isThreadReply ? connect.getRelatedWorkRequest(event.thread_ts) : null;

    // 🟢 ALLOW INVOCATION IF TAGGED, IN A DM, OR IF IT'S A THREAD REPLY TO AN EXISTING TASK/ISSUE
    const isBotInvoked = isDM || isBotTagged || hasAiemKeyword || hasExistingWorkInThread;

    if (!isBotInvoked && !pendingConnect && !relatedWorkPrompt) {
        return null; // Silently ignore untagged channel chatter
    }

    // Strip out the bot's user tag if present so the parser gets clean text
    if (botUserId) {
        text = text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
    }
    // 🟢 GATEKEEPER END 🟢


    const sender = await resolveSender(client, event.user);
    const user_directory = await getWorkspaceUsers(client);

    // Download Slack attachments locally for background analysis
    let downloadedFiles = [];
    if (event.files && event.files.length > 0) {
      try {
		 // 🟢 Optional: Send a quick indicator message in chat if desired, 
         // or just keep it silent until extraction completes.

        const rawAttachments = event.files.map((f) => ({
          slackFileId: f.id,
          fileName: f.name,
          mimeType: f.mimetype,
          fileType: f.filetype,
          urlPrivateDownload: f.url_private_download || f.url_private,
          urlPrivate: f.url_private,
          size: f.size,
        }));

        downloadedFiles = await downloadSlackAttachments(
          rawAttachments,
          client.token,
        );

        if (downloadedFiles.length === 0) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.thread_ts || event.ts,
            text: `⚠️ Failed to download the attached file(s). Please check bot token scopes (files:read).`,
          });
        }

        // Parse downloaded text/code/snippet files
        for (const file of downloadedFiles) {
          const isTextMime =
            file.mimeType &&
            (file.mimeType.startsWith("text/") ||
              file.mimeType.includes("json"));
          const isTextType = [
            "text",
            "markdown",
            "space",
            "csv",
            "json",
            "log",
            "js",
            "ts",
            "py",
            "doc",
            "docx",
          ].includes(file.fileType);

          if (isTextMime || isTextType) {
            try {
              const snippetContent = await fs.readFile(file.localPath, "utf8");
              text += "\n" + snippetContent;
                            console.log(`[slack] Extracted long text from Slack Snippet: ${file.fileName}`);
            } catch (err) {
                            console.error("[slack] Failed to read text snippet:", err.message);
            }
          }
        }
      } catch (downloadErr) {
                console.error("[slack] Attachment download pipeline error:", downloadErr.message);
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: event.thread_ts || event.ts,
          text: `❌ Error downloading attachments: ${downloadErr.message}`,
        });
      }
    }

	// 🟢 Enrich text payload with OpenAI Vision summary for uploaded images
    if (downloadedFiles.length > 0) {
    const processedAttachments = await extractAttachments(downloadedFiles);
    
    for (const file of processedAttachments) {
        if (!file.extracted) {
             console.warn(`[slack] Failed to extract ${file.fileName}: ${file.error}`);
             continue;
        }

        if (file.type === "IMAGE") {
            const visionSummary = file.content.summary || file.content.text || "";
            if (visionSummary) text += `\n[Image Context: ${visionSummary}]`;
        } else {
             // For text, PDF, DOCX, CSV, JSON, etc.
             const contentStr = typeof file.content === "string" 
                ? file.content 
                : JSON.stringify(file.content);
             text += `\n\n--- Content from ${file.fileName} ---\n${contentStr}`;
        }
    }
}


    console.log(`[DEBUG Lookup] event.user (Sender): ${event.user}`);
    console.log(`[DEBUG Lookup] pendingConnect found? ${!!pendingConnect}`);
		if (pendingConnect) {
			console.log(
				`[DEBUG Lookup] Expected targetUserId: ${pendingConnect.targetUserId}`,
			);
		}

    if (channelId.startsWith("D")) {
      console.log(
				`[Connect] DM event received - user: ${event.user}, channel: ${channelId}, pendingConnect found: ${!!pendingConnect}, pendingConnect target: ${pendingConnect?.targetUserId}, text: "${text}"`,
      );
    }

		// 🟢 1. DM Reply Catch Block (Handles relative time and routes back to thread)
    if (
      pendingConnect &&
			(channelId === pendingConnect.dmChannel ||
				channelId.startsWith("D")) &&
      !lowerText.startsWith("connect")
    ) {
      console.log(
        `[Connect] Intercepted DM reply from ${event.user}: "${text}"`,
      );

      const timeMatch = extractDueDate(text);
      let minMatch = text.match(/\b(\d+)\s*(?:m|min|mins|minutes?)\b/i);

      if (!minMatch) {
        const rawNumberMatch = text.trim().match(/^(\d+)$/);
        if (rawNumberMatch) minMatch = rawNumberMatch;
      }

			const hrMatch = text.match(
				/\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i,
			);
      const isFree =
				/\b(yes|yup|yeah|free|available|now|ready|ok|sure)\b/i.test(
					text,
				);

      if (isFree || timeMatch || minMatch || hrMatch) {
        let scheduledAt = null;
        let replyTextToReceiver = "";
        let updateTextToThread = "";

        if (isFree && !timeMatch && !minMatch && !hrMatch) {
          scheduledAt = new Date();
          replyTextToReceiver =
            "✅ Great! I've let them know you're free to connect right now.";
          updateTextToThread = `✅ <@${pendingConnect.targetUserId}> is free now and ready to connect!`;

          try {
						connect.updateStatus(
							event.user,
							"ACCEPTED",
							scheduledAt,
						);
          } catch (e) {
            console.error("[Connect] DB update failed:", e.message);
          }
        } else {
          let delayMins = 0;
          if (minMatch) {
            delayMins = parseInt(minMatch[1], 10);
            scheduledAt = new Date(Date.now() + delayMins * 60000);
          } else if (hrMatch) {
            delayMins = parseFloat(hrMatch[1]) * 60;
            scheduledAt = new Date(Date.now() + delayMins * 60000);
          } else if (timeMatch) {
            scheduledAt = new Date(timeMatch);
            if (scheduledAt <= new Date())
              scheduledAt.setDate(scheduledAt.getDate() + 1);
						delayMins = Math.round(
							(scheduledAt - new Date()) / 60000,
						);
          }

          const timeLabel = scheduledAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          replyTextToReceiver = `📅 Understood! I've scheduled the connection for *${timeLabel}*. I'll remind both of you then.`;
          updateTextToThread = `🕒 <@${pendingConnect.targetUserId}> will be free in *${delayMins} minutes* (at ${timeLabel}). Kindly wait, I will notify you again then.`;

          try {
						connect.updateStatus(
							event.user,
							"SCHEDULED",
							scheduledAt,
						);
          } catch (e) {
            console.error("[Connect] DB update failed:", e.message);
          }
        }

        const postAt = Math.floor(scheduledAt.getTime() / 1000);

        try {
          if (pendingConnect.channel && pendingConnect.threadTs) {
            await client.chat.postMessage({
              channel: pendingConnect.channel,
              thread_ts: pendingConnect.threadTs,
              text: updateTextToThread,
            });
          } else {
            await client.chat.postMessage({
              channel: pendingConnect.senderId,
              text: updateTextToThread,
            });
          }
        } catch (err) {
					console.error(
						"[Connect] Failed to update User A:",
						err.message,
					);
        }

        if (!(isFree && !timeMatch && !minMatch && !hrMatch)) {
          try {
            const safePostAt = Math.max(
              postAt,
              Math.floor(Date.now() / 1000) + 65,
            );
            await client.chat.scheduleMessage({
              channel: pendingConnect.senderId,
              post_at: safePostAt,
              text: `🔔 *Reminder:* It's time to connect with <@${pendingConnect.targetUserId}>!`,
            });
            await client.chat.scheduleMessage({
              channel: pendingConnect.targetUserId,
              post_at: safePostAt,
              text: `🔔 *Reminder:* It's time to connect with <@${pendingConnect.senderId}>!`,
            });
          } catch (err) {
						console.error(
							"[Connect] Scheduling failed:",
							err.message,
						);
          }
        }

        try {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: event.thread_ts,
            text: replyTextToReceiver,
          });
        } catch (err) {
					console.error(
						"[Connect] Failed to update User B DM:",
						err.message,
					);
        }

        connect.remove(event.user);
        return null;
      } else {
        try {
          await client.chat.postMessage({
            channel: pendingConnect.channel,
            thread_ts: pendingConnect.threadTs,
            text: `💬 <@${pendingConnect.targetUserId}> replied: *"${text}"*`,
          });
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: event.thread_ts,
            text: `✅ I've forwarded your reply to the thread.`,
          });
        } catch (err) {
					console.error(
						"[Connect] Fallback forwarding failed:",
						err.message,
					);
        }
        connect.remove(event.user);
        return null;
      }
    }

    // Thread-based connect flow for related work prompts
      if (event.thread_ts && event.thread_ts !== event.ts) {
			const relatedWorkPrompt = connect.getRelatedWorkRequest(
				event.thread_ts,
			);

			if (!relatedWorkPrompt) {
				console.log(
					`[Connect] Ignored thread reply. Memory wiped or prompt doesn't exist for ts: ${event.thread_ts}`,
				);
			}

			if (relatedWorkPrompt && relatedWorkPrompt.relatedUsers?.length) {
				console.log(
					`[Connect] Active thread reply detected! Processing...`,
				);

		        const replyText = text.trim();
                const lowerReply = replyText.toLowerCase();
                const mentionedUsers = extractMentionedUsers(
                  text,
                  user_directory || {},
                );

				let targetUser = mentionedUsers.find(
					(u) => u.id && u.id !== sender.id,
				);

        const rawMentionMatch = text.match(/<@([A-Z0-9]+)>/);
        if (
          !targetUser &&
          rawMentionMatch &&
          rawMentionMatch[1] !== sender.id
        ) {
					targetUser = {
						id: rawMentionMatch[1],
						name: "Mentioned User",
					};
        }

        // 🟢 Fallback: Aggressive Plain-Text Name Matching
        if (!targetUser) {
					const cleanName = lowerReply
						.replace(/[^a-z0-9]/g, "")
						.trim();
          if (cleanName.length > 2) {
            targetUser = relatedWorkPrompt.relatedUsers.find(
              (ru) =>
                ru.id &&
                ru.id !== sender.id &&
								((ru.name || "")
									.toLowerCase()
									.includes(cleanName) ||
									(ru.display_name || "")
										.toLowerCase()
										.includes(cleanName) ||
									(ru.real_name || "")
										.toLowerCase()
										.includes(cleanName)),
            );
          }
        }

        const isNo = /\b(no|nope|skip)\b/.test(lowerReply);

        if (isNo) {
          await client.chat.postEphemeral({
            channel: event.channel,
            user: sender.id,
            thread_ts: event.thread_ts,
            text: "OK, skipping the connect prompt.",
          });
          connect.removeRelatedWorkRequest(event.thread_ts);
          return null;
        } else if (targetUser) {
          try {
			console.log(
							`[Connect] Initiating DM flow to ${targetUser.id}`,
						);
            connect.createRequest({
              senderId: sender.id,
              senderName: sender.display_name || sender.name,
              targetUserId: targetUser.id,
							targetUserName:
								targetUser.display_name || targetUser.name,
              channel: event.channel,
              threadTs: event.thread_ts,
            });

			// Slack IDs act as valid DM channels natively
            connect.setDmChannel(targetUser.id, targetUser.id);

			// Send DM to target
            await client.chat.postMessage({
              channel: targetUser.id,
              text: `🔔 <@${sender.id}> wants to connect with you regarding related work. *When are you free?*\n_(Reply to this DM with "now", "10 mins", "tomorrow", etc.)_`,
            });

			// 🟢 Send Private confirmation back to the thread
            await client.chat.postEphemeral({
							channel: event.channel,
							user: sender.id,
							thread_ts: event.thread_ts,
							text: `✅ I've reached out to <@${targetUser.id}> in a direct message to check their availability. I'll update you here when they reply!`,
						});

						console.log(`[Connect] DM successfully sent.`);
					} catch (err) {
						console.error(
							"[Connect] Failed to initiate DM:",
							err.message,
						);
						await client.chat.postEphemeral({
							channel: event.channel,
							user: sender.id,
							thread_ts: event.thread_ts,
							text: `⚠️ I found <@${targetUser.id}> but ran into a permissions error sending them a DM.`,
						});
					}
					connect.removeRelatedWorkRequest(event.thread_ts);
					return null;
				} else if (
					/\b(yes|yup|yeah|free|available|now|ready|ok|sure)\b/i.test(
						lowerReply,
					)
				) {
					for (const u of relatedWorkPrompt.relatedUsers) {
						if (u.id && u.id !== sender.id) {
							await client.chat.postMessage({
								channel: u.id,
								text: `🔔 <@${sender.id}> wants to connect with you regarding related work.`,
							});
						}
					}
					await client.chat.postEphemeral({
						channel: event.channel,
						user: sender.id,
						thread_ts: event.thread_ts,
						text: "✅ Notified all related people.",
					});
          connect.removeRelatedWorkRequest(event.thread_ts);
          return null;
        }
      }
    }

    let result = null;
    const hasFiles = downloadedFiles && downloadedFiles.length > 0;

    // 🟢 Process message if there is text OR if files are attached (supports captionless uploads)
    if (text.trim() || hasFiles) {
      const rawLines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const processedLines = [];
      let activePrefix = null;
      let inMomMode = false;

      for (const line of rawLines) {
        if (/stand-up|MOM|team-wise/i.test(line)) {
          inMomMode = true;
          processedLines.push(line);
          continue;
        }

				// 2. Ignore MOM metadata lines
				if (
					inMomMode &&
					/^(Date|Duration|Present Members)/i.test(line)
				) {
          processedLines.push(line);
          continue;
        }

		// 3. Detect plain names acting as headers (e.g., "*Antim*")
        if (inMomMode && line.length < 50) {
					const textWithoutMarkdown = line
						.replace(/[*_]/g, "")
						.trim();
					if (
						/^[A-Za-z\s]+(?:\([A-Za-z\s]+\))?$/.test(
							textWithoutMarkdown,
						)
					) {
            const cleanName = textWithoutMarkdown
              .replace(/\s*\(.*?\)/, "")
              .trim();
			// FIX: Removed the trailing hyphen to prevent double-dashes in titles
            activePrefix = `task - @${cleanName} `;
            continue;
          }
        }

		// 4. Catch standalone generic header
        if (/^(task|issue)\s*[-:]?$/i.test(line)) {
					activePrefix =
						line.match(/^(task|issue)/i)[0].toLowerCase() + " - ";
          continue;
        }

        const targetedHeader = line.match(
          /^(task|issue)\s*[-:]?\s*(<@[A-Z0-9]+>|@.+?)$/i,
        );
        if (targetedHeader) {
		  // FIX: Space instead of hyphen for targeted headers
          activePrefix = targetedHeader[0].trim() + " ";
          continue;
        }

        if (/^(task|issue)\s*-/i.test(line)) {
          activePrefix = null;
          processedLines.push(
            line.replace(/^(task|issue)\s*-\s*[-•*]\s*/i, "$1 - "),
          );
          continue;
        }

		// 7. If any header is active, process the items underneath it
        if (activePrefix) {
			// FIX: Aggressively strip any starting bullet, hyphen, or number
          const cleanLine = line.replace(/^([-•*]|\d+\.)\s*/, "");
          processedLines.push(activePrefix + cleanLine);
          continue;
        }

		//Default
        processedLines.push(line);
      }

      const explicitLines = processedLines.filter(
        (l) => /task\s*-/i.test(l) || /issue\s*-/i.test(l),
      );

      // 🟢 If explicit tasks are detected AND there are no files, process explicit chunks.
      // Otherwise (files present or general text), process the full text/file payload together.
      const textsToProcess =
        explicitLines.length > 0 && !hasFiles ? explicitLines : [processedLines.join("\n") || text];

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
          slack_client: client,
          local_attachments: downloadedFiles,
        });

		console.log(
					`[slack] ${result.action} classification=${result.classification} confidence=${result.confidence}`,
				);

				// 🟢 FIXED: Now listens for task_updated and issue_updated events from MessageProcessor
        if (
          result &&
          (result.task_created ||
            result.issue_created ||
            result.task_updated ||
            result.issue_updated)
        ) {
          const isTask = result.task_created || result.task_updated;
          const workItem = isTask ? result.task : result.issue;

          const title = workItem?.title || "Untitled";
          const priority = workItem?.priority || "HIGH";
          const status = workItem?.status || "HOLD";
          const assignedName = workItem?.assigned_to?.id
            ? `<@${workItem.assigned_to.id}>`
            : workItem?.assigned_to?.name || "Unassigned";

				// Change the label dynamically based on whether it is new or an update
          const actionText =
						result.task_created || result.issue_created
							? "Tracked"
							: "Updated";

          const label = isTask
            ? `🎯 *Task ${actionText}:* '${title}'\nAssigned to: ${assignedName} [${priority}/${status}]`
            : `🚨 *Issue ${actionText}:* '${title}'\nAssigned to: ${assignedName} [${priority}/${status}]`;

					console.log(
						`[slack] Posting confirmation for ${isTask ? "task" : "issue"}: ${label}`,
					);

          try {
            await client.chat.postMessage({
              channel: event.channel,
              thread_ts: event.thread_ts || event.ts,
              text: label,
            });
			console.log(
							"[slack] Confirmation thread reply posted successfully",
						);
          } catch (err) {
            console.error(
              "[slack] confirmation thread reply failed:",
              err.message,
            );
          }
				} else {
					console.log(
						`[slack] No confirmation sent - action=${result?.action}`,
					);
				}

				if (
					result &&
					result.issue_created &&
					result.related_work?.length
				) {
					try {
						const related = result.related_work;
						const textLines = related.map(
							(r, idx) =>
								`${idx + 1}. [${r.type.toUpperCase()}] *${r.title}* — ${r.reason}`,
						);
						const users = related.flatMap(
							(r) => r.related_users || [],
						);
						const uniqueUsers = [];
						const seen = new Set();
						for (const u of users) {
							if (!seen.has(u.id)) {
								seen.add(u.id);
								uniqueUsers.push(u);
							}
						}

						const userLines = uniqueUsers
							.map(
								(u) =>
									`• <@${u.id}> (${u.display_name || u.name})`,
							)
							.join("\n");

						const blocks = [
							{
								type: "section",
								text: {
									type: "mrkdwn",
									text: `🔍 *Related work found for this issue:*\n${textLines.join("\n")}\n\n*People who worked on these:*\n${userLines}\n\nReply in this thread with the person's name or @mention to connect, or say "no" to skip.`,
								},
							},
						];

						await client.chat.postMessage({
							channel: event.channel,
							thread_ts: event.thread_ts || event.ts,
							text: `🔍 Related work found for this issue:\n${textLines.join("\n")}\n\nPeople who worked on these:\n${userLines}\n\nReply in this thread with the person's name or @mention to connect, or say "no" to skip.`,
							blocks,
						});

						connect.createRelatedWorkRequest(
							event.thread_ts || event.ts,
							{
								relatedUsers: uniqueUsers,
								workItems: related,
								channel: event.channel,
							},
						);
					} catch (err) {
						console.error(
							"[slack] related work post failed:",
							err.message,
						);
					}
				}
			}
		}

    return result;
  }

  app.event("message", async ({ event, client, context }) => {
    try {
      // 🟢 DEBUG LOG: Catch everything hitting the bot before filters apply
      console.log(`\n=== 🚨 INCOMING SLACK EVENT 🚨 ===`);
      console.log(
        `User: ${event.user} | Channel: ${event.channel} | Subtype: ${event.subtype || "none"}`,
      );
      console.log(
        `Text: "${event.text || (event.message ? event.message.text : "")}"`,
      );
      console.log(`==================================\n`);

      if (event.subtype === "message_changed" && event.message) {
        await handleMessage(
          {
            ...event.message,
            channel: event.channel,
            team: event.team || event.message.team,
            ts: event.message.ts,
          },
          client,
          { is_edit: true, botUserId: context.botUserId },
        );
        return;
      }

      // ✅ CORRECTED FILTER:
      // Only ignore if a subtype explicitly exists AND it is not "file_share".
      // If subtype is undefined (normal messages), this block is skipped.
      if (event.subtype && event.subtype !== "file_share") {
        console.log(
          `[slack] ⚠️ Ignored event due to subtype: ${event.subtype}`,
        );
        return;
      }

      // This will now successfully trigger for your undefined subtype messages
      await handleMessage(event, client, { is_edit: false, botUserId: context.botUserId });
    } catch (err) {
      console.error("[slack] message handler error:", err);
    }
  });

  // Block Kit Action Handlers
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