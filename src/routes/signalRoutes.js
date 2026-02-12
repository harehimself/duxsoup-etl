const express = require("express");
const { getSignals } = require("../controllers/signalFeedController");

const router = express.Router();

/**
 * Signal Routes
 *
 * Engagement trigger feed: ranked, deduplicated signals with action context.
 */

// GET /api/signals/ — engagement signal feed
router.get("/", getSignals);

module.exports = router;
