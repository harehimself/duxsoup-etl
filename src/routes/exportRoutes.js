const express = require("express");
const {
  createCsvExportHandler,
  createJsonExportHandler,
  createCompanyCsvExportHandler,
  createCompanyJsonExportHandler,
  createLocationCsvExportHandler,
  createLocationJsonExportHandler,
  getExportStatusHandler,
  downloadExportHandler,
} = require("../controllers/exportController");

const router = express.Router();

/**
 * Export Routes
 *
 * Endpoints for exporting people/company/location data to CSV/JSON
 */

// People export jobs
router.post("/people/csv", createCsvExportHandler);
router.post("/people/json", createJsonExportHandler);

// Company export jobs
router.post("/companies/csv", createCompanyCsvExportHandler);
router.post("/companies/json", createCompanyJsonExportHandler);

// Location export jobs
router.post("/locations/csv", createLocationCsvExportHandler);
router.post("/locations/json", createLocationJsonExportHandler);

// Get job status
router.get("/status/:jobId", getExportStatusHandler);

// Download export file
router.get("/download/:jobId", downloadExportHandler);

module.exports = router;
