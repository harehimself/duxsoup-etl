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
 * Health check for admin endpoints
 * GET /api/admin/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Admin endpoints available',
    available_endpoints: [
      'DELETE /api/admin/drop-id-index - Drop old duplicate id indexes',
    ],
  });
});

module.exports = router;
