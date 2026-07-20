const { GoogleGenerativeAI } = require("@google/generative-ai");
const { shouldAnalyze } = require("./shouldAnalyze");
const { parseGeminiResponse, mergeParserResult } = require("./responseParser");
const { buildOptimizedPrompt } = require("./prompt");
const fs = require("fs/promises");

// Initialize the Gemini SDK using your environment key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

/**
 * FIXED: Added the missing analyzeImage function for Gemini Vision processing.
 * Reads a local file buffer, converts it to base64, and prompts Gemini to extract data.
 */
async function analyzeImage(file) {
  // Gracefully handle if file object or path properties are missing
  const localPath = file.localPath;
  const mimeType = file.mimeType || "image/jpeg";

  const imageBuffer = await fs.readFile(localPath);
  
  const result = await model.generateContent([
    {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType,
      },
    },
    `
You are analyzing an attachment uploaded in a Slack conversation.

Return ONLY valid JSON in this exact format:
{
  "summary": "brief description of what's in the image",
  "text": "any text visible in the image",
  "containsCode": true/false,
  "containsError": true/false,
  "containsUI": true/false,
  "containsDiagram": true/false,
  "importantEntities": ["list", "of", "key", "elements"],
  "confidence": 0.0-1.0
}
    `,
  ]);

  const response = await result.response;
  return JSON.parse(response.text());
}

/**
 * Analyzes text messages alongside parsed metadata context and files
 */
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

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const aiResult = parseGeminiResponse(text, parserResult);
    return mergeParserResult(parserResult, aiResult);
  } catch (error) {
    console.error("Gemini Error:", error);
    return parserResult;
  }
}

// Export BOTH functions so your attachment helpers can pick them up smoothly!
module.exports = {
  analyzeSlackMessage,
  analyzeImage
};