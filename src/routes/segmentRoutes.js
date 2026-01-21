const express = require('express');
const {
  getHighValueProspectsHandler,
  getDecisionMakersHandler,
  getWarmLeadsHandler,
  getNeedsEnrichmentHandler,
  recalculateScoresHandler,
} = require('../controllers/segmentController');

const router = express.Router();

/**
 * Segment Routes
 *
 * Endpoints for querying people by segment (high-value, decision-maker, etc.)
 */

// Get people by segment
router.get('/high-value', getHighValueProspectsHandler);
router.get('/decision-makers', getDecisionMakersHandler);
router.get('/warm-leads', getWarmLeadsHandler);
router.get('/needs-enrichment', getNeedsEnrichmentHandler);

// Administrative
router.post('/recalculate', recalculateScoresHandler);

module.exports = router;
