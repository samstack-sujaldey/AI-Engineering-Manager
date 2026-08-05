const { callOpenAI } = require("../ai/openai");
const { toUser } = require("../agent/parser");

/**
 * :large_green_circle: Safely parses OpenAI JSON outputs even if wrapped in markdown code blocks
 */
function safeJsonParse(response) {
	if (typeof response !== "string") return response;
	let cleaned = response.trim();
	if (cleaned.startsWith("```")) {
		cleaned = cleaned
			.replace(/^```(?:json)?/i, "")
			.replace(/```$/g, "")
			.trim();
	}
	return JSON.parse(cleaned);
}

/**
 * :large_green_circle: Isolated Helper: Cleanly extracts a single first name from any format
 * (e.g., "Rashmi (QA)", "Laxmikant Sir", "Lead Aditya", "@praveen").
 */
function extractCleanFirstName(rawName = "") {
	return String(rawName)
		.replace(/\s*\([^)]*\)/g, "") // Remove parenthesis e.g., (QA), (Dev)
		.replace(/<@([A-Z0-9]+)>/gi, "") // Strip Slack ID tags if pasted
		.replace(/@[A-Za-z0-9_.-]+/g, "") // Strip raw @ mentions
		.replace(/\b(sir|ma'am|lead|manager|qa|dev|mr|ms|mrs)\b/gi, "") // Remove titles/honorifics
		.trim()
		.split(/\s+/)[0]
		.toLowerCase();
}

function makeSlug(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
		.substring(0, 20); // Limit length to keep IDs manageable
}

/**
 * :large_green_circle: Extracts first name and matches strictly against Slack usernames
 */
function findSlackUserByFirstName(rawDocumentName = "", userDirectory = {}) {
	// 1. Clean up suffixes like "(QA)", "Sir", "Dev", roles, and trailing symbols
	const cleanedName = String(rawDocumentName)
		.replace(/\s*\([^)]*\)/g, "") // removes (QA), (Dev), etc.
		.replace(/\b(sir|ma'am|lead|manager|qa|dev)\b/gi, "") // removes roles/titles
		.trim();

	// 2. Extract strictly the First Name (e.g., "Rashmi" from "Rashmi (QA)")
	const firstName = extractCleanFirstName(rawDocumentName);
	if (!firstName)
		return toUser({ name: rawDocumentName, display_name: rawDocumentName });

	const directoryUsers = Object.values(userDirectory);

	// 3. Search Slack workspace strictly by Slack username (u.name) or display name
	const matchedSlackUser = directoryUsers.find((u) => {
		const slackUsername = (u.name || "").toLowerCase();
		const slackDisplayName = (u.display_name || "")
			.toLowerCase()
			.split(/\s+/)[0];
		const slackRealFirstName = (u.real_name || "")
			.toLowerCase()
			.split(/\s+/)[0];

		return (
			slackUsername === firstName ||
			slackDisplayName === firstName ||
			slackRealFirstName === firstName ||
			slackUsername.includes(firstName)
		);
	});

	if (matchedSlackUser) {
		console.log(
			`[MOM Assignment] Matched document name "${rawDocumentName}" -> Slack Username: @${matchedSlackUser.name} (${matchedSlackUser.id})`,
		);
		return toUser(matchedSlackUser);
	}

	// Fallback if Slack user isn't found in active directory
	console.warn(
		`[MOM Assignment] No Slack username match found for "${firstName}". Fallback used.`,
	);
	const formattedName =
		firstName.charAt(0).toUpperCase() + firstName.slice(1);
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
	if (!rawText || !rawText.trim())
		throw new Error("No MOM document text provided.");

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
												status: {
													type: "string",
													enum: [
														"TODO",
														"PROCESSING",
														"BLOCKED",
														"COMPLETED",
													],
												},
												blocked_reason: {
													type: "string",
												},
											},
											required: [
												"title",
												"status",
												"blocked_reason",
											],
											additionalProperties: false,
										},
									},
									issues: {
										type: "array",
										items: {
											type: "object",
											properties: {
												title: { type: "string" },
												status: {
													type: "string",
													enum: [
														"OPEN",
														"HOLD",
														"RESOLVED",
													],
												},
												blocked_reason: {
													type: "string",
												},
											},
											required: [
												"title",
												"status",
												"blocked_reason",
											],
											additionalProperties: false,
										},
									},
									discussions: {
										type: "array",
										items: { type: "string" },
									},
								},
								required: [
									"member_name",
									"tasks",
									"issues",
									"discussions",
								],
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

	const parsedData = safeJsonParse(aiResponse);
	const createdCounts = { tasks: 0, issues: 0, discussions: 0 };

	// 2. Loop over extracted member updates and create assigned MongoDB records
	// Fallback to today's date if the AI doesn't extract one from the metadata
	const momDate =
		parsedData.metadata?.date || new Date().toISOString().split("T")[0];

	for (const memberGroup of parsedData.member_updates || []) {
		// Match document first name against Slack username
		const assignedSlackUser = findSlackUserByFirstName(
			memberGroup.member_name,
			user_directory,
		);

		// Generate a reliable user identifier for the stable ID
		const userId = assignedSlackUser.id || makeSlug(assignedSlackUser.name);

		// Create & Assign Tasks
		for (const t of memberGroup.tasks || []) {
			// Generate a STABLE ID: e.g., "mom_2026-07-26_U12345_tsk_retestedtheticket"
			const taskSlug = makeSlug(t.title);
			const stableId = `mom_${momDate}_${userId}_tsk_${taskSlug}`;

			const taskCommand = `task - ${t.title} [${t.status}]${t.blocked_reason ? ` Blocker: ${t.blocked_reason}` : ""}`;

			await messageProcessor.process({
				text: taskCommand,
				sender: assignedSlackUser,
				channel,
				workspace_id,
				team,
				message_ts: stableId, // Overrides the Slack timestamp with our Content-Based ID
				is_edit: true, // Instructs the processor to update if this stable ID exists
				user_directory,
			});
			createdCounts.tasks++;
		}

		// Create & Assign Issues
		for (const i of memberGroup.issues || []) {
			const issueSlug = makeSlug(i.title);
			const stableId = `mom_${momDate}_${userId}_iss_${issueSlug}`;

			const issueCommand = `issue - ${i.title} [${i.status}]${i.blocked_reason ? ` Blocker: ${i.blocked_reason}` : ""}`;

			await messageProcessor.process({
				text: issueCommand,
				sender: assignedSlackUser,
				channel,
				workspace_id,
				team,
				message_ts: stableId,
				is_edit: true,
				user_directory,
			});
			createdCounts.issues++;
		}

		// Create Discussions
		for (const disc of memberGroup.discussions || []) {
			if (disc.trim()) {
				const discSlug = makeSlug(disc);
				const stableId = `mom_${momDate}_${userId}_dsc_${discSlug}`;

				await messageProcessor.process({
					text: disc,
					sender: assignedSlackUser,
					channel,
					workspace_id,
					team,
					message_ts: stableId,
					is_edit: true,
					user_directory,
				});
				createdCounts.discussions++;
			}
		}
	}
}

return {
	metadata: parsedData.metadata,
	created: createdCounts,
};
module.exports = { findSlackUserByFirstName, processMOMAndAssignWork };