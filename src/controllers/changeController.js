const {
  getRecentChanges,
  getPersonChanges,
} = require('../services/changeDetectionService');
const logger = require('../utils/logger');

/**
 * Change Controller
 *
 * Handles HTTP requests for querying job changes, promotions, and title changes
 */

/**
 * Get recent changes
 *
 * GET /api/changes?type=company_change&days=30&limit=100
 *
 * Query parameters:
 * - type: Change type (company_change, promotion, title_change) - optional
 * - days: Days to look back (default: 30)
 * - limit: Result limit (default: 100, max: 1000)
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getRecentChangesHandler(req, res, next) {
  try {
    const { type, days, limit } = req.query;

    logger.info('Received recent changes request', { type, days, limit });

    // Validate limit
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    if (parsedLimit > 1000) {
      return res.status(400).json({
        success: false,
        error: 'LIMIT_EXCEEDED',
        message: 'Limit cannot exceed 1000',
      });
    }

    const changes = await getRecentChanges({
      type,
      days: days ? parseInt(days, 10) : 30,
      limit: parsedLimit,
    });

    res.json({
      success: true,
      data: {
        changes,
        metadata: {
          count: changes.length,
          type,
          days: days ? parseInt(days, 10) : 30,
        },
      },
    });
  } catch (err) {
    logger.error('Error getting recent changes', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get changes for a specific person
 *
 * GET /api/changes/person/:id
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getPersonChangesHandler(req, res, next) {
  try {
    const { id } = req.params;

    logger.info('Received person changes request', { personId: id });

    const changes = await getPersonChanges(id);

    res.json({
      success: true,
      data: {
        personId: id,
        changes,
        metadata: {
          count: changes.length,
        },
      },
    });
  } catch (err) {
    logger.error('Error getting person changes', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  getRecentChangesHandler,
  getPersonChangesHandler,
};
