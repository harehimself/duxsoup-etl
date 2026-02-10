const {
  createExportJob,
  getExportJobStatus,
  getExportFile,
} = require("../services/exportService");
const { processExportJob } = require("../services/exportService");
const logger = require("../utils/logger");

/**
 * Export Controller
 *
 * Handles HTTP requests for exporting people/company/location data to CSV/JSON.
 * Uses a factory pattern to avoid duplicating handler logic per entity type.
 */

/**
 * Factory: create an export handler for a given entity type and format.
 *
 * @param {String} entityType - 'people' | 'companies' | 'locations'
 * @param {String} format - 'csv' | 'json'
 * @returns {Function} Express route handler
 */
function createExportHandler(entityType, format) {
  return async function exportHandler(req, res, next) {
    try {
      const { filters, fields } = req.body;

      logger.info(
        `Received ${entityType} ${format.toUpperCase()} export request`,
        {
          entityType,
          filters,
          fields,
        },
      );

      const job = await createExportJob({
        format,
        entityType,
        filters,
        fields,
      });

      // Start processing job asynchronously (don't await)
      processExportJob(job._id).catch((err) => {
        logger.error("Failed to process export job", {
          jobId: job._id,
          error: err.message,
        });
      });

      res.status(202).json({
        success: true,
        data: {
          jobId: job._id,
          entityType,
          status: job.status,
          statusUrl: `/api/export/status/${job._id}`,
          message: "Export job created. Poll statusUrl to check progress.",
        },
      });
    } catch (err) {
      logger.error(`Error creating ${entityType} ${format} export`, {
        error: err.message,
        stack: err.stack,
      });
      next(err);
    }
  };
}

// People handlers
const createCsvExportHandler = createExportHandler("people", "csv");
const createJsonExportHandler = createExportHandler("people", "json");

// Company handlers
const createCompanyCsvExportHandler = createExportHandler("companies", "csv");
const createCompanyJsonExportHandler = createExportHandler("companies", "json");

// Location handlers
const createLocationCsvExportHandler = createExportHandler("locations", "csv");
const createLocationJsonExportHandler = createExportHandler(
  "locations",
  "json",
);

/**
 * Get export job status
 *
 * GET /api/export/status/:jobId
 */
async function getExportStatusHandler(req, res, next) {
  try {
    const { jobId } = req.params;

    const job = await getExportJobStatus(jobId);

    const response = {
      jobId: job._id,
      status: job.status,
      format: job.format,
      entityType: job.entityType || "people",
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
    };

    // Include result if completed
    if (job.status === "completed" && job.result) {
      response.result = {
        downloadUrl: job.result.downloadUrl,
        rowCount: job.result.rowCount,
        fileSize: job.result.fileSize,
      };
    }

    // Include error if failed
    if (job.status === "failed" && job.error) {
      response.error = {
        code: job.error.code,
        message: job.error.message,
      };
    }

    res.json({
      success: true,
      data: response,
    });
  } catch (err) {
    logger.error("Error getting export status", {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Download export file
 *
 * GET /api/export/download/:jobId
 */
async function downloadExportHandler(req, res, next) {
  try {
    const { jobId } = req.params;

    const { filePath, format } = await getExportFile(jobId);

    // Set appropriate headers
    const contentType = format === "csv" ? "text/csv" : "application/json";
    const fileName = `export-${jobId}.${format}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Stream file to response
    const fs = require("fs");
    const stream = fs.createReadStream(filePath);

    stream.on("error", (err) => {
      logger.error("Error streaming export file", {
        jobId,
        error: err.message,
      });
      next(err);
    });

    stream.pipe(res);

    logger.info("Export file downloaded", { jobId, format });
  } catch (err) {
    logger.error("Error downloading export", {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  createCsvExportHandler,
  createJsonExportHandler,
  createCompanyCsvExportHandler,
  createCompanyJsonExportHandler,
  createLocationCsvExportHandler,
  createLocationJsonExportHandler,
  getExportStatusHandler,
  downloadExportHandler,
};
