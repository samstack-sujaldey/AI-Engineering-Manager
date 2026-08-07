/**
 * src/ai/responseParser.js
 * Parses Gemini JSON output and merges it into the final executable parser result.
 */

function parseGeminiResponse(rawText, fallbackResult) {
  try {
    // Strip markdown code fences if present
    const cleanJson = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.warn("[responseParser] Failed to parse Gemini JSON response, returning fallback:", err.message);
    return fallbackResult;
  }
}

function mergeParserResult(baseResult, aiResult) {
  if (!aiResult || !aiResult.classification) {
    return baseResult;
  }

  const classification = aiResult.classification;
  let action = "STORE_DISCUSSION";

  if (classification === "TASK") {
    action = baseResult.existing_task ? "UPDATE_TASK" : "CREATE_TASK";
  } else if (classification === "ISSUE") {
    action = baseResult.existing_issue ? "UPDATE_ISSUE" : "CREATE_ISSUE";
  }

  // 🟢 FIX: Safely merge AI text extractions without wiping out system IDs and assignments
  let mergedTask = null;
  if (classification === "TASK") {
      mergedTask = aiResult.task && baseResult.task 
          ? { ...baseResult.task, ...aiResult.task } 
          : (aiResult.task || baseResult.task);
  }

  let mergedIssue = null;
  if (classification === "ISSUE") {
      mergedIssue = aiResult.issue && baseResult.issue 
          ? { ...baseResult.issue, ...aiResult.issue } 
          : (aiResult.issue || baseResult.issue);
  }

  return {
    ...baseResult,
    classification,
    action,
    confidence: aiResult.confidence || 0.9,
    task: mergedTask,
    issue: mergedIssue,
    discussion: classification === "GENERAL_DISCUSSION" ? {
      content: baseResult.text || "",
      flagged_for_review: false
    } : null,
    task_created: action === "CREATE_TASK",
    task_updated: action === "UPDATE_TASK",
    issue_created: action === "CREATE_ISSUE",
    issue_updated: action === "UPDATE_ISSUE",
  };
}

module.exports = {
  parseGeminiResponse,
  mergeParserResult,
};