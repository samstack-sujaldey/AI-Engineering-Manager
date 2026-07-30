const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const NodeCache = require("node-cache");
const OpenAI = require("openai");

const {
  MAX_ATTACHMENT_SIZE,
  EXTRACTION_TIMEOUT,
} = require("../constants/attachment.constant.js");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize In-Memory Cache: Auto-expire (TTL) items after 1 hour (3600s)
const attachmentCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

/**
 * Utility: Compute MD5 Hash of local file buffer to ensure reliable caching
 */
async function getFileContentHash(filePath) {
  const buffer = await fs.readFile(filePath);
  const hash = crypto.createHash("md5").update(buffer).digest("hex");
  return { buffer, hash };
}

/**
 * Read plain text, log, xml, html files with MD5 Caching
 */
async function readTextFile(file) {
  validateAttachment(file);
  const { hash } = await getFileContentHash(file.localPath);
  const cacheKey = `text_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached text extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Reading text file ${file.fileName}...`);
  const content = await fs.readFile(file.localPath, "utf8");

  const result = {
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

  attachmentCache.set(cacheKey, result);
  return result;
}

/**
 * Read JSON files with MD5 Caching
 */
async function readJsonFile(file) {
  validateAttachment(file);
  const { hash } = await getFileContentHash(file.localPath);
  const cacheKey = `json_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached JSON extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Reading JSON file ${file.fileName}...`);
  const content = await fs.readFile(file.localPath, "utf8");
  const json = JSON.parse(content);

  const result = {
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

  attachmentCache.set(cacheKey, result);
  return result;
}

/**
 * Read CSV files with MD5 Caching
 */
async function readCsvFile(file) {
  validateAttachment(file);
  const { hash } = await getFileContentHash(file.localPath);
  const cacheKey = `csv_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached CSV extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Reading CSV file ${file.fileName}...`);
  const csv = await fs.readFile(file.localPath, "utf8");

  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  });

  const result = {
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

  attachmentCache.set(cacheKey, result);
  return result;
}

/**
 * Extract text from PDF (Supports pdf-parse v1.x and v2.x APIs safely) with MD5 Caching
 */
async function extractPdf(file) {
  validateAttachment(file);
  const { buffer, hash } = await getFileContentHash(file.localPath);
  const cacheKey = `pdf_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached PDF extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Extracting PDF ${file.fileName}...`);
  const pdfParseLib = require("pdf-parse");

  let text = "";
  let numpages = 0;
  let info = {};

  try {
    if (typeof pdfParseLib === "function") {
      const pdfData = await withTimeout(pdfParseLib(buffer), EXTRACTION_TIMEOUT);
      text = pdfData.text || "";
      numpages = pdfData.numpages || 0;
      info = pdfData.info || {};
    } else if (pdfParseLib.PDFParse) {
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

  let result;
  if (text.trim().length > 20) {
    result = {
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
  } else {
    result = {
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

  attachmentCache.set(cacheKey, result);
  return result;
}

/**
 * Extract DOCX text with MD5 Caching
 */
async function extractDocx(file) {
  validateAttachment(file);
  const { hash } = await getFileContentHash(file.localPath);
  const cacheKey = `docx_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached DOCX extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Extracting DOCX ${file.fileName}...`);
  const extractionResult = await withTimeout(
    mammoth.extractRawText({
      path: file.localPath,
    }),
    EXTRACTION_TIMEOUT,
  );

  const result = {
    extracted: true,
    type: "DOCX",
    content: extractionResult.value,
    metadata: {
      fileName: file.fileName,
      warnings: extractionResult.messages,
    },
    error: null,
  };

  attachmentCache.set(cacheKey, result);
  return result;
}

/**
 * Extract Excel workbook with MD5 Caching
 */
async function extractExcel(file) {
  validateAttachment(file);
  const { hash } = await getFileContentHash(file.localPath);
  const cacheKey = `excel_extraction_${hash}`;

  const cached = attachmentCache.get(cacheKey);
  if (cached) {
    console.log(`[Cache Hit]: Returning cached Excel extraction for ${file.fileName}`);
    return cached;
  }

  console.log(`[Cache Miss]: Extracting Excel ${file.fileName}...`);
  const workbook = XLSX.readFile(file.localPath);
  const sheets = {};

  workbook.SheetNames.forEach((sheetName) => {
    sheets[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
    });
  });

  const result = {
    extracted: true,
    type: "XLSX",
    content: sheets,
    metadata: {
      fileName: file.fileName,
      sheets: workbook.SheetNames,
    },
    error: null,
  };

  attachmentCache.set(cacheKey, result);
  return result;
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
 * Image analysis via OpenAI Vision (gpt-4o) with Content-Hash Caching & Cleanup
 */
async function analyzeImage(file) {
  validateAttachment(file);

  const { buffer, hash } = await getFileContentHash(file.localPath);
  const cacheKey = `attachment_analysis_hash_${hash}`;

  // 1. Check In-Memory Cache
  const cachedAnalysis = attachmentCache.get(cacheKey);
  if (cachedAnalysis) {
    console.log(`[Cache Hit]: Image content already analyzed! (Hash: ${hash})`);
    await fs.unlink(file.localPath).catch(() => {});
    return {
      extracted: true,
      type: "IMAGE",
      content: cachedAnalysis,
      metadata: { fileName: file.fileName, cached: true },
      error: null,
    };
  }

  // 2. Cache Miss: Run Vision Analysis via OpenAI gpt-4o
  console.log(`[Cache Miss]: Analyzing image attachment with OpenAI ${file.fileName} (Hash: ${hash})...`);
  try {
    const base64Image = buffer.toString("base64");
    const mimeType = file.mimeType || "image/png";

    const response = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an AI task extraction assistant analyzing an attached image for an engineering manager dashboard.
Extract a brief summary and structured detail from this image. Respond STRICTLY in valid JSON format with these exact keys:
{
  "summary": "Short 1-sentence description of the image content or bug",
  "text": "Full extracted visible text or OCR transcription",
  "containsCode": boolean,
  "containsError": boolean,
  "containsUI": boolean,
  "containsDiagram": boolean,
  "importantEntities": ["array of key terms, filenames, or error codes"],
  "confidence": 0.95
}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
      EXTRACTION_TIMEOUT
    );

    const jsonString = response.choices[0]?.message?.content || "{}";
    const result = JSON.parse(jsonString);

    // Save result to cache
    attachmentCache.set(cacheKey, result);

    await fs.unlink(file.localPath).catch(() => {});

    return {
      extracted: true,
      type: "IMAGE",
      content: result,
      metadata: { fileName: file.fileName, cached: false },
      error: null,
    };
  } catch (err) {
    await fs.unlink(file.localPath).catch(() => {});
    console.warn(`[analyzeImage] Skipping image analysis for ${file.fileName}:`, err.message);
    return {
      extracted: true,
      type: "IMAGE",
      content: {
        summary: "Image attachment (image analysis skipped)",
        text: "",
        containsCode: false,
        containsError: false,
        containsUI: false,
        containsDiagram: false,
        importantEntities: [],
        confidence: 0.5,
        skipped: true,
      },
      metadata: { fileName: file.fileName, cached: false, skipped: true },
      error: err.message,
    };
  }
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