const express = require('express');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

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
router.delete('/drop-id-index', async (req, res) => {
  try {
    logger.info('Admin: Dropping duplicate id indexes');

    const db = mongoose.connection.db;
    const results = {
      visits: { status: 'pending', message: '' },
      scans: { status: 'pending', message: '' },
    };

    // Drop id_1 index from visits collection
    try {
      await db.collection('visits').dropIndex('id_1');
      results.visits.status = 'dropped';
      results.visits.message = 'Successfully dropped id_1 index';
      logger.info('Dropped id_1 index from visits collection');
    } catch (error) {
      if (error.code === 27 || error.codeName === 'IndexNotFound') {
        results.visits.status = 'not_found';
        results.visits.message = 'Index id_1 not found (already dropped or never existed)';
      } else {
        results.visits.status = 'error';
        results.visits.message = error.message;
        logger.error('Failed to drop id_1 index from visits', { error: error.message });
      }
    }

    // Drop id_1 index from scans collection
    try {
      await db.collection('scans').dropIndex('id_1');
      results.scans.status = 'dropped';
      results.scans.message = 'Successfully dropped id_1 index';
      logger.info('Dropped id_1 index from scans collection');
    } catch (error) {
      if (error.code === 27 || error.codeName === 'IndexNotFound') {
        results.scans.status = 'not_found';
        results.scans.message = 'Index id_1 not found (already dropped or never existed)';
      } else {
        results.scans.status = 'error';
        results.scans.message = error.message;
        logger.error('Failed to drop id_1 index from scans', { error: error.message });
      }
    }

    // Get remaining indexes
    const visitsIndexes = await db.collection('visits').indexes();
    const scansIndexes = await db.collection('scans').indexes();

    const success =
      (results.visits.status === 'dropped' || results.visits.status === 'not_found') &&
      (results.scans.status === 'dropped' || results.scans.status === 'not_found');

    res.status(success ? 200 : 500).json({
      success,
      message: success
        ? 'Index migration complete'
        : 'Some indexes failed to drop',
      results,
      remaining_indexes: {
        visits: visitsIndexes.map(idx => idx.name),
        scans: scansIndexes.map(idx => idx.name),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Admin endpoint failed', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      error: 'Failed to drop indexes',
      message: error.message,
    });
  }
});

/**
 * Check how many URL-fallback people are upgradable
 *
 * GET /api/admin/check-upgradable
 */
router.get('/check-upgradable', async (req, res) => {
  try {
    const Person = require('../models/person');

    const urlFallbackTotal = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ },
    });

    const upgradable = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ },
      'aliases.type': { $in: ['salesNavId', 'numericId'] },
    });

    const percentUpgradable =
      urlFallbackTotal > 0 ? ((upgradable / urlFallbackTotal) * 100).toFixed(1) : 0;

    const recommendation =
      upgradable === 0
        ? 'No upgradable people - linking job will not help. Operate in hybrid mode.'
        : upgradable < 100
        ? 'Few upgradable people - minimal improvement expected.'
        : upgradable < 1000
        ? 'Moderate upgrade potential - linking job will help somewhat.'
        : 'High upgrade potential - linking job highly recommended.';

    res.json({
      url_fallback_total: urlFallbackTotal,
      upgradable_count: upgradable,
      percent_upgradable: parseFloat(percentUpgradable),
      recommendation,
      next_steps:
        upgradable > 0
          ? [
              'Run linking job via Render Shell:',
              '  node scripts/linkIdentities.js --dry-run --limit=20',
              '  node scripts/linkIdentities.js --commit --limit=100 --batch-size=10',
              'Or use the POST /api/admin/run-linking endpoint',
            ]
          : [
              'Linking job not needed',
              'Operate in hybrid mode with current coverage',
              'Set READ_SOURCE=hybrid in environment variables',
            ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to check upgradable people', { error: error.message });
    res.status(500).json({
      error: 'Failed to check upgradable people',
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
router.post('/run-linking', async (req, res) => {
  try {
    const { limit = 100, batchSize = 10, dryRun = true } = req.body;

    if (!dryRun && limit > 1000) {
      return res.status(400).json({
        error: 'Safety limit exceeded',
        message: 'Maximum limit is 1000 for API execution. Use Shell for larger batches.',
      });
    }

    const Person = require('../models/person');
    const identityResolver = require('../services/identityResolverService');

    const stats = {
      found: 0,
      merged: 0,
      alreadyLinked: 0,
      skipped: 0,
      failed: 0,
    };

    logger.info('Starting linking job via API', { limit, batchSize, dryRun });

    // Find upgradable people
    const upgradablePeople = await Person.find({
      _id: { $regex: /^linkedin\.com/ },
      'aliases.type': { $in: ['salesNavId', 'numericId'] },
    })
      .limit(limit)
      .lean();

    stats.found = upgradablePeople.length;

    if (stats.found === 0) {
      return res.json({
        success: true,
        message: 'No upgradable people found',
        stats,
        timestamp: new Date().toISOString(),
      });
    }

    if (dryRun) {
      const samples = upgradablePeople.slice(0, 5).map(person => {
        const salesNavAlias = person.aliases.find(a => a.type === 'salesNavId');
        const numericAlias = person.aliases.find(a => a.type === 'numericId');
        const stableId = salesNavAlias?.value || numericAlias?.value;
        return {
          from: person._id,
          to: stableId,
          source: salesNavAlias ? 'salesNavId' : 'numericId',
        };
      });

      return res.json({
        success: true,
        message: 'Dry run complete',
        stats,
        samples,
        next_step: 'Set dryRun=false to execute merges',
        timestamp: new Date().toISOString(),
      });
    }

    // Execute merges (not dry run)
    // identityResolver is already an instance (singleton pattern)
    const results = [];

    for (const person of upgradablePeople) {
      try {
        const salesNavAlias = person.aliases.find(a => a.type === 'salesNavId');
        const numericAlias = person.aliases.find(a => a.type === 'numericId');
        const stableId = salesNavAlias?.value || numericAlias?.value;

        if (!stableId) {
          stats.skipped++;
          continue;
        }

        // Check if person with stable ID already exists
        let canonicalPerson = await Person.findById(stableId);

        if (canonicalPerson) {
          // Canonical person already exists - check if it's the same as URL person
          if (canonicalPerson._id === person._id) {
            stats.alreadyLinked++;
            continue;
          }

          // Merge URL person into canonical person
          const urlPersonDoc = await Person.findById(person._id);
          const mergedPerson = await identityResolver.mergePeople(canonicalPerson, [urlPersonDoc], {
            reason: 'duplicate_detection',
            automated: true,
          });

          stats.merged++;
          results.push({
            from: person._id,
            to: mergedPerson._id,
          });
        } else {
          // Canonical person doesn't exist - create it and merge URL person into it
          canonicalPerson = await Person.create({
            _id: stableId,
            person_id: stableId,
            aliases: [{ type: salesNavAlias ? 'salesNavId' : 'numericId', value: stableId }],
            snapshot: {},
            observations: { visits: [], scans: [] },
          });

          // Merge URL person into new canonical person
          const urlPersonDoc = await Person.findById(person._id);
          const mergedPerson = await identityResolver.mergePeople(canonicalPerson, [urlPersonDoc], {
            reason: 'duplicate_detection',
            automated: true,
          });

          stats.merged++;
          results.push({
            from: person._id,
            to: mergedPerson._id,
          });
        }
      } catch (error) {
        logger.error('Failed to link person', {
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

    logger.info('Linking job complete via API', stats);

    res.json({
      success: true,
      message: 'Linking job complete',
      stats,
      results: results.slice(0, 10), // Show first 10 merges (or errors)
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Linking job failed', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Linking job failed',
      message: error.message,
    });
  }
});

/**
 * Run rebuild people collection from observations (FULL - no limit)
 *
 * POST /api/admin/rebuild-people-full
 * Body: { "source": "visit" | "scan" | "both", "dryRun": false }
 */
router.post('/rebuild-people-full', async (req, res) => {
  try {
    const { source = 'both', dryRun = true } = req.body;

    const Visit = require('../models/visit');
    const Scan = require('../models/scan');
    const Person = require('../models/person');
    const { upsertFromObservation } = require('../controllers/personController');

    const stats = {
      visits_processed: 0,
      scans_processed: 0,
      people_upserted: 0,
      people_updated: 0,
      errors: 0,
      skipped: 0,
    };

    const startTime = Date.now();

    logger.info('Starting FULL rebuild via API', { source, dryRun });

    // Get all existing people to track which observations are already processed
    const existingPeople = await Person.find({}).select('observations').lean();
    const processedVisits = new Set();
    const processedScans = new Set();

    existingPeople.forEach(person => {
      person.observations?.visits?.forEach(id => processedVisits.add(id.toString()));
      person.observations?.scans?.forEach(id => processedScans.add(id.toString()));
    });

    logger.info('Found existing observations', {
      processed_visits: processedVisits.size,
      processed_scans: processedScans.size,
    });

    // Process visits
    if (source === 'both' || source === 'visit') {
      const allVisits = await Visit.find({}).sort({ VisitTime: 1 }).lean();

      for (const visit of allVisits) {
        const alreadyProcessed = processedVisits.has(visit._id.toString());

        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(visit, 'visit');
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
          logger.error('Failed to upsert from visit', {
            visit_id: visit._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    // Process scans
    if (source === 'both' || source === 'scan') {
      const allScans = await Scan.find({}).sort({ ScanTime: 1 }).lean();

      for (const scan of allScans) {
        const alreadyProcessed = processedScans.has(scan._id.toString());

        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(scan, 'scan');
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
          logger.error('Failed to upsert from scan', {
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
        ? Math.round((stats.visits_processed + stats.scans_processed) / elapsedSeconds)
        : 0;

    logger.info('FULL rebuild complete via API', stats);

    res.json({
      success: true,
      message: dryRun ? 'Dry run complete' : 'FULL rebuild complete',
      stats: {
        ...stats,
        elapsed_seconds: parseFloat(elapsedSeconds),
        throughput_per_second: throughput,
      },
      next_step: dryRun
        ? 'Set dryRun=false to execute rebuild'
        : 'Check coverage: GET /api/health/parity',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('FULL rebuild failed', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'FULL rebuild failed',
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
router.post('/rebuild-people', async (req, res) => {
  try {
    const { limit = 1000, source = 'both', dryRun = true } = req.body;

    if (!dryRun && limit > 5000) {
      return res.status(400).json({
        error: 'Safety limit exceeded',
        message: 'Maximum limit is 5000 for API execution. Use Shell for larger batches.',
      });
    }

    const Visit = require('../models/visit');
    const Scan = require('../models/scan');
    const { upsertFromObservation } = require('../controllers/personController');

    const stats = {
      visits_processed: 0,
      scans_processed: 0,
      people_upserted: 0,
      errors: 0,
      skipped: 0,
    };

    const startTime = Date.now();

    logger.info('Starting rebuild via API', { limit, source, dryRun });

    // Process visits
    if (source === 'both' || source === 'visit') {
      const visits = await Visit.find({})
        .sort({ VisitTime: 1 })
        .limit(source === 'visit' ? limit : Math.floor(limit / 2))
        .lean();

      for (const visit of visits) {
        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(visit, 'visit');
            if (result) {
              stats.people_upserted++;
            } else {
              stats.errors++;
            }
          }
          stats.visits_processed++;
        } catch (error) {
          logger.error('Failed to upsert from visit', {
            visit_id: visit._id,
            error: error.message,
          });
          stats.errors++;
        }
      }
    }

    // Process scans
    if (source === 'both' || source === 'scan') {
      const scans = await Scan.find({})
        .sort({ ScanTime: 1 })
        .limit(source === 'scan' ? limit : Math.floor(limit / 2))
        .lean();

      for (const scan of scans) {
        try {
          if (dryRun) {
            stats.skipped++;
          } else {
            const result = await upsertFromObservation(scan, 'scan');
            if (result) {
              stats.people_upserted++;
            } else {
              stats.errors++;
            }
          }
          stats.scans_processed++;
        } catch (error) {
          logger.error('Failed to upsert from scan', {
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
        ? Math.round((stats.visits_processed + stats.scans_processed) / elapsedSeconds)
        : 0;

    logger.info('Rebuild complete via API', stats);

    res.json({
      success: true,
      message: dryRun ? 'Dry run complete' : 'Rebuild complete',
      stats: {
        ...stats,
        elapsed_seconds: parseFloat(elapsedSeconds),
        throughput_per_second: throughput,
      },
      next_step: dryRun
        ? 'Set dryRun=false to execute rebuild'
        : 'Check coverage: GET /api/health/parity',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Rebuild failed', { error: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Rebuild failed',
      message: error.message,
    });
  }
});

/**
 * Debug: Inspect sample observations to understand data structure
 * GET /api/admin/inspect-observations
 */
router.get('/inspect-observations', async (req, res) => {
  try {
    const Scan = require('../models/scan');
    const Visit = require('../models/visit');
    const { resolvePersonIdentity } = require('../utils/identityResolver');

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
          results.scan_with_sales_nav?.identity_resolved?.source === 'salesNavId',
        total_scans: await Scan.countDocuments(),
        scans_with_sales_nav_urls: await Scan.countDocuments({
          Profile: { $regex: /sales\/lead/ },
        }),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to inspect observations', { error: error.message });
    res.status(500).json({
      error: 'Failed to inspect observations',
      message: error.message,
    });
  }
});

/**
 * Health check for admin endpoints
 * GET /api/admin/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Admin endpoints available',
    available_endpoints: [
      'DELETE /api/admin/drop-id-index - Drop old duplicate id indexes',
      'GET /api/admin/check-upgradable - Check how many people can be upgraded',
      'POST /api/admin/run-linking - Run linking job via API (limit: 1000)',
      'POST /api/admin/rebuild-people - Rebuild people collection (limit: 5000)',
      'POST /api/admin/rebuild-people-full - FULL rebuild all observations (no limit)',
    ],
  });
});

module.exports = router;
