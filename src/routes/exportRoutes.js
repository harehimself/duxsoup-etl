const express = require('express');
const {
  createCsvExportHandler,
  createJsonExportHandler,
  getExportStatusHandler,
  downloadExportHandler,
} = require('../controllers/exportController');

const router = express.Router();

/**
 * Export Routes
 *
 * Endpoints for exporting people data to CSV/JSON
 */

// Create export jobs
router.post('/people/csv', createCsvExportHandler);
router.post('/people/json', createJsonExportHandler);

// Get job status
router.get('/status/:jobId', getExportStatusHandler);

// Download export file
router.get('/download/:jobId', downloadExportHandler);

module.exports = router;
