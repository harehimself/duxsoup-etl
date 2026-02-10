const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;
const { createWriteStream } = require("fs");
const { Transform, pipeline } = require("stream");
const { promisify } = require("util");
const Person = require("../models/person");
const ExportJob = require("../models/exportJob");
const { validateQuery } = require("../utils/queryValidation");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

const pipelineAsync = promisify(pipeline);

/**
 * Export Service
 *
 * Handles async export of people data to CSV/JSON using streaming
 * to avoid loading entire datasets into memory.
 */

// Export configuration
const EXPORT_TEMP_DIR = process.env.EXPORT_TEMP_DIR || "/tmp/duxsoup-exports";
const EXPORT_MAX_ROWS = parseInt(process.env.EXPORT_MAX_ROWS || "100000", 10);
const EXPORT_TTL_HOURS = parseInt(process.env.EXPORT_TTL_HOURS || "24", 10);

// Default CSV columns
const DEFAULT_CSV_FIELDS = [
  "firstName",
  "lastName",
  "currentTitle",
  "currentCompany",
  "city",
  "state",
  "country",
  "email",
  "phone",
  "linkedInUrl",
  "connections",
  "industry",
  "lastObservedAt",
];

// Field mapping (CSV header -> database path)
const FIELD_MAPPING = {
  firstName: "snapshot.firstName",
  lastName: "snapshot.lastName",
  fullName: "snapshot.fullName",
  currentTitle: "snapshot.currentTitle",
  currentCompany: "snapshot.currentCompany",
  city: "snapshot.city",
  state: "snapshot.state",
  stateCode: "snapshot.stateCode",
  country: "snapshot.country",
  countryCode: "snapshot.countryCode",
  email: "snapshot.email",
  phone: "snapshot.phone",
  linkedInUrl: "_id", // Use _id (canonical ID) as profile URL
  connections: "snapshot.connections",
  industry: "snapshot.industry",
  location: "snapshot.location",
  summary: "snapshot.summary",
  degree: "snapshot.degree",
  lastObservedAt: "meta.lastObservedAt",
};

/**
 * Create a new export job
 *
 * @param {Object} params - Export parameters
 * @param {String} params.format - Export format (csv or json)
 * @param {Object} params.filters - MongoDB filters
 * @param {Array<String>} params.fields - Fields to include
 * @returns {Promise<Object>} Export job
 */
async function createExportJob(params) {
  const { format, filters = {}, fields } = params;

  // Validate format
  if (!["csv", "json"].includes(format)) {
    throw new AppError("INVALID_FORMAT", "Format must be csv or json");
  }

  // Validate filters (use same validation as Query API)
  validateQuery({ filters });

  // Determine fields to export
  const exportFields =
    fields && fields.length > 0 ? fields : DEFAULT_CSV_FIELDS;

  // Create job ID
  const jobId = crypto.randomUUID();

  // Calculate expiration
  const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000);

  // Create job record
  const job = await ExportJob.create({
    _id: jobId,
    format,
    filters,
    fields: exportFields,
    status: "pending",
    expiresAt,
  });

  logger.info("Export job created", {
    jobId,
    format,
    filters,
    fieldsCount: exportFields.length,
  });

  return job;
}

/**
 * Process an export job using streaming to avoid memory issues
 *
 * @param {String} jobId - Export job ID
 * @returns {Promise<Object>} Updated export job
 */
async function processExportJob(jobId) {
  const job = await ExportJob.findById(jobId);

  if (!job) {
    throw new AppError("NOT_FOUND", `Export job not found: ${jobId}`, 404);
  }

  if (job.status !== "pending") {
    throw new AppError(
      "INVALID_STATE",
      `Job ${jobId} is not pending (status: ${job.status})`,
    );
  }

  const ext = job.format === "csv" ? "csv" : "json";
  const filePath = path.join(EXPORT_TEMP_DIR, `${jobId}.${ext}`);

  try {
    // Update status to processing
    job.status = "processing";
    job.startedAt = new Date();
    await job.save();

    logger.info("Processing export job", { jobId, format: job.format });

    // Ensure export directory exists
    await fs.mkdir(EXPORT_TEMP_DIR, { recursive: true });

    // Stream data from cursor through transform to file
    const cursor = createExportCursor(job.filters, job.fields);
    const rowCount = await streamToFile(
      cursor,
      filePath,
      job.format,
      job.fields,
    );

    // Get file stats
    const stats = await fs.stat(filePath);

    // Update job with result
    job.status = "completed";
    job.completedAt = new Date();
    job.result = {
      filePath,
      fileSize: stats.size,
      rowCount,
      downloadUrl: `/api/export/download/${jobId}`,
    };

    await job.save();

    logger.info("Export job completed", {
      jobId,
      rowCount,
      fileSize: stats.size,
    });

    return job;
  } catch (err) {
    logger.error("Export job failed", {
      jobId,
      error: err.message,
      stack: err.stack,
    });

    // Update job with error
    job.status = "failed";
    job.completedAt = new Date();
    job.error = {
      code: err.code || "EXPORT_ERROR",
      message: err.message,
      stack: err.stack,
    };

    await job.save();

    throw err;
  } finally {
    // Clean up temp file on failure
    if (job.status === "failed") {
      try {
        await fs.unlink(filePath);
        logger.info("Cleaned up temp file for failed export", {
          jobId,
          tempPath: filePath,
        });
      } catch (_unlinkErr) {
        // File may not exist if failure occurred before writing — ignore
      }
    }
  }
}

/**
 * Create a MongoDB cursor for export data
 *
 * Returns a streaming cursor instead of loading all documents into memory.
 *
 * @param {Object} filters - MongoDB filters
 * @param {Array<String>} fields - Fields to include
 * @returns {Cursor} Mongoose cursor (readable stream in object mode)
 */
function createExportCursor(filters, fields) {
  // Build projection from field names
  const projection = {};
  for (const field of fields) {
    const dbPath = FIELD_MAPPING[field];
    if (dbPath) {
      projection[dbPath] = 1;
    }
  }

  // Always include _id for linkedInUrl
  projection._id = 1;

  return Person.find(filters).select(projection).lean().cursor();
}

/**
 * Stream cursor data through a format transform to a file
 *
 * @param {Cursor} cursor - MongoDB cursor (readable stream)
 * @param {String} filePath - Output file path
 * @param {String} format - Export format (csv or json)
 * @param {Array<String>} fields - Fields to include (for CSV)
 * @returns {Promise<Number>} Row count
 */
async function streamToFile(cursor, filePath, format, fields) {
  let rowCount = 0;

  // Row counter + limit enforcer (object mode in, object mode out)
  const rowCounter = new Transform({
    objectMode: true,
    transform(doc, _encoding, callback) {
      rowCount++;
      if (rowCount > EXPORT_MAX_ROWS) {
        callback(
          new AppError(
            "EXPORT_TOO_LARGE",
            `Export exceeds maximum row limit (${EXPORT_MAX_ROWS}). Use more specific filters.`,
          ),
        );
        return;
      }
      this.push(doc);
      callback();
    },
  });

  // Format-specific transform (object mode in, string/buffer out)
  const formatTransform =
    format === "csv" ? createCsvTransform(fields) : createJsonTransform();

  const fileStream = createWriteStream(filePath, { encoding: "utf8" });

  await pipelineAsync(cursor, rowCounter, formatTransform, fileStream);

  return rowCount;
}

/**
 * Create a Transform stream that converts documents to CSV rows
 *
 * @param {Array<String>} fields - Fields to include as CSV columns
 * @returns {Transform} Transform stream (object mode in, string out)
 */
function createCsvTransform(fields) {
  let headerWritten = false;

  return new Transform({
    objectMode: true,
    writableObjectMode: true,
    readableObjectMode: false,
    transform(doc, _encoding, callback) {
      try {
        // Write header row on first document
        if (!headerWritten) {
          this.push(fields.map(escapeCsvField).join(",") + "\n");
          headerWritten = true;
        }

        // Extract field values from document
        const values = fields.map((field) => {
          const dbPath = FIELD_MAPPING[field];
          if (!dbPath) return "";
          if (field === "linkedInUrl") {
            return formatLinkedInUrl(doc._id);
          }
          if (field === "lastObservedAt") {
            const date = getNestedValue(doc, dbPath);
            return date ? new Date(date).toISOString() : "";
          }
          return getNestedValue(doc, dbPath) || "";
        });

        this.push(values.map(escapeCsvField).join(",") + "\n");
        callback();
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      // Ensure header is written even when cursor returns zero documents
      if (!headerWritten) {
        this.push(fields.map(escapeCsvField).join(",") + "\n");
      }
      callback();
    },
  });
}

/**
 * Create a Transform stream that converts documents to a JSON array
 *
 * @returns {Transform} Transform stream (object mode in, string out)
 */
function createJsonTransform() {
  let isFirst = true;

  return new Transform({
    objectMode: true,
    writableObjectMode: true,
    readableObjectMode: false,
    transform(doc, _encoding, callback) {
      try {
        if (isFirst) {
          this.push("[\n");
          isFirst = false;
        } else {
          this.push(",\n");
        }
        this.push(JSON.stringify(doc, null, 2));
        callback();
      } catch (err) {
        callback(err);
      }
    },
    flush(callback) {
      // Close the JSON array
      this.push(isFirst ? "[]" : "\n]");
      callback();
    },
  });
}

/**
 * Escape a value for safe CSV output
 *
 * @param {*} value - Value to escape
 * @returns {String} Escaped CSV field
 */
function escapeCsvField(value) {
  if (value == null) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Get export job status
 *
 * @param {String} jobId - Job ID
 * @returns {Promise<Object>} Export job
 */
async function getExportJobStatus(jobId) {
  const job = await ExportJob.findById(jobId);

  if (!job) {
    throw new AppError("NOT_FOUND", `Export job not found: ${jobId}`, 404);
  }

  return job;
}

/**
 * Get export file for download
 *
 * @param {String} jobId - Job ID
 * @returns {Promise<Object>} File info { filePath, format }
 */
async function getExportFile(jobId) {
  const job = await ExportJob.findById(jobId);

  if (!job) {
    throw new AppError("NOT_FOUND", `Export job not found: ${jobId}`, 404);
  }

  if (job.status !== "completed") {
    throw new AppError(
      "NOT_READY",
      `Export is not ready (status: ${job.status})`,
      400,
    );
  }

  if (!job.result || !job.result.filePath) {
    throw new AppError("FILE_NOT_FOUND", "Export file not found", 404);
  }

  // Check if file exists
  try {
    await fs.access(job.result.filePath);
  } catch (_err) {
    throw new AppError(
      "FILE_NOT_FOUND",
      "Export file has been deleted or expired",
      404,
    );
  }

  return {
    filePath: job.result.filePath,
    format: job.format,
  };
}

/**
 * Helper: Get nested value from object using dot notation
 *
 * @param {Object} obj - Object
 * @param {String} dotPath - Dot-notation path (e.g., "snapshot.firstName")
 * @returns {*} Value at path
 */
function getNestedValue(obj, dotPath) {
  const keys = dotPath.split(".");
  let value = obj;

  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Helper: Format LinkedIn URL from canonical ID
 *
 * @param {String} id - Canonical ID
 * @returns {String} LinkedIn profile URL
 */
function formatLinkedInUrl(id) {
  // If ID looks like a username or profile URL fragment
  if (id.startsWith("linkedin.com/in/")) {
    return `https://${id}`;
  }

  // If ID is a bare username
  if (
    /^[\w-]{3,100}$/.test(id) &&
    !id.match(/^\d{8,}$/) &&
    !id.match(/^AC[wo]AA/i)
  ) {
    return `https://linkedin.com/in/${id}`;
  }

  // For Sales Nav IDs or numeric IDs, return as-is (not a public URL)
  return id;
}

module.exports = {
  createExportJob,
  processExportJob,
  getExportJobStatus,
  getExportFile,
  DEFAULT_CSV_FIELDS,
};
