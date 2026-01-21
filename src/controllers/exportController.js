const {
  createExportJob,
  getExportJobStatus,
  getExportFile,
} = require('../services/exportService');
const { processExportJob } = require('../services/exportService');
const logger = require('../utils/logger');

/**
 * Export Controller
 *
 * Handles HTTP requests for exporting people data to CSV/JSON
 */

/**
 * Create a new CSV export job
 *
 * POST /api/export/people/csv
 *
 * Request body:
 * {
 *   "filters": { "snapshot.currentCompany": "Google" },
 *   "fields": ["firstName", "lastName", "currentTitle", "email"]
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function createCsvExportHandler(req, res, next) {
  try {
    const { filters, fields } = req.body;

    logger.info('Received CSV export request', { filters, fields });

    const job = await createExportJob({
      format: 'csv',
      filters,
      fields,
    });

    // Start processing job asynchronously (don't await)
    processExportJob(job._id).catch((err) => {
      logger.error('Failed to process export job', {
        jobId: job._id,
        error: err.message,
      });
    });

    res.status(202).json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        statusUrl: `/api/export/status/${job._id}`,
        message: 'Export job created. Poll statusUrl to check progress.',
      },
    });
  } catch (err) {
    logger.error('Error creating CSV export', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Create a new JSON export job
 *
 * POST /api/export/people/json
 *
 * Request body:
 * {
 *   "filters": { "snapshot.currentCompany": "Google" }
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function createJsonExportHandler(req, res, next) {
  try {
    const { filters, fields } = req.body;

    logger.info('Received JSON export request', { filters, fields });

    const job = await createExportJob({
      format: 'json',
      filters,
      fields,
    });

    // Start processing job asynchronously (don't await)
    processExportJob(job._id).catch((err) => {
      logger.error('Failed to process export job', {
        jobId: job._id,
        error: err.message,
      });
    });

    res.status(202).json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        statusUrl: `/api/export/status/${job._id}`,
        message: 'Export job created. Poll statusUrl to check progress.',
      },
    });
  } catch (err) {
    logger.error('Error creating JSON export', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get export job status
 *
 * GET /api/export/status/:jobId
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getExportStatusHandler(req, res, next) {
  try {
    const { jobId } = req.params;

    const job = await getExportJobStatus(jobId);

    const response = {
      jobId: job._id,
      status: job.status,
      format: job.format,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
    };

    // Include result if completed
    if (job.status === 'completed' && job.result) {
      response.result = {
        downloadUrl: job.result.downloadUrl,
        rowCount: job.result.rowCount,
        fileSize: job.result.fileSize,
      };
    }

    // Include error if failed
    if (job.status === 'failed' && job.error) {
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
    logger.error('Error getting export status', {
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
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function downloadExportHandler(req, res, next) {
  try {
    const { jobId } = req.params;

    const { filePath, format } = await getExportFile(jobId);

    // Set appropriate headers
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const fileName = `export-${jobId}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Stream file to response
    const fs = require('fs');
    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => {
      logger.error('Error streaming export file', {
        jobId,
        error: err.message,
      });
      next(err);
    });

    stream.pipe(res);

    logger.info('Export file downloaded', { jobId, format });
  } catch (err) {
    logger.error('Error downloading export', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  createCsvExportHandler,
  createJsonExportHandler,
  getExportStatusHandler,
  downloadExportHandler,
};
