const express = require("express");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * Check how many URL-fallback people are upgradable
 *
 * GET /api/admin/check-upgradable
 */
router.get("/check-upgradable", async (req, res) => {
  try {
    const Person = require("../models/person");

    const urlFallbackTotal = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ },
    });

    const upgradable = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ },
      "aliases.type": { $in: ["salesNavId", "numericId"] },
    });

    const percentUpgradable =
      urlFallbackTotal > 0
        ? ((upgradable / urlFallbackTotal) * 100).toFixed(1)
        : 0;

    const recommendation =
      upgradable === 0
        ? "No upgradable people - linking job will not help."
        : upgradable < 100
          ? "Few upgradable people - minimal improvement expected."
          : upgradable < 1000
            ? "Moderate upgrade potential - linking job will help somewhat."
            : "High upgrade potential - linking job highly recommended.";

    res.json({
      url_fallback_total: urlFallbackTotal,
      upgradable_count: upgradable,
      percent_upgradable: parseFloat(percentUpgradable),
      recommendation,
      next_steps:
        upgradable > 0
          ? [
              "Run linking job via Render Shell:",
              "  node scripts/linkIdentities.js --dry-run --limit=20",
              "  node scripts/linkIdentities.js --commit --limit=100 --batch-size=10",
              "Or use the POST /api/admin/run-linking endpoint",
            ]
          : ["Linking job not needed", "No action required"],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Failed to check upgradable people", { error: error.message });
    res.status(500).json({
      error: "Failed to check upgradable people",
      message: error.message,
    });
  }
});

/**
 * Run linking job via API (alternative to Shell access)
 *
 * POST /api/admin/run-linking
 * Body: { "limit": 100, "batchSize": 10, "dryRun": false }
 */
router.post("/run-linking", async (req, res) => {
  try {
    const { limit = 100, batchSize = 10, dryRun = true } = req.body;

    if (!dryRun && limit > 1000) {
      return res.status(400).json({
        error: "Safety limit exceeded",
        message:
          "Maximum limit is 1000 for API execution. Use Shell for larger batches.",
      });
    }

    const Person = require("../models/person");
    const identityResolver = require("../services/identityResolverService");

    const stats = {
      found: 0,
      merged: 0,
      alreadyLinked: 0,
      skipped: 0,
      failed: 0,
    };

    logger.info("Starting linking job via API", { limit, batchSize, dryRun });

    // Find upgradable people
    const upgradablePeople = await Person.find({
      _id: { $regex: /^linkedin\.com/ },
      "aliases.type": { $in: ["salesNavId", "numericId"] },
    })
      .limit(limit)
      .lean();

    stats.found = upgradablePeople.length;

    if (stats.found === 0) {
      return res.json({
        success: true,
        message: "No upgradable people found",
        stats,
        timestamp: new Date().toISOString(),
      });
    }

    if (dryRun) {
      const samples = upgradablePeople.slice(0, 5).map((person) => {
        const salesNavAlias = person.aliases.find(
          (a) => a.type === "salesNavId",
        );
        const numericAlias = person.aliases.find((a) => a.type === "numericId");
        const stableId = salesNavAlias?.value || numericAlias?.value;
        return {
          from: person._id,
          to: stableId,
          source: salesNavAlias ? "salesNavId" : "numericId",
        };
      });

      return res.json({
        success: true,
        message: "Dry run complete",
        stats,
        samples,
        next_step: "Set dryRun=false to execute merges",
        timestamp: new Date().toISOString(),
      });
    }

    // Execute merges (not dry run)
    // identityResolver is already an instance (singleton pattern)
    const force = req.body.force === true;
    const results = [];

    for (const person of upgradablePeople) {
      try {
        const salesNavAlias = person.aliases.find(
          (a) => a.type === "salesNavId",
        );
        const numericAlias = person.aliases.find((a) => a.type === "numericId");
        const stableId = salesNavAlias?.value || numericAlias?.value;
        const {
          buildCanonicalKey,
          computeCanonicalId,
        } = require("../utils/identityMatcher");

        if (!stableId) {
          stats.skipped++;
          continue;
        }

        // Check if person with stable ID already exists
        let canonicalPerson = await Person.findById(stableId);

        if (canonicalPerson) {
          if (!canonicalPerson.canonical_id) {
            const canonicalKey = buildCanonicalKey(
              salesNavAlias ? "salesNavId" : "numericId",
              stableId,
            );
            const canonicalId = computeCanonicalId(canonicalKey);
            canonicalPerson.canonical_id = canonicalId;
            await canonicalPerson.save();
          }

          // Canonical person already exists - check if it's the same as URL person
          if (canonicalPerson._id === person._id) {
            stats.alreadyLinked++;
            continue;
          }

          // Merge URL person into canonical person
          const urlPersonDoc = await Person.findById(person._id);
          const mergedPerson = await identityResolver.mergePeople(
            canonicalPerson,
            [urlPersonDoc],
            {
              reason: "duplicate_detection",
              automated: true,
              force,
            },
          );

          stats.merged++;
          results.push({
            from: person._id,
            to: mergedPerson._id,
          });
        } else {
          // Canonical person doesn't exist - create it and merge URL person into it
          const canonicalKey = buildCanonicalKey(
            salesNavAlias ? "salesNavId" : "numericId",
            stableId,
          );
          const canonicalId = computeCanonicalId(canonicalKey);

          canonicalPerson = await Person.create({
            _id: stableId,
            person_id: stableId,
            canonical_id: canonicalId,
            aliases: [
              {
                type: salesNavAlias ? "salesNavId" : "numericId",
                value: stableId,
              },
            ],
            snapshot: {},
            observations: { visits: [], scans: [] },
          });

          // Merge URL person into new canonical person
          const urlPersonDoc = await Person.findById(person._id);
          const mergedPerson = await identityResolver.mergePeople(
            canonicalPerson,
            [urlPersonDoc],
            {
              reason: "duplicate_detection",
              automated: true,
              force,
            },
          );

          stats.merged++;
          results.push({
            from: person._id,
            to: mergedPerson._id,
          });
        }
      } catch (error) {
        logger.error("Failed to link person", {
          person_id: person._id,
          error: error.message,
          stack: error.stack,
        });
        stats.failed++;
        results.push({
          from: person._id,
          error: error.message,
          failed: true,
        });
      }
    }

    logger.info("Linking job complete via API", stats);

    res.json({
      success: true,
      message: "Linking job complete",
      stats,
      results: results.slice(0, 10), // Show first 10 merges (or errors)
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Linking job failed", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: "Linking job failed",
      message: error.message,
    });
  }
});

module.exports = router;
