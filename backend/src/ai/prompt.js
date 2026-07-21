/**
 * src/ai/prompt.js
 * Optimized prompt instructing Gemini to perform full message classification 
 * and entity extraction.
 */
function buildOptimizedPrompt({
  rawMessage,
  parserResult,
  existingTask = null,
  existingIssue = null,
  threadContext = [],
  attachments = [],
}) {
  const serializedAttachments = attachments.map((a, idx) => {
    return `[Attachment #${idx + 1} - Type: ${a.type}, Name: ${a.fileName}]
Content: ${typeof a.content === 'object' ? JSON.stringify(a.content).slice(0, 2000) : String(a.content || '').slice(0, 2000)}`;
  }).join("\n\n");

  return `
You are an AI Engineering Manager bot reading incoming team messages from Slack.
Your job is to classify the intent and parse all relevant task/issue details.

Slack Message: "${rawMessage}"

Existing Task in Thread: ${existingTask ? JSON.stringify({ id: existingTask.id, title: existingTask.title, status: existingTask.status }) : "None"}
Existing Issue in Thread: ${existingIssue ? JSON.stringify({ id: existingIssue.id, title: existingIssue.title, status: existingIssue.status }) : "None"}

Extracted File Content Context:
${attachments.length === 0 ? "No attachment content extracted." : serializedAttachments}

INSTRUCTIONS:
1. **Classification**:
   - "TASK": If the message asks someone to do work, implement a feature, complete a ticket, or action an item.
   - "ISSUE": If the message reports a bug, error, broken feature, outage, or system failure.
   - "GENERAL_DISCUSSION": If it is general chat, technical questions, design ideas, or non-actionable chatter.

2. **Extraction**:
   - Extract a concise **title** summarizing the work/bug.
   - Infer **priority**: URGENT, HIGH, MEDIUM, or LOW.
   - Infer **status**: TODO, PROCESSING, BLOCKED, COMPLETED (for Tasks) OR OPEN, HOLD, RESOLVED (for Issues).
   - Infer **due_date** if mentioned (ISO string YYYY-MM-DD or null).

Return ONLY valid JSON in this exact structure:
{
  "classification": "TASK" | "ISSUE" | "GENERAL_DISCUSSION",
  "confidence": 0.0-1.0,
  "task": {
    "title": "Concise task summary",
    "description": "Full details or context",
    "priority": "URGENT" | "HIGH" | "MEDIUM" | "LOW",
    "status": "TODO" | "PROCESSING" | "BLOCKED" | "COMPLETED",
    "due_date": "YYYY-MM-DD or null"
  },
  "issue": {
    "title": "Concise bug/issue summary",
    "description": "Full error details or context",
    "priority": "HIGH" | "MEDIUM" | "LOW",
    "status": "OPEN" | "HOLD" | "RESOLVED"
  }
}
  `;
}

module.exports = { buildOptimizedPrompt };