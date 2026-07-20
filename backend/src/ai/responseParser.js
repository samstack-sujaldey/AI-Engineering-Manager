/**
 * Removes markdown wrappers like:
 *
 * ```json
 * { ... }
 * ```
 */
function cleanResponse(text = "") {
	return text
		.replace(/^```json/i, "")
		.replace(/^```/i, "")
		.replace(/```$/i, "")
		.trim();
}

/**
 * Extract first JSON object from Gemini response.
 */
function extractJson(text = "") {
	const cleaned = cleanResponse(text);

	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");

	if (start === -1 || end === -1) {
		throw new Error("No JSON object found in Gemini response.");
	}

	return cleaned.substring(start, end + 1);
}

/**
 * Safely parse Gemini JSON.
 */
function parseGeminiResponse(text, fallback = null) {
	try {
		const json = extractJson(text);

		return JSON.parse(json);
	} catch (error) {
		console.error("Failed to parse Gemini response:", error.message);

		if (fallback) {
			return fallback;
		}

		throw error;
	}
}

/**
 * Merge AI response with parser response.
 * AI only overrides fields it actually returns.
 */
function mergeParserResult(parserResult, aiResult) {
	if (!aiResult) {
		return parserResult;
	}

	return {
		...parserResult,

		...aiResult,

		task: aiResult.task
			? {
					...parserResult.task,
					...aiResult.task,
			  }
			: parserResult.task,

		issue: aiResult.issue
			? {
					...parserResult.issue,
					...aiResult.issue,
			  }
			: parserResult.issue,

		discussion: aiResult.discussion
			? {
					...parserResult.discussion,
					...aiResult.discussion,
			  }
			: parserResult.discussion,

		context: parserResult.context,

		meta: {
			...parserResult.meta,
			...(aiResult.meta || {}),
		},
	};
}

module.exports = {
	parseGeminiResponse,
	mergeParserResult,
};