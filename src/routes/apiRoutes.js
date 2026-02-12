const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("../utils/logger");
const requestTimeout = require("../middleware/requestTimeout");
const { handleVisit } = require("../controllers/visitController");
const { handleScan } = require("../controllers/scanController");
const { handleBatchWebhook } = require("../controllers/batchWebhookHandler");
const webhookAuth = require("../middleware/webhookAuth");
const {
  getIngestionHealth,
  getParityHealth,
  getMetrics,
  getCoverageBreakdown,
  getCanonicalCoverage,
  getCompanyCoverage,
  getLocationCoverage,
  getDataQuality,
  getDataQualityDashboard,
  getDashboard,
  testNotifications,
  getThroughput,
  getDataCleanliness,
} = require("../controllers/healthController");
const {
  getPersonById,
  getPersonByAlias,
  getPersonsByAliases,
} = require("../controllers/personReadController");
const {
  getCompanyById,
  getCompanyByAlias,
} = require("../controllers/companyReadController");
const {
  getCompanyIntelligence,
} = require("../controllers/companyIntelligenceController");
const {
  getLocationById,
  getLocationByAlias,
} = require("../controllers/locationReadController");
const { getPersonTimeline } = require("../controllers/timelineController");
const { replayObservation } = require("../controllers/replayController");
const adminRoutes = require("./adminRoutes");
const queryRoutes = require("./queryRoutes");
const searchRoutes = require("./searchRoutes");
const exportRoutes = require("./exportRoutes");
const changeRoutes = require("./changeRoutes");
const seniorityRoutes = require("./seniorityRoutes");
const signalRoutes = require("./signalRoutes");
const insightsRoutes = require("./insightsRoutes");

const router = express.Router();

// Rate limiter for webhook endpoint
const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.WEBHOOK_RATE_LIMIT || "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "RATE_LIMITED",
    message: "Too many requests, please slow down",
  },
});

// Rate limiter for read/query endpoints
const readRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "RATE_LIMITED",
    message: "Too many requests, please slow down",
  },
});

// Rate limiter for admin endpoints (more restrictive)
const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "RATE_LIMITED",
    message: "Too many admin requests, please slow down",
  },
});

// Simple test route
router.get("/test", (req, res) => {
  res.json({ message: "API routes working" });
});

// Version endpoint to verify deployed code
router.get("/version", (req, res) => {
  res.json({
    version: require("../../package.json").version,
    commit: process.env.GIT_COMMIT || "unknown",
    node: process.version,
  });
});

// Health endpoints for ops monitoring
router.get("/health/ingestion", readRateLimiter, getIngestionHealth);
router.get("/health/parity", readRateLimiter, getParityHealth);
router.get("/health/metrics", readRateLimiter, getMetrics);
router.get("/health/coverage-breakdown", readRateLimiter, getCoverageBreakdown);
router.get("/health/canonical-coverage", readRateLimiter, getCanonicalCoverage);
router.get("/health/company-coverage", readRateLimiter, getCompanyCoverage);
router.get("/health/location-coverage", readRateLimiter, getLocationCoverage);
router.get("/health/data-quality", readRateLimiter, getDataQuality);
router.get("/health/quality", readRateLimiter, getDataQualityDashboard);
router.get("/health/dashboard", readRateLimiter, getDashboard);
router.get("/health/throughput", readRateLimiter, getThroughput);
router.get("/health/data-cleanliness", readRateLimiter, getDataCleanliness);
router.get(
  "/health/test-notifications",
  readRateLimiter,
  webhookAuth,
  testNotifications,
);

// Person read endpoints
router.get("/people/:id/timeline", readRateLimiter, getPersonTimeline);
router.get("/people/:id", readRateLimiter, getPersonById);
router.get("/people/by-alias/:value", readRateLimiter, getPersonByAlias);
router.post("/people/by-aliases", readRateLimiter, getPersonsByAliases);

// Company read endpoints
router.get(
  "/companies/:id/intelligence",
  readRateLimiter,
  getCompanyIntelligence,
);
router.get("/companies/:id", readRateLimiter, getCompanyById);
router.get("/companies/by-alias/:value", readRateLimiter, getCompanyByAlias);

// Location read endpoints
router.get("/locations/:id", readRateLimiter, getLocationById);
router.get("/locations/by-alias/:value", readRateLimiter, getLocationByAlias);

// Main webhook endpoint (rate limited, no auth — DuxSoup cannot send credentials)
router.post("/webhook", webhookRateLimiter, (req, res) => {
  const payload = req.body;

  logger.info("Webhook received", {
    type: payload.type,
    id: payload.id,
  });

  if (!payload.type) {
    return res.status(400).json({
      error: "Missing type field",
    });
  }

  if (payload.type === "visit") {
    return handleVisit(req, res);
  } else if (payload.type === "scan") {
    return handleScan(req, res);
  } else {
    return res.status(400).json({
      error: "Invalid payload type",
      message: 'Type must be either "visit" or "scan"',
    });
  }
});

// Batch webhook endpoint (rate limited, longer timeout for bulk processing)
router.post(
  "/webhook/batch",
  webhookRateLimiter,
  requestTimeout(120000),
  handleBatchWebhook,
);

// Admin endpoints (one-time migrations, etc.)
router.use("/admin", webhookAuth, adminRateLimiter, adminRoutes);

// Observation replay endpoint (admin, protected)
router.post("/admin/replay/:observationId", webhookAuth, replayObservation);

// Query endpoints (search and filter people/companies)
router.use("/query", readRateLimiter, queryRoutes);

// Search endpoints (full-text search)
router.use("/search", readRateLimiter, searchRoutes);

// Export endpoints (CSV/JSON export) — longer timeout for large exports
router.use("/export", requestTimeout(120000), readRateLimiter, exportRoutes);

// Change endpoints (job changes, promotions, title changes)
router.use("/changes", readRateLimiter, changeRoutes);

// Seniority endpoints (filter and analyze by seniority tier)
router.use("/seniority", readRateLimiter, seniorityRoutes);

// Signal endpoints (engagement trigger feed)
router.use("/signals", readRateLimiter, signalRoutes);

// Insights endpoints (enrichment gap analysis)
router.use("/insights", readRateLimiter, insightsRoutes);

module.exports = router;
