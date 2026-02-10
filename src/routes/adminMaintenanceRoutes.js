const express = require("express");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * Admin endpoint to drop duplicate id indexes
 *
 * ONE-TIME USE: Removes the old unique constraint on the id field
 * that was causing E11000 duplicate key errors.
 *
 * Safe to call multiple times (idempotent).
 *
 * DELETE /api/admin/drop-id-index
 */
router.delete("/drop-id-index", async (req, res) => {
  try {
    logger.info("Admin: Dropping duplicate id indexes");

    const db = mongoose.connection.db;
    const results = {
      visits: { status: "pending", message: "" },
      scans: { status: "pending", message: "" },
    };

    // Drop id_1 index from visits collection
    try {
      await db.collection("visits").dropIndex("id_1");
      results.visits.status = "dropped";
      results.visits.message = "Successfully dropped id_1 index";
      logger.info("Dropped id_1 index from visits collection");
    } catch (error) {
      if (error.code === 27 || error.codeName === "IndexNotFound") {
        results.visits.status = "not_found";
        results.visits.message =
          "Index id_1 not found (already dropped or never existed)";
      } else {
        results.visits.status = "error";
        results.visits.message = error.message;
        logger.error("Failed to drop id_1 index from visits", {
          error: error.message,
        });
      }
    }

    // Drop id_1 index from scans collection
    try {
      await db.collection("scans").dropIndex("id_1");
      results.scans.status = "dropped";
      results.scans.message = "Successfully dropped id_1 index";
      logger.info("Dropped id_1 index from scans collection");
    } catch (error) {
      if (error.code === 27 || error.codeName === "IndexNotFound") {
        results.scans.status = "not_found";
        results.scans.message =
          "Index id_1 not found (already dropped or never existed)";
      } else {
        results.scans.status = "error";
        results.scans.message = error.message;
        logger.error("Failed to drop id_1 index from scans", {
          error: error.message,
        });
      }
    }

    // Get remaining indexes
    const visitsIndexes = await db.collection("visits").indexes();
    const scansIndexes = await db.collection("scans").indexes();

    const success =
      (results.visits.status === "dropped" ||
        results.visits.status === "not_found") &&
      (results.scans.status === "dropped" ||
        results.scans.status === "not_found");

    res.status(success ? 200 : 500).json({
      success,
      message: success
        ? "Index migration complete"
        : "Some indexes failed to drop",
      results,
      remaining_indexes: {
        visits: visitsIndexes.map((idx) => idx.name),
        scans: scansIndexes.map((idx) => idx.name),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Admin endpoint failed", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to drop indexes",
      message: error.message,
    });
  }
});

/**
 * Fix invalid alias types in existing person documents
 *
 * POST /api/admin/fix-alias-types
 */
router.post("/fix-alias-types", async (req, res) => {
  try {
    logger.info("Admin: Fixing invalid alias types");

    const Person = require("../models/person");

    // Find all people with 'profileUrl' alias type
    const peopleWithInvalidAliases = await Person.find({
      "aliases.type": "profileUrl",
    });

    let fixed = 0;

    for (const person of peopleWithInvalidAliases) {
      // Fix alias types: profileUrl → salesUrl (if it's a sales URL) or publicUrl
      person.aliases = person.aliases.map((alias) => {
        if (alias.type === "profileUrl") {
          // Check if it's a sales URL
          if (
            alias.value &&
            (alias.value.includes("/sales/") ||
              alias.value.startsWith("https://www.linkedin.com/sales/"))
          ) {
            return { ...alias.toObject(), type: "salesUrl" };
          } else {
            return { ...alias.toObject(), type: "publicUrl" };
          }
        }
        return alias;
      });

      await person.save();
      fixed++;
    }

    res.json({
      success: true,
      message: `Fixed ${fixed} people with invalid alias types`,
      fixed_count: fixed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Failed to fix alias types", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to fix alias types",
      message: error.message,
    });
  }
});

/**
 * Debug: Inspect sample observations to understand data structure
 * GET /api/admin/inspect-observations
 */
router.get("/inspect-observations", async (req, res) => {
  try {
    const Scan = require("../models/scan");
    const _Visit = require("../models/visit");
    const { resolvePersonIdentity } = require("../utils/identityMatcher");

    // Get a scan with Sales Nav URL
    const scanWithSalesNav = await Scan.findOne({
      Profile: { $regex: /sales\/lead/ },
    })
      .lean()
      .limit(1);

    // Get a scan without Sales Nav (for comparison)
    const scanWithoutSalesNav = await Scan.findOne({
      Profile: { $not: { $regex: /sales\/lead/ } },
    })
      .lean()
      .limit(1);

    const results = {
      scan_with_sales_nav: null,
      scan_without_sales_nav: null,
    };

    if (scanWithSalesNav) {
      const identity = resolvePersonIdentity(scanWithSalesNav);
      results.scan_with_sales_nav = {
        _id: scanWithSalesNav._id,
        Profile: scanWithSalesNav.Profile,
        SalesProfile: scanWithSalesNav.SalesProfile,
        RecruiterProfile: scanWithSalesNav.RecruiterProfile,
        identity_resolved: {
          person_id: identity.person_id,
          source: identity.source,
          aliases: identity.aliases,
        },
        rawData_keys: scanWithSalesNav.rawData
          ? Object.keys(scanWithSalesNav.rawData)
          : [],
      };
    }

    if (scanWithoutSalesNav) {
      const identity = resolvePersonIdentity(scanWithoutSalesNav);
      results.scan_without_sales_nav = {
        _id: scanWithoutSalesNav._id,
        Profile: scanWithoutSalesNav.Profile,
        SalesProfile: scanWithoutSalesNav.SalesProfile,
        RecruiterProfile: scanWithoutSalesNav.RecruiterProfile,
        identity_resolved: {
          person_id: identity.person_id,
          source: identity.source,
          aliases: identity.aliases,
        },
        rawData_keys: scanWithoutSalesNav.rawData
          ? Object.keys(scanWithoutSalesNav.rawData)
          : [],
      };
    }

    res.json({
      success: true,
      results,
      analysis: {
        sales_nav_extraction_working:
          results.scan_with_sales_nav?.identity_resolved?.source ===
          "salesNavId",
        total_scans: await Scan.countDocuments(),
        scans_with_sales_nav_urls: await Scan.countDocuments({
          Profile: { $regex: /sales\/lead/ },
        }),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Failed to inspect observations", { error: error.message });
    res.status(500).json({
      error: "Failed to inspect observations",
      message: error.message,
    });
  }
});

module.exports = router;
