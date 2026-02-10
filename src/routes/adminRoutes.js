const express = require("express");
const {
  testNotificationsHandler,
} = require("../controllers/notificationController");
const adminLinkingRoutes = require("./adminLinkingRoutes");
const adminRebuildRoutes = require("./adminRebuildRoutes");
const adminMaintenanceRoutes = require("./adminMaintenanceRoutes");

const router = express.Router();

// Mount focused sub-routers
router.use(adminLinkingRoutes);
router.use(adminRebuildRoutes);
router.use(adminMaintenanceRoutes);

/**
 * Health check for admin endpoints
 * GET /api/admin/health
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Admin endpoints available",
    available_endpoints: [
      "DELETE /api/admin/drop-id-index - Drop old duplicate id indexes",
      "POST /api/admin/fix-alias-types - Fix invalid alias types",
      "GET /api/admin/check-upgradable - Check how many people can be upgraded",
      "POST /api/admin/run-linking - Run linking job via API (limit: 1000)",
      "POST /api/admin/rebuild-people - Rebuild people collection (limit: 5000)",
      "POST /api/admin/rebuild-people-full - FULL rebuild all observations (no limit)",
      "GET /api/admin/inspect-observations - Inspect sample observations",
      "POST /api/admin/test-notifications - Test email/SMS notification configuration",
    ],
  });
});

// Test notification configuration
router.post("/test-notifications", testNotificationsHandler);

module.exports = router;
