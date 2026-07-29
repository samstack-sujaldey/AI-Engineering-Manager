const { callOpenAI } = require("../ai/openai");
const { toUser } = require("../agent/parser");

/**
 * 🟢 Extracts first name and matches strictly against Slack usernames
 */
function findSlackUserByFirstName(rawDocumentName = "", userDirectory = {}) {
  // 1. Clean up suffixes like "(QA)", "Sir", "Dev", roles, and trailing symbols
  const cleanedName = String(rawDocumentName)
    .replace(/\s*\([^)]*\)/g, "") // removes (QA), (Dev), etc.
    .replace(/\b(sir|ma'am|lead|manager|qa|dev)\b/gi, "") // removes roles/titles
    .trim();

  // 2. Extract strictly the First Name (e.g., "Rashmi" from "Rashmi (QA)")
  const firstName = cleanedName.split(/\s+/)[0].toLowerCase();
  if (!firstName) return toUser({ name: rawDocumentName, display_name: rawDocumentName });

  const directoryUsers = Object.values(userDirectory);

  // 3. Search Slack workspace strictly by Slack username (u.name) or display name
  const matchedSlackUser = directoryUsers.find((u) => {
    const slackUsername = (u.name || "").toLowerCase();
    const slackDisplayName = (u.display_name || "").toLowerCase().split(/\s+/)[0];
    const slackRealFirstName = (u.real_name || "").toLowerCase().split(/\s+/)[0];

    return (
      slackUsername === firstName ||
      slackDisplayName === firstName ||
      slackRealFirstName === firstName ||
      slackUsername.includes(firstName)
    );
  });

  if (matchedSlackUser) {
    console.log(`[MOM Assignment] Matched document name "${rawDocumentName}" -> Slack Username: @${matchedSlackUser.name} (${matchedSlackUser.id})`);
    return toUser(matchedSlackUser);
  }

  // Fallback if Slack user isn't found in active directory
  console.warn(`[MOM Assignment] No Slack username match found for "${firstName}". Fallback used.`);
  const formattedName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  return toUser({ name: formattedName, display_name: formattedName });
}

/**
 * Parses MOM text, maps tasks per individual, and auto-assigns in MongoDB
 */
async function processMOMAndAssignWork({
  rawText,
  channel = "",
  workspace_id = "",
  team = "",
  message_ts = "",
  user_directory = {},
  messageProcessor,
}) {
  if (!rawText || !rawText.trim()) throw new Error("No MOM document text provided.");

  // 1. OpenAI Structured Output Call
  const prompt = `
You are an AI Engineering Manager. Extract all task assignments, issues, and discussions from this MOM document, grouped strictly by team member name.

Document Content:
"""
${rawText}
"""

Instructions:
1. Extract metadata: Date (YYYY-MM-DD) and Duration.
2. Under "member_updates", group updates by person.
3. Separate each person's work into:
   - "tasks": Planned, in-progress, or completed development/testing work.
   - "issues": Bugs, re-testing failures, mismatches, or blockers.
   - "discussions": Meetings, architectural discussions, or alignment notes.
`;

  const aiResponse = await callOpenAI([{ role: "user", content: prompt }], {
    maxTokens: 1500,
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mom_document_assignment",
        strict: true,
        schema: {
          type: "object",
          properties: {
            metadata: {
              type: "object",
              properties: {
                date: { type: "string" },
                duration: { type: "string" },
              },
              required: ["date", "duration"],
              additionalProperties: false,
            },
            member_updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  member_name: { type: "string" },
                  tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        status: { type: "string", enum: ["TODO", "PROCESSING", "BLOCKED", "COMPLETED"] },
                        blocked_reason: { type: "string" },
                      },
                      required: ["title", "status", "blocked_reason"],
                      additionalProperties: false,
                    },
                  },
                  issues: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        status: { type: "string", enum: ["OPEN", "HOLD", "RESOLVED"] },
                        blocked_reason: { type: "string" },
                      },
                      required: ["title", "status", "blocked_reason"],
                      additionalProperties: false,
                    },
                  },
                  discussions: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["member_name", "tasks", "issues", "discussions"],
                additionalProperties: false,
              },
            },
          },
          required: ["metadata", "member_updates"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsedData = typeof aiResponse === "string" ? JSON.parse(aiResponse) : aiResponse;
  const createdCounts = { tasks: 0, issues: 0, discussions: 0 };

  // 2. Loop over extracted member updates and create assigned MongoDB records
  for (const memberGroup of parsedData.member_updates || []) {
    // 🟢 Match document first name against Slack username
    const assignedSlackUser = findSlackUserByFirstName(memberGroup.member_name, user_directory);

    // Create & Assign Tasks
    for (const t of memberGroup.tasks || []) {
      const taskCommand = `task - ${t.title} [${t.status}]${t.blocked_reason ? ` Blocker: ${t.blocked_reason}` : ""}`;
      
      await messageProcessor.process({
        text: taskCommand,
        sender: assignedSlackUser, // 🟢 Individual task assigned to matched Slack user
        channel,
        workspace_id,
        team,
        message_ts: `${message_ts}_tsk_${Math.random().toString(36).substring(2, 6)}`,
        user_directory,
      });
      createdCounts.tasks++;
    }

    // Create & Assign Issues
    for (const i of memberGroup.issues || []) {
      const issueCommand = `issue - ${i.title} [${i.status}]${i.blocked_reason ? ` Blocker: ${i.blocked_reason}` : ""}`;
      
      await messageProcessor.process({
        text: issueCommand,
        sender: assignedSlackUser, // 🟢 Individual issue assigned to matched Slack user
        channel,
        workspace_id,
        team,
        message_ts: `${message_ts}_iss_${Math.random().toString(36).substring(2, 6)}`,
        user_directory,
      });
      createdCounts.issues++;
    }

    // Create Discussions
    for (const disc of memberGroup.discussions || []) {
      if (disc.trim()) {
        await messageProcessor.process({
          text: disc,
          sender: assignedSlackUser,
          channel,
          workspace_id,
          team,
          message_ts: `${message_ts}_dsc_${Math.random().toString(36).substring(2, 6)}`,
          user_directory,
        });
        createdCounts.discussions++;
      }
    }
  }

  return {
    metadata: parsedData.metadata,
    created: createdCounts,
  };
}

module.exports = { findSlackUserByFirstName, processMOMAndAssignWork };