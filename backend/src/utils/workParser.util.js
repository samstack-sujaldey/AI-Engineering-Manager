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
  let combinedFallbackText = text.trim() ? `[Caption]: ${text.trim()}\n` : "";
  let batchItems = [];

  if (local_attachments && local_attachments.length > 0) {
    const validAttachments = [];
    for (const att of local_attachments) {
      try {
        await fs.access(att.localPath);
        validAttachments.push(att);
      } catch {
        console.warn(`[WorkParser] Skipping missing attachment: ${att.localPath}`);
      }
    }

    if (validAttachments.length > 0) {
      // 🟢 PASS THE CAPTION TEXT TO THE AI EXTRACTOR
      const extractedFiles = await extractAttachments(validAttachments, text);
      
      for (const file of extractedFiles) {
        if (file.extracted) {
          // 🟢 CHECK FOR SMART AI BATCH
          if (file.ai_batch && file.ai_batch.action === "CREATE_BATCH" && Array.isArray(file.ai_batch.items)) {
            batchItems = batchItems.concat(file.ai_batch.items);
          } else if (file.content) {
            // 🟢 FALLBACK: Only append raw text if AI batch extraction failed/skipped
            const contentStr = typeof file.content === "string" ? file.content : JSON.stringify(file.content, null, 2);
            combinedFallbackText += `\n--- Content from ${file.fileName} ---\n${contentStr.trim()}`;
          }
        }
      }
    }
  }

  // 🟢 IF AI SUCCEEDED, BYPASS REGEX AND RETURN BATCH
  if (batchItems.length > 0) {
    return {
      action: "CREATE_BATCH",
      items: batchItems,
    };
  }

  // 🟢 FALLBACK: Regex parser for attachments if AI failed
  combinedFallbackText = combinedFallbackText.trim();
  if (local_attachments.length > 0 && !/task\s*-|issue\s*-/i.test(combinedFallbackText)) {
    if (/\b(error|bug|fail|crash|exception|issue|broken)\b/i.test(combinedFallbackText)) {
      combinedFallbackText = `issue - ${combinedFallbackText}`;
    } else {
      combinedFallbackText = `task - ${combinedFallbackText}`;
    }
  }

  const parsed = await parseMessage({
    text: combinedFallbackText,
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