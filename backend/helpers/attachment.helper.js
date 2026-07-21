const fs = require("fs/promises");
const path = require("path");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");

// FIXED: Correct relative import path to gemini.js
const { analyzeImage: analyzeImageWithGemini } = require("../src/ai/gemini.js");
const {
  MAX_ATTACHMENT_SIZE,
  EXTRACTION_TIMEOUT,
} = require("../constants/attachment.constant.js");

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
 * Extract text from PDF (Supports pdf-parse v1.x and v2.x APIs safely)
 */
async function extractPdf(file) {
  validateAttachment(file);
  const buffer = await fs.readFile(file.localPath);

  const pdfParseLib = require("pdf-parse");

  let text = "";
  let numpages = 0;
  let info = {};

  try {
    if (typeof pdfParseLib === "function") {
      // Legacy pdf-parse v1.x API
      const pdfData = await withTimeout(pdfParseLib(buffer), EXTRACTION_TIMEOUT);
      text = pdfData.text || "";
      numpages = pdfData.numpages || 0;
      info = pdfData.info || {};
    } else if (pdfParseLib.PDFParse) {
      // Modern pdf-parse v2.x Class API
      const uint8Data = new Uint8Array(buffer);
      const parser = new pdfParseLib.PDFParse(uint8Data);
      
      const parsedText = await withTimeout(parser.getText(), EXTRACTION_TIMEOUT);
      text = typeof parsedText === "string" ? parsedText : parsedText.text || "";
      
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    } else {
      throw new Error("Compatible pdf-parse library handler not found.");
    }
  } catch (err) {
    return {
      extracted: false,
      type: "PDF",
      content: null,
      metadata: { fileName: file.fileName },
      error: err.message,
    };
  }

  if (text.trim().length > 20) {
    return {
      extracted: true,
      type: "PDF",
      content: text,
      metadata: {
        fileName: file.fileName,
        pages: numpages,
        info,
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
      pages: numpages,
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
 * Image analysis via OpenRouter / Gemini Vision
 */
async function analyzeImage(file) {
  validateAttachment(file);
  const result = await withTimeout(
    analyzeImageWithGemini(file.localPath, file.mimeType),
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