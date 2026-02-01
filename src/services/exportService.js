const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs").promises;
const { createObjectCsvWriter } = require("csv-writer");
const Person = require("../models/person");
const ExportJob = require("../models/exportJob");
const { validateQuery } = require("../utils/queryValidation");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

/**
 * Export Service
 *
 * Handles async export of people data to CSV/JSON
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
  const jobId = uuidv4();

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
 * Process an export job (execute the export)
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

  try {
    // Update status to processing
    job.status = "processing";
    job.startedAt = new Date();
    await job.save();

    logger.info("Processing export job", { jobId, format: job.format });

    // Ensure export directory exists
    await fs.mkdir(EXPORT_TEMP_DIR, { recursive: true });

    // Query data
    const data = await queryDataForExport(job.filters, job.fields);

    // Check row limit
    if (data.length > EXPORT_MAX_ROWS) {
      throw new AppError(
        "EXPORT_TOO_LARGE",
        `Export exceeds maximum row limit (${EXPORT_MAX_ROWS}). Use more specific filters.`,
      );
    }

    // Generate export file
    let filePath;
    if (job.format === "csv") {
      filePath = await generateCsv(jobId, data, job.fields);
    } else if (job.format === "json") {
      filePath = await generateJson(jobId, data);
    }

    // Get file stats
    const stats = await fs.stat(filePath);

    // Update job with result
    job.status = "completed";
    job.completedAt = new Date();
    job.result = {
      filePath,
      fileSize: stats.size,
      rowCount: data.length,
      downloadUrl: `/api/export/download/${jobId}`,
    };

    await job.save();

    logger.info("Export job completed", {
      jobId,
      rowCount: data.length,
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
  }
}

/**
 * Query data for export
 *
 * @param {Object} filters - MongoDB filters
 * @param {Array<String>} fields - Fields to include
 * @returns {Promise<Array>} Query results
 */
async function queryDataForExport(filters, fields) {
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

  // Query database
  const results = await Person.find(filters)
    .select(projection)
    .limit(EXPORT_MAX_ROWS + 1) // Query one extra to detect over-limit
    .lean()
    .exec();

  return results;
}

/**
 * Generate CSV file
 *
 * @param {String} jobId - Job ID
 * @param {Array} data - Data to export
 * @param {Array<String>} fields - Fields to include
 * @returns {Promise<String>} File path
 */
async function generateCsv(jobId, data, fields) {
  const filePath = path.join(EXPORT_TEMP_DIR, `${jobId}.csv`);

  // Build CSV header
  const header = fields.map((field) => ({
    id: field,
    title: field,
  }));

  // Create CSV writer
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header,
  });

  // Transform data (flatten nested fields)
  const records = data.map((doc) => {
    const record = {};
    for (const field of fields) {
      const dbPath = FIELD_MAPPING[field];
      if (dbPath) {
        // Handle special cases
        if (field === "linkedInUrl") {
          // Convert _id to LinkedIn URL
          record[field] = formatLinkedInUrl(doc._id);
        } else if (field === "lastObservedAt") {
          // Format date
          const date = getNestedValue(doc, dbPath);
          record[field] = date ? new Date(date).toISOString() : "";
        } else {
          record[field] = getNestedValue(doc, dbPath) || "";
        }
      }
    }
    return record;
  });

  // Write CSV
  await csvWriter.writeRecords(records);

  logger.info("CSV file generated", {
    jobId,
    filePath,
    rowCount: records.length,
  });

  return filePath;
}

/**
 * Generate JSON file
 *
 * @param {String} jobId - Job ID
 * @param {Array} data - Data to export
 * @returns {Promise<String>} File path
 */
async function generateJson(jobId, data) {
  const filePath = path.join(EXPORT_TEMP_DIR, `${jobId}.json`);

  // Write JSON (pretty-printed)
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

  logger.info("JSON file generated", {
    jobId,
    filePath,
    rowCount: data.length,
  });

  return filePath;
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
 * @param {String} path - Dot-notation path (e.g., "snapshot.firstName")
 * @returns {*} Value at path
 */
function getNestedValue(obj, path) {
  const keys = path.split(".");
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
