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
    const IdentityResolverService = require('../services/identityResolverService');

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
    const identityResolver = new IdentityResolverService();
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

        const identity = {
          person_id: stableId,
          aliases: [{ type: salesNavAlias ? 'salesNavId' : 'numericId', value: stableId }],
          source: salesNavAlias ? 'salesNavId' : 'numericId',
        };

        const canonicalPerson = await identityResolver.resolveOrCreate(identity, {
          reason: 'linking_job_api',
          from_url_fallback: person._id,
        });

        if (canonicalPerson._id === person._id) {
          stats.alreadyLinked++;
          continue;
        }

        const urlPersonDoc = await Person.findById(person._id);
        const mergedPerson = await identityResolver.mergePeople(canonicalPerson, [urlPersonDoc], {
          reason: 'linking_job_api',
          automated: true,
        });

        stats.merged++;
        results.push({
          from: person._id,
          to: mergedPerson._id,
        });
      } catch (error) {
        logger.error('Failed to link person', {
          person_id: person._id,
          error: error.message,
        });
        stats.failed++;
      }
    }

    logger.info('Linking job complete via API', stats);

    res.json({
      success: true,
      message: 'Linking job complete',
      stats,
      results: results.slice(0, 10), // Show first 10 merges
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
    ],
  });
});

module.exports = router;
