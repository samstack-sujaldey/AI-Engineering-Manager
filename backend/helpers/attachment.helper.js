const fs = require("fs/promises");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");

const { analyzeImage: analyzeImageWithGemini } = require("../ai/gemini");
const {
  MAX_ATTACHMENT_SIZE,
  EXTRACTION_TIMEOUT,
} = require("../constants/attachment.constants");

/**
 * Read plain text, log, xml, html files
 */
async function readTextFile(file) {
  validateAttachment(file);
  const content = await fs.readFile(file.localPath, "utf8");

  return {
    extracted: true,
    type: "TEXT",
    content,
    metadata: {
      fileName: file.fileName,
      characters: content.length,
      extension: path.extname(file.fileName),
    },
    error: null,
  };
}

/**
 * Read JSON files
 */
async function readJsonFile(file) {
  validateAttachment(file);
  const content = await fs.readFile(file.localPath, "utf8");
  const json = JSON.parse(content);

  return {
    extracted: true,
    type: "JSON",
    content: json,
    metadata: {
      fileName: file.fileName,
      keys: Object.keys(json),
      totalKeys: Object.keys(json).length,
    },
    error: null,
  };
}

/**
 * Read CSV files
 */
async function readCsvFile(file) {
  validateAttachment(file);
  const csv = await fs.readFile(file.localPath, "utf8");

  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });

  return {
    extracted: true,
    type: "CSV",
    content: rows,
    metadata: {
      fileName: file.fileName,
      rows: rows.length,
      columns: rows.length ? Object.keys(rows[0]) : [],
    },
    error: null,
  };
}

/**
 * Extract text from PDF
 */
async function extractPdf(file) {
  validateAttachment(file);
  const buffer = await fs.readFile(file.localPath);

  const pdfData = await withTimeout(pdf(buffer), EXTRACTION_TIMEOUT);

  // Scanned PDF support will be added later using Gemini Vision.
  if (pdfData.text.trim().length > 20) {
    return {
      extracted: true,
      type: "PDF",
      content: pdfData.text,
      metadata: {
        fileName: file.fileName,
        pages: pdfData.numpages,
        info: pdfData.info,
      },
      error: null,
    };
  }

  return {
    extracted: false,
    type: "PDF",
    content: null,
    metadata: {
      fileName: file.fileName,
      pages: pdfData.numpages,
      scanned: true,
    },
    error: "Scanned PDF extraction is not implemented yet.",
  };
}

/**
 * Extract DOCX text
 */
async function extractDocx(file) {
  validateAttachment(file);
  const result = await withTimeout(
    mammoth.extractRawText({
      path: file.localPath,
    }),
    EXTRACTION_TIMEOUT,
  );

  return {
    extracted: true,
    type: "DOCX",
    content: result.value,
    metadata: {
      fileName: file.fileName,
      warnings: result.messages,
    },
    error: null,
  };
}

/**
 * Extract Excel workbook
 */
async function extractExcel(file) {
  validateAttachment(file);
  const workbook = XLSX.readFile(file.localPath);

  const sheets = {};

  workbook.SheetNames.forEach((sheetName) => {
    sheets[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
    });
  });

  return {
    extracted: true,
    type: "XLSX",
    content: sheets,
    metadata: {
      fileName: file.fileName,
      sheets: workbook.SheetNames,
    },
    error: null,
  };
}

/**
 * Placeholder for PowerPoint extraction
 */
async function extractPresentation(file) {
  validateAttachment(file);
  return {
    extracted: false,
    type: "PPTX",
    content: null,
    metadata: {
      fileName: file.fileName,
    },
    error: "PPTX extraction not implemented yet.",
  };
}

/**
 * Placeholder for Gemini Vision
 */
async function analyzeImage(file) {
  validateAttachment(file);
  const result = await withTimeout(
    analyzeImageWithGemini(file),
    EXTRACTION_TIMEOUT,
  );

  return {
    extracted: true,
    type: "IMAGE",
    content: result,
    metadata: {
      fileName: file.fileName,
    },
    error: null,
  };
}

/**
 * Unsupported file
 */
function extractUnknown() {
  return {
    extracted: false,
    type: "UNKNOWN",
    content: null,
    metadata: {},
    error: "Unsupported attachment type.",
  };
}

function withTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Attachment extraction timed out.")),
        timeout,
      ),
    ),
  ]);
}

function validateAttachment(file) {
  if (!file) throw new Error("Attachment is required.");

  if (!file.localPath) throw new Error("Attachment path missing.");

  if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error("Attachment exceeds maximum supported size.");
  }
}

module.exports = {
  readTextFile,
  readJsonFile,
  readCsvFile,
  extractPdf,
  extractDocx,
  extractExcel,
  extractPresentation,
  analyzeImage,
  extractUnknown,
  withTimeout,
  validateAttachment,
};
