const fs = require("fs/promises");
const dotenv = require("dotenv");

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
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
 * Calls OpenRouter's chat completions endpoint with configurable model and timeout.
 */
async function callOpenRouter(messages, { maxTokens = 600, temperature = 0.2, timeoutMs = 25000, model } = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in backend/.env");
  }

  const defaultModel = process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
  const modelToUse = model || defaultModel;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
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

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[OpenRouter HTTP ${res.status} Error]:`, errText);
      return null;
    }

    const data = await res.json();
    const rawText = data?.choices?.[0]?.message?.content;

    if (!rawText) {
      console.warn("[OpenRouter Empty Content]:", JSON.stringify(data, null, 2));
      return null;
    }

    return sanitizeLlmOutput(rawText);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.warn(`[callOpenRouter]: Request timed out after ${timeoutMs / 1000}s.`);
    } else {
      console.error("[callOpenRouter Failure]:", err.message);
    }
    return null;
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

  // Force a multimodal vision model for OpenRouter
  const visionModel = process.env.OPENROUTER_VISION_MODEL || "openrouter/free";

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
    {
      maxTokens: 500,
      temperature: 0.2,
      timeoutMs: 25000,
      model: visionModel,
    },
  );

  if (!rawResponse) {
    throw new Error("OpenRouter Vision API returned an empty or timed-out response.");
  }

  const jsonText = cleanJsonResponse(rawResponse);
  return JSON.parse(jsonText);
}

module.exports = {
  analyzeImage,
  callOpenRouter,
};