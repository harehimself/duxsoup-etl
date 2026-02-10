const express = require("express");
const logger = require("../utils/logger");

const router = express.Router();

/**
 * Run rebuild people collection from observations (FULL - no limit)
 *
 * POST /api/admin/rebuild-people-full
 * Body: { "source": "visit" | "scan" | "both", "dryRun": false }
 */
router.post("/rebuild-people-full", async (req, res) => {
  try {
    const { source = "both", dryRun = true } = req.body;

    const Visit = require("../models/visit");
    const Scan = require("../models/scan");
    const Person = require("../models/person");
    const {
      upsertFromObservation,
    } = require("../controllers/personController");

    const stats = {
      visits_processed: 0,
      scans_processed: 0,
      people_upserted: 0,
      people_updated: 0,
      errors: 0,
      skipped: 0,
    };

    const startTime = Date.now();

    logger.info("Starting FULL rebuild via API", { source, dryRun });

    // Get all existing people to track which observations are already processed
    const existingPeople = await Person.find({}).select("observations").lean();
    const processedVisits = new Set();
    const processedScans = new Set();

    existingPeople.forEach((person) => {
      person.observations?.visits?.forEach((id) =>
        processedVisits.add(id.toString()),
      );
      person.observations?.scans?.forEach((id) =>
        processedScans.add(id.toString()),
      );
    });

    logger.info("Found existing observations", {
      processed_visits: processedVisits.size,
      processed_scans: processedScans.size,
    });

    // Process visits
    if (source === "both" || source === "visit") {
      const allVisits = await Visit.find({}).sort({ VisitTime: 1 }).lean();

      for (const visit of allVisits) {
        const alreadyProcessed = processedVisits.has(visit._id.toString());

        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(visit, "visit");
            if (result) {
              if (alreadyProcessed) {
                stats.people_updated++;
              } else {
                stats.people_upserted++;
              }
            } else {
              stats.errors++;
            }
          }
          stats.visits_processed++;

          if (stats.visits_processed % 500 === 0) {
            logger.info(`Processed ${stats.visits_processed} visits...`);
          }
        } catch (error) {
          logger.error("Failed to upsert from visit", {
            visit_id: visit._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    // Process scans
    if (source === "both" || source === "scan") {
      const allScans = await Scan.find({}).sort({ ScanTime: 1 }).lean();

      for (const scan of allScans) {
        const alreadyProcessed = processedScans.has(scan._id.toString());

        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(scan, "scan");
            if (result) {
              if (alreadyProcessed) {
                stats.people_updated++;
              } else {
                stats.people_upserted++;
              }
            } else {
              stats.errors++;
            }
          }
          stats.scans_processed++;

          if (stats.scans_processed % 500 === 0) {
            logger.info(`Processed ${stats.scans_processed} scans...`);
          }
        } catch (error) {
          logger.error("Failed to upsert from scan", {
            scan_id: scan._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const throughput =
      elapsedSeconds > 0
        ? Math.round(
            (stats.visits_processed + stats.scans_processed) / elapsedSeconds,
          )
        : 0;

    logger.info("FULL rebuild complete via API", stats);

    res.json({
      success: true,
      message: dryRun ? "Dry run complete" : "FULL rebuild complete",
      stats: {
        ...stats,
        elapsed_seconds: parseFloat(elapsedSeconds),
        throughput_per_second: throughput,
      },
      next_step: dryRun
        ? "Set dryRun=false to execute rebuild"
        : "Check coverage: GET /api/health/parity",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("FULL rebuild failed", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: "FULL rebuild failed",
      message: error.message,
    });
  }
});

/**
 * Run rebuild people collection from observations
 *
 * POST /api/admin/rebuild-people
 * Body: { "limit": 1000, "source": "visit" | "scan" | "both", "dryRun": false }
 */
router.post("/rebuild-people", async (req, res) => {
  try {
    const { limit = 1000, source = "both", dryRun = true } = req.body;

    if (!dryRun && limit > 5000) {
      return res.status(400).json({
        error: "Safety limit exceeded",
        message:
          "Maximum limit is 5000 for API execution. Use Shell for larger batches.",
      });
    }

    const Visit = require("../models/visit");
    const Scan = require("../models/scan");
    const {
      upsertFromObservation,
    } = require("../controllers/personController");

    const stats = {
      visits_processed: 0,
      scans_processed: 0,
      people_upserted: 0,
      errors: 0,
      skipped: 0,
    };

    const startTime = Date.now();

    logger.info("Starting rebuild via API", { limit, source, dryRun });

    // Process visits
    if (source === "both" || source === "visit") {
      const visits = await Visit.find({})
        .sort({ VisitTime: 1 })
        .limit(source === "visit" ? limit : Math.floor(limit / 2))
        .lean();

      for (const visit of visits) {
        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(visit, "visit");
            if (result) {
              stats.people_upserted++;
            } else {
              stats.errors++;
            }
          }
          stats.visits_processed++;
        } catch (error) {
          logger.error("Failed to upsert from visit", {
            visit_id: visit._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    // Process scans
    if (source === "both" || source === "scan") {
      const scans = await Scan.find({})
        .sort({ ScanTime: 1 })
        .limit(source === "scan" ? limit : Math.floor(limit / 2))
        .lean();

      for (const scan of scans) {
        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(scan, "scan");
            if (result) {
              stats.people_upserted++;
            } else {
              stats.errors++;
            }
          }
          stats.scans_processed++;
        } catch (error) {
          logger.error("Failed to upsert from scan", {
            scan_id: scan._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const throughput =
      elapsedSeconds > 0
        ? Math.round(
            (stats.visits_processed + stats.scans_processed) / elapsedSeconds,
          )
        : 0;

    logger.info("Rebuild complete via API", stats);

    res.json({
      success: true,
      message: dryRun ? "Dry run complete" : "Rebuild complete",
      stats: {
        ...stats,
        elapsed_seconds: parseFloat(elapsedSeconds),
        throughput_per_second: throughput,
      },
      next_step: dryRun
        ? "Set dryRun=false to execute rebuild"
        : "Check coverage: GET /api/health/parity",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Rebuild failed", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: "Rebuild failed",
      message: error.message,
    });
  }
});

module.exports = router;
