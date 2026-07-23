const { App } = require("@slack/bolt");
const config = require("../config");
const { toUser } = require("../agent/parser");
const { buildDirectory, downloadSlackAttachments } = require("../services/slackSync");
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

function createSlackApp({ messageProcessor, notificationService }) {
  const { botToken, signingSecret, appToken, socketMode } = config.slack;

  if (!botToken || !signingSecret) {
    console.warn(
      "[slack] Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET — Slack disabled"
    );
    return null;
  }

  if (
    looksLikePlaceholder(botToken, ["xoxb-"]) ||
    looksLikePlaceholder(signingSecret)
  ) {
    console.warn(
      "[slack] SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET look like placeholders — Slack disabled. " +
        "Paste real values from https://api.slack.com/apps → your app → OAuth & Permissions / Basic Information."
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
          "Enable Socket Mode and create an App-Level Token with connections:write."
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
            display_name: u.profile?.display_name || u.real_name || u.name,
            email: u.profile?.email || "",
            real_name: u.real_name,
          };
        }
        cursor = res.response_metadata?.next_cursor;
      } while (cursor);
    } catch (err) {
      console.error("[slack] Failed to fetch workspace users", err.message);
    }
    return workspaceUsersCache;
  }

  async function extractPdfText(url, token) {
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "arraybuffer",
      });

      const fileData = new Uint8Array(response.data);
      const { PDFParse } = require("pdf-parse");

      if (!PDFParse) {
        throw new Error("PDFParse class not found in pdf-parse library.");
      }

      const parser = new PDFParse(fileData);
      const result = await parser.getText();

      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }

      return typeof result === "string" ? result : result.text || "";
    } catch (err) {
      console.error("[slack] Failed to extract PDF:", err.message);
      return "";
    }
  }

  async function handleMessage(event, client, { is_edit = false } = {}) {
    if (event.bot_id || event.subtype === "bot_message") return null;

    const text = event.text || "";
    const sender = await resolveSender(client, event.user);
    const user_directory = await getWorkspaceUsers(client);

    // Download Slack attachments locally for background analysis
    let downloadedFiles = [];
    if (event.files && event.files.length > 0) {
      const rawAttachments = event.files.map((f) => ({
        slackFileId: f.id,
        fileName: f.name,
        mimeType: f.mimetype,
        fileType: f.filetype,
        urlPrivateDownload: f.url_private_download,
        urlPrivate: f.url_private,
      }));
      downloadedFiles = await downloadSlackAttachments(rawAttachments, client.token);
    }

    let result = null;

    if (text.trim()) {
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const explicitLines = lines.filter(
        (l) => /task\s*-/i.test(l) || /issue\s*-/i.test(l)
      );
      const textsToProcess = explicitLines.length > 1 ? explicitLines : [text];

      for (let i = 0; i < textsToProcess.length; i++) {
        const chunk = textsToProcess[i];
        const chunkTs = explicitLines.length > 1 ? `${event.ts}_${i}` : event.ts;

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
          `[slack] ${result.action} classification=${result.classification} confidence=${result.confidence}`
        );

        if (result && (result.task_created || result.issue_created)) {
          const isTask = result.task_created;
          const workItem = isTask ? result.task : result.issue;

          const assigneeTag = workItem.assigned_to?.id
            ? `<@${workItem.assigned_to.id}>`
            : workItem.assigned_to?.name || "Unassigned";

          const label = isTask
            ? `🎯 *Task Tracked:* '${workItem.title}'\nAssigned to: ${assigneeTag} [${workItem.priority}/${workItem.status}]`
            : `🚨 *Issue Tracked:* '${workItem.title}'\nAssigned to: ${assigneeTag} [${workItem.priority}/${workItem.status}]`;

          try {
            await client.chat.postEphemeral({
              channel: event.channel,
              thread_ts: event.thread_ts || event.ts,
              user: event.user,
              text: label,
            });
          } catch (err) {
            console.error("[slack] ephemeral confirmation failed:", err.message);
          }
        }
      }
    }

    // Process attached PDF files
    if (event.files && event.files.length > 0) {
      for (const file of event.files) {
        if (file.mimetype === "application/pdf" && file.url_private_download) {
          const pdfContent = await extractPdfText(file.url_private_download, client.token);

          if (pdfContent && pdfContent.trim()) {
            const pdfSender = {
              id: file.id || `pdf_${Date.now()}`,
              name: file.name,
              display_name: file.name,
              real_name: file.name,
              email: "",
              is_file: true,
            };

            const userBlocks = pdfContent.split(/(?=Name:\s*)/i);

            for (const block of userBlocks) {
              if (!block.toLowerCase().trim().startsWith("name:")) continue;

              const nameMatch = block.match(/Name:\s*([A-Za-z]+)/i);
              const assigneeName = nameMatch ? nameMatch[1].toLowerCase() : "";

              if (!assigneeName) continue;

              const taskChunks = block.split(/Task\s*\d+:/i);

              for (let i = 1; i < taskChunks.length; i++) {
                let taskDesc = taskChunks[i]
                  .replace(/Project:[\s\S]*/i, "")
                  .replace(/Prepared By:[\s\S]*/i, "")
                  .replace(/\n/g, " ")
                  .trim();

                if (taskDesc.length > 3) {
                  const simulatedMessage = `task - ${file.name}: ${taskDesc}`;

                  const lineDirectory = await buildDirectory(client, simulatedMessage);
                  const mergedDirectory = { ...user_directory, ...lineDirectory };

                  await messageProcessor.process({
                    text: simulatedMessage,
                    sender: pdfSender,
                    channel: event.channel,
                    thread_id: event.thread_ts || event.ts,
                    workspace_id: event.team || "",
                    team: event.team || "",
                    message_ts: event.ts,
                    is_edit: false,
                    user_directory: mergedDirectory,
                    slack_client: client,
                    local_attachments: downloadedFiles,
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

    return result;
  }

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
          { is_edit: true }
        );
        return;
      }

      if (event.subtype && event.subtype !== "file_share") return;
      await handleMessage(event, client, { is_edit: false });
    } catch (err) {
      console.error("[slack] message handler error:", err);
    }
  });

  // Block Kit Action Handlers
  app.action("accept_sync_btn", async ({ action, ack, respond, client, body }) => {
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
  });

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
                  text: { type: "plain_text", text: "5 Mins" },
                  action_id: "delay_sync_5_btn",
                  value: payload,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "10 Mins" },
                  action_id: "delay_sync_10_btn",
                  value: payload,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "30 Mins" },
                  action_id: "delay_sync_30_btn",
                  value: payload,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "1 Hour" },
                  action_id: "delay_sync_60_btn",
                  value: payload,
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "Custom" },
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
    respondFunction
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

    const postAt = Math.floor(Date.now() / 1000) + Math.max(delayMinutes * 60, 65);

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
          const targetChannel = openTarget?.channel?.id || targetUserId;

          await scheduleSync(
            client,
            delay,
            taskId,
            senderChannel,
            targetChannel,
            respond
          );
        } catch (err) {
          console.error("[slack] delay_sync error:", err.message);
        }
      }, 0);
    }
  );

  app.view("custom_time_modal", async ({ ack, view, client, body }) => {
    const minutesInput = view.state.values.time_input.minutes.value;
    const delay = parseInt(minutesInput, 10);

    if (isNaN(delay) || delay <= 0) {
      await ack({
        response_action: "errors",
        errors: {
          time_input: "Please enter a valid number of minutes (e.g., 15).",
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
          null
        );
      } catch (err) {
        console.error("[slack] custom_time_modal error:", err.message);
      }
    }, 0);
  });

  return app;
}

module.exports = { createSlackApp };