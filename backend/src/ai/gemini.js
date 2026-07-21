const { shouldAnalyze } = require("./shouldAnalyze");
const { parseGeminiResponse, mergeParserResult } = require("./responseParser");
const { buildOptimizedPrompt } = require("./prompt");
const fs = require("fs/promises");
const dotenv = require("dotenv");

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Safely strips Markdown code blocks (e.g. ```json ... ```) before JSON parsing
 */
function cleanJsonResponse(text) {
  if (!text) return "{}";
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim();
  }
  return cleaned;
}

/**
 * Calls OpenRouter's chat completions endpoint.
 */
async function callOpenRouter(messages, { maxTokens = 600, temperature = 0.2 } = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in backend/.env");
  }

  const modelToUse = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost",
        "X-Title": process.env.OPENROUTER_APP_NAME || "AI Engineering Manager",
      },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[OpenRouter HTTP ${res.status} Error]:`, errText);
      return "📌 **Summary Status**\n- OpenRouter API request failed or rate limited. Please try again shortly.";
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;

    // Handle empty message response without throwing a 500 error
    if (!text) {
      console.warn("[OpenRouter Empty Content]:", JSON.stringify(data, null, 2));
      return "📌 **Summary Status**\n- The AI model returned an empty response. Click another date or re-select this date to retry.";
    }

    return text;
  } catch (err) {
    console.error("[callOpenRouter Failure]:", err.message);
    return "📌 **Summary Status**\n- An unexpected error occurred while communicating with the AI service.";
  }
}

/**
 * Image analysis via OpenRouter Vision
 */
async function analyzeImage(fileOrPath, mimeTypeArg) {
  const localPath = typeof fileOrPath === "object" ? fileOrPath.localPath : fileOrPath;
  const mimeType = typeof fileOrPath === "object" ? (fileOrPath.mimeType || "image/jpeg") : (mimeTypeArg || "image/jpeg");

  if (!localPath) {
    throw new Error("Missing local file path for image analysis.");
  }

  const imageBuffer = await fs.readFile(localPath);
  const base64 = imageBuffer.toString("base64");

  const rawResponse = await callOpenRouter(
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
    { maxTokens: 500, temperature: 0.2 },
  );

  // Clean markdown backticks before JSON parsing
  const jsonText = cleanJsonResponse(rawResponse);
  return JSON.parse(jsonText);
}

async function analyzeSlackMessage({
  rawMessage,
  parserResult,
  existingTask = null,
  existingIssue = null,
  threadContext = [],
  attachments = [],
}) {
  try {
    if (
      !shouldAnalyze({
        rawMessage,
        parserResult,
        attachments,
      })
    ) {
      return parserResult;
    }

    const prompt = buildOptimizedPrompt({
      rawMessage,
      parserResult,
      existingTask,
      existingIssue,
      threadContext,
      attachments,
    });

    const text = await callOpenRouter(
      [{ role: "user", content: prompt }],
      { maxTokens: 500, temperature: 0.1 },
    );

    const aiResult = parseGeminiResponse(text, parserResult);
    return mergeParserResult(parserResult, aiResult);
  } catch (error) {
    console.error("OpenRouter Error:", error);
    return parserResult;
  }
}

module.exports = {
  analyzeSlackMessage,
  analyzeImage,
  callOpenRouter
};