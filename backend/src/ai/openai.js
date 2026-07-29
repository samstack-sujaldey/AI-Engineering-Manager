const fs = require("fs/promises");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const { pipeline } = require("@xenova/transformers");

dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Safely strips Markdown code blocks (e.g. ```json ... ```) before JSON parsing
 */
function cleanJsonResponse(text) {
	if (!text) return "{}";
	let cleaned = text.trim();
	if (cleaned.startsWith("```")) {
		cleaned = cleaned
			.replace(/^```(?:json)?/i, "")
			.replace(/```$/g, "")
			.trim();
	}
	return cleaned;
}

/**
 * Strips reasoning / chain-of-thought analysis preambles from LLM outputs.
 */
function sanitizeLlmOutput(text) {
	if (!text) return "";

	let cleaned = text.trim();

	// 1. Remove explicit <thought>...</thought> blocks if present
	cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();

	// 2. Slice off any preamble before the daily summary heading if present
	const headingIndex = cleaned.search(/1\.\s*📌|📌\s*\*\*Tasks/i);
	if (headingIndex !== -1) {
		cleaned = cleaned.substring(headingIndex).trim();
	}

	return cleaned;
}

/**
 * Calls OpenAI's chat completions endpoint with configurable model and timeout.
 */
async function callOpenAI(
	messages,
	{ maxTokens = 600, temperature = 0.2, timeoutMs = 25000, model, response_format } = {},
) {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not configured in backend/.env");
	}

	const defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
	const modelToUse = model || defaultModel;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await openai.chat.completions.create(
			{
				model: modelToUse,
				messages: messages,
				max_completion_tokens: maxTokens,
				temperature: temperature,
				...(response_format && { response_format }), // 🟢 Forward response_format to OpenAI
			},
			{
				signal: controller.signal,
			},
		);

		clearTimeout(timeoutId);

		const rawText = response?.choices?.[0]?.message?.content;

		if (!rawText) {
			console.warn(
				"[OpenAI Empty Content]:",
				JSON.stringify(response, null, 2),
			);
			return null;
		}

		// 🟢 Clean markdown code blocks and sanitize output
		const sanitized = sanitizeLlmOutput(rawText);
		return response_format ? cleanJsonResponse(sanitized) : sanitized;
	} catch (err) {
		clearTimeout(timeoutId);
		if (err.name === "AbortError" || err.code === "ETIMEDOUT") {
			console.warn(
				`[callOpenAI]: Request timed out after ${timeoutMs / 1000}s.`,
			);
		} else {
			console.error("[callOpenAI Failure]:", err.message);
		}
		return null;
	}
}

/**
 * Image analysis via OpenAI Vision
 */
async function analyzeImage(fileOrPath, mimeTypeArg) {
	const localPath =
		typeof fileOrPath === "object" ? fileOrPath.localPath : fileOrPath;
	const mimeType =
		typeof fileOrPath === "object"
			? fileOrPath.mimeType || "image/jpeg"
			: mimeTypeArg || "image/jpeg";

	if (!localPath) {
		throw new Error("Missing local file path for image analysis.");
	}

	const imageBuffer = await fs.readFile(localPath);
	const base64 = imageBuffer.toString("base64");

	// Use a vision-capable model (gpt-4o-mini natively supports vision)
	const visionModel = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

  try {
  	const rawResponse = await callOpenAI(
  		[
  			{
  				role: "user",
  				content: [
  					{
  						type: "text",
  						text: `You are analyzing an image attachment uploaded in a Slack conversation.

Return ONLY valid JSON in this exact structure without markdown formatting:
{
  "summary": "brief description of what's in the image",
  "text": "any text visible in the image",
  "containsCode": false,
  "containsError": false,
  "containsUI": false,
  "containsDiagram": false,
  "importantEntities": [],
  "confidence": 0.9
}`,
  					},
  					{
  						type: "image_url",
  						image_url: { url: `data:${mimeType};base64,${base64}` },
  					},
  				],
  			},
  		],
  		{
  			maxTokens: 500,
  			temperature: 0.2,
  			timeoutMs: 25000,
  			model: visionModel,
  		},
  	);

	if (!rawResponse) {
		throw new Error(
			"OpenAI Vision API returned an empty or timed-out response.",
		);
	}

  	const jsonText = cleanJsonResponse(rawResponse);
  	return JSON.parse(jsonText);
  } catch (err) {
    console.warn(`[analyzeImage] Skipping image analysis for ${localPath}:`, err.message);
    return {
      summary: "Image attachment (image analysis skipped)",
      text: "",
      containsCode: false,
      containsError: false,
      containsUI: false,
      containsDiagram: false,
      importantEntities: [],
      confidence: 0.5,
      skipped: true,
    };
  }
}

let embedder = null;

async function getEmbedding(text) {
	try {
		if (!embedder) {
			embedder = await pipeline(
				"feature-extraction",
				"Xenova/all-MiniLM-L6-v2",
			);
		}
		const output = await embedder(text, {
			pooling: "mean",
			normalize: true,
		});
		return Array.from(output.data);
	} catch (error) {
		console.error("[Local Embedding Error]:", error.message);
		return null;
	}
}

module.exports = {
	analyzeImage,
	callOpenAI,
	getEmbedding,
};
