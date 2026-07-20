const path = require("path");

const {
  readTextFile,
  readJsonFile,
  readCsvFile,
  extractPdf,
  extractDocx,
  extractExcel,
  extractPresentation,
  analyzeImage,
  extractUnknown,
} = require("../helpers/attachment.helper");

/**
 * Extract a single attachment.
 */
async function extractAttachment(file) {
  if (!file) {
    throw new Error("Attachment is required.");
  }

  const mimeType = (file.mimeType || "").toLowerCase();
  const extension = path.extname(file.fileName || "").toLowerCase();

  let result;

  try {
    // Images
    if (mimeType.startsWith("image/")) {
      result = await analyzeImage(file);
    }

    // PDF
    else if (mimeType === "application/pdf" || extension === ".pdf") {
      result = await extractPdf(file);
    }

    // JSON
    else if (mimeType === "application/json" || extension === ".json") {
      result = await readJsonFile(file);
    }

    // CSV
    else if (mimeType === "text/csv" || extension === ".csv") {
      result = await readCsvFile(file);
    }

    // DOCX
    else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      extension === ".docx"
    ) {
      result = await extractDocx(file);
    }

    // Excel
    else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      extension === ".xlsx" ||
      extension === ".xls"
    ) {
      result = await extractExcel(file);
    }

    // PowerPoint
    else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      extension === ".pptx"
    ) {
      result = await extractPresentation(file);
    }

    // Text / Log / XML / HTML
    else if (
      mimeType.startsWith("text/") ||
      [".txt", ".log", ".xml", ".html", ".htm", ".md"].includes(extension)
    ) {
      result = await readTextFile(file);
    }

    // Unknown
    else {
      result = extractUnknown();
    }

    return {
      ...file,
      ...result,
    };
  } catch (error) {
    return {
      ...file,
      extracted: false,
      type: "ERROR",
      content: null,
      metadata: {fileName:file.fileName},
      error: error.message,
    };
  }
}

/**
 * Extract multiple attachments.
 */
async function extractAttachments(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const extracted = await Promise.all(
    files.map((file) => extractAttachment(file)),
  );

  return extracted;
}

module.exports = {
  extractAttachment,
  extractAttachments,
};
