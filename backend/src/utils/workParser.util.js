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
  let combinedFallbackText = text.trim() ? `${text.trim()}` : "";
  let batchItems = [];
  let documentDiscussions = [];
  
  // 🟢 NEW: A separate variable to hold the massive text for the backend only
  let hiddenFullDocumentText = "";

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
      const extractedFiles = await extractAttachments(validAttachments, text);
      
      for (const file of extractedFiles) {
        if (file.extracted) {
          const itemsSource = file.ai_batch?.items || file.content?.items;
          const actionSource = file.ai_batch?.action || file.content?.action;

          if (actionSource === "CREATE_BATCH" && Array.isArray(itemsSource) && itemsSource.length > 0) {
            batchItems = batchItems.concat(itemsSource);
          } else {
            // 🟢 Extract BOTH the short summary and the massive text
            const docSummary = file.ai_batch?.summary || file.content?.summary || file.fileName;
            const docText = file.ai_batch?.text || file.content?.text || (typeof file.content === "string" ? file.content : "");
            
            // 1. Push ONLY the clean, short summary to the UI text
            documentDiscussions.push(`📄 Attached Document: ${file.fileName}\n📌 Summary: ${docSummary}`);
            
            // 2. Save the massive text dump to our hidden backend string
            hiddenFullDocumentText += `\n\n--- ${file.fileName} Full Text ---\n${docText}`;
          }
        }
      }
    }
  }

  if (batchItems.length > 0) {
    return {
      action: "CREATE_BATCH",
      items: batchItems,
    };
  }

  if (documentDiscussions.length > 0) {
    combinedFallbackText += `\n\n${documentDiscussions.join("\n\n")}`;
  }

  combinedFallbackText = combinedFallbackText.trim();
  
  if (local_attachments.length > 0 && documentDiscussions.length === 0 && !/task\s*-|issue\s*-/i.test(combinedFallbackText)) {
    if (/\b(error|bug|fail|crash|exception|issue|broken)\b/i.test(combinedFallbackText)) {
      combinedFallbackText = `issue - ${combinedFallbackText}`;
    } else {
      combinedFallbackText = `task - ${combinedFallbackText}`;
    }
  }

  // Generate the standard payload for the database
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

  // 🟢 NEW: Attach the massive hidden text to the final object before returning it!
  if (hiddenFullDocumentText.trim()) {
    parsed.full_document_text = hiddenFullDocumentText.trim();
  }

  return parsed;
}

module.exports = {
  processWorkWithAttachments,
};