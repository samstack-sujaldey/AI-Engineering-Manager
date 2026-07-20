const { GoogleGenerativeAI } = require("@google/generative-ai");
const { shouldAnalyze } = require("./shouldAnalyze");

const { buildPrompt } = require("./prompt");
const { parseGeminiResponse, mergeParserResult } = require("./responseParser");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-pro",
});

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
		})
	) {
		return parserResult;
	};

    const prompt = buildPrompt({
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

module.exports = {
  analyzeSlackMessage,
};
