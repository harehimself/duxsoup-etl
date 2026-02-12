const express = require("express");
const {
  getEnrichmentGaps,
  getRevisitList,
} = require("../controllers/enrichmentGapController");
const {
  getNetworkProfile,
} = require("../controllers/networkProfileController");

const router = express.Router();

/**
 * Insights Routes
 *
 * Business intelligence endpoints for enrichment gap analysis and network composition.
 */

// GET /api/insights/enrichment-gaps — gap analysis dashboard
router.get("/enrichment-gaps", getEnrichmentGaps);

// GET /api/insights/enrichment-gaps/revisit-list — prioritized revisit list
router.get("/enrichment-gaps/revisit-list", getRevisitList);

// GET /api/insights/network-profile — network composition analysis
router.get("/network-profile", getNetworkProfile);

module.exports = router;
