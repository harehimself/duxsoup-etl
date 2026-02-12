const express = require("express");
const {
  getEnrichmentGaps,
  getRevisitList,
} = require("../controllers/enrichmentGapController");

const router = express.Router();

/**
 * Insights Routes
 *
 * Business intelligence endpoints for enrichment gap analysis.
 */

// GET /api/insights/enrichment-gaps — gap analysis dashboard
router.get("/enrichment-gaps", getEnrichmentGaps);

// GET /api/insights/enrichment-gaps/revisit-list — prioritized revisit list
router.get("/enrichment-gaps/revisit-list", getRevisitList);

module.exports = router;
