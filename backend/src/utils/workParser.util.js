const { extractAttachments } = require("../attachments/extractor");
const { parseMessage } = require("../agent/parser");
const fs = require("fs/promises");

async function processWorkWithAttachments({
  text = "",
  sender,
  channel = "",
  thread_id = "",
  workspace_id = "",
  team = "",
  message_ts = "",
  is_edit = false,
  user_directory = {},
  existing_task = null,
  existing_issue = null,
  local_attachments = [],
}) {
  let attachmentTextPayload = "";

  if (local_attachments && local_attachments.length > 0) {
    // Filter out attachments whose local files no longer exist on disk to prevent ENOENT crashes
    const validAttachments = [];
    for (const att of local_attachments) {
      try {
        await fs.access(att.localPath);
        validAttachments.push(att);
      } catch {
        console.warn(`[WorkParser Utility] Skipping attachment as local file is missing or already cleaned up: ${att.localPath}`);
      }
    }

    if (validAttachments.length > 0) {
      const extractedFiles = await extractAttachments(validAttachments);
      
      for (const file of extractedFiles) {
        if (file.extracted && file.content) {
          if (file.type === "IMAGE") {
            const visionSummary = file.content.summary || file.content.text || "";
            if (visionSummary) {
              attachmentTextPayload += `\n[Image Context: ${visionSummary}]`;
            }
          } else {
            const contentStr = typeof file.content === "string"
              ? file.content
              : JSON.stringify(file.content, null, 2);
            attachmentTextPayload += `\n\n--- Content from ${file.fileName} ---\n${contentStr.trim()}`;
          }
        }
      }
    }
  }

  let combinedText = (text + attachmentTextPayload).trim();

  if (local_attachments.length > 0 && !/task\s*-|issue\s*-/i.test(combinedText)) {
    if (/\b(error|bug|fail|crash|exception|issue|broken)\b/i.test(combinedText)) {
      combinedText = `issue - ${combinedText}`;
    } else {
      combinedText = `task - ${combinedText}`;
    }
  }

  const parsed = await parseMessage({
    text: combinedText,
    sender,
    channel,
    thread_id,
    workspace_id,
    team,
    message_ts,
    is_edit,
    user_directory,
    existing_task,
    existing_issue,
    now: new Date(),
  });

  return parsed;
}

module.exports = {
  processWorkWithAttachments,
};