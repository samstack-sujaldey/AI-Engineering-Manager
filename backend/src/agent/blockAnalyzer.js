// backend/agent/blockAnalyzer.js
const { similarity } = require("../utils/helpers");

/**
 * Parses a block reason to find if another user is holding up the task.
 * @param {string} reason - The raw reason from the user (e.g., "nitesh didn't send keys")
 * @param {object} userDirectory - The cached Slack workspace directory
 */
async function analyzeBlockReason(reason, userDirectory, aiClient) {
	// 1. Ask your LLM to extract the intent and target. 
	// (Replace this with your actual OpenAI/Gemini API call)
	const prompt = `
		Analyze this task block reason: "${reason}"
		If the user is blocked by another person, extract their name and determine the intent.
		Intent must be "MEETING_REQUEST" (e.g., "connect with...", "talk to...") or "ACTION_REQUIRED" (e.g., "didn't send keys", "waiting on...").
		Return ONLY a JSON object: {"target_name": "name or null", "intent": "MEETING_REQUEST" | "ACTION_REQUIRED", "summary": "Professional summary of what is needed"}
	`;
	
	// const response = await aiClient.generate(prompt); 
	// const parsed = JSON.parse(response); 
	
	// Mock parsed response for this example:
	const parsed = {
		target_name: "nitesh", 
		intent: reason.toLowerCase().includes("connect") ? "MEETING_REQUEST" : "ACTION_REQUIRED",
		summary: "The developer requires the keys to proceed with the task." 
	};

	if (!parsed.target_name) return null;

	// 2. Fuzzy match the extracted name to a real Slack ID
	let targetUser = null;
	const cleanName = parsed.target_name.toLowerCase();
	
	for (const u of Object.values(userDirectory)) {
		if (
			(u.name || "").toLowerCase().includes(cleanName) ||
			(u.real_name || "").toLowerCase().includes(cleanName) ||
			(u.display_name || "").toLowerCase().includes(cleanName)
		) {
			targetUser = u;
			break;
		}
	}

	if (!targetUser) return null;

	return {
		user: targetUser,
		intent: parsed.intent,
		summary: parsed.summary,
	};
}

module.exports = { analyzeBlockReason };