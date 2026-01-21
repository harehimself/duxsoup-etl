const {
  getPeopleBySegment,
  recalculateAllScores,
} = require('../services/scoringService');
const logger = require('../utils/logger');

/**
 * Segment Controller
 *
 * Handles HTTP requests for segment-based queries
 */

/**
 * Get high-value prospects (leadScore >= 70)
 *
 * GET /api/segments/high-value?limit=50
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getHighValueProspectsHandler(req, res, next) {
  try {
    const { limit = 100 } = req.query;

    logger.info('Received high-value prospects request', { limit });

    const people = await getPeopleBySegment('high_value', parseInt(limit, 10));

    res.json({
      success: true,
      data: {
        segment: 'high_value',
        people,
        metadata: {
          count: people.length,
          limit: parseInt(limit, 10),
        },
      },
    });
  } catch (err) {
    logger.error('Error getting high-value prospects', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get decision makers (VP/Director/C-level)
 *
 * GET /api/segments/decision-makers?limit=50
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getDecisionMakersHandler(req, res, next) {
  try {
    const { limit = 100 } = req.query;

    logger.info('Received decision makers request', { limit });

    const people = await getPeopleBySegment('decision_maker', parseInt(limit, 10));

    res.json({
      success: true,
      data: {
        segment: 'decision_maker',
        people,
        metadata: {
          count: people.length,
          limit: parseInt(limit, 10),
        },
      },
    });
  } catch (err) {
    logger.error('Error getting decision makers', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get warm leads (job change in last 30 days)
 *
 * GET /api/segments/warm-leads?limit=50
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getWarmLeadsHandler(req, res, next) {
  try {
    const { limit = 100 } = req.query;

    logger.info('Received warm leads request', { limit });

    const people = await getPeopleBySegment('warm_lead', parseInt(limit, 10));

    res.json({
      success: true,
      data: {
        segment: 'warm_lead',
        people,
        metadata: {
          count: people.length,
          limit: parseInt(limit, 10),
        },
      },
    });
  } catch (err) {
    logger.error('Error getting warm leads', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get prospects needing enrichment (missing email/phone)
 *
 * GET /api/segments/needs-enrichment?limit=50
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function getNeedsEnrichmentHandler(req, res, next) {
  try {
    const { limit = 100 } = req.query;

    logger.info('Received needs enrichment request', { limit });

    const people = await getPeopleBySegment('needs_enrichment', parseInt(limit, 10));

    res.json({
      success: true,
      data: {
        segment: 'needs_enrichment',
        people,
        metadata: {
          count: people.length,
          limit: parseInt(limit, 10),
        },
      },
    });
  } catch (err) {
    logger.error('Error getting needs enrichment', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Trigger score recalculation for all people
 *
 * POST /api/segments/recalculate
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function recalculateScoresHandler(req, res, next) {
  try {
    const { batchSize, limit } = req.body;

    logger.info('Received score recalculation request', { batchSize, limit });

    // Start recalculation asynchronously
    recalculateAllScores({ batchSize, limit })
      .then((stats) => {
        logger.info('Score recalculation completed', stats);
      })
      .catch((err) => {
        logger.error('Score recalculation failed', {
          error: err.message,
          stack: err.stack,
        });
      });

    res.status(202).json({
      success: true,
      data: {
        message: 'Score recalculation started. Check logs for progress.',
      },
    });
  } catch (err) {
    logger.error('Error starting score recalculation', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  getHighValueProspectsHandler,
  getDecisionMakersHandler,
  getWarmLeadsHandler,
  getNeedsEnrichmentHandler,
  recalculateScoresHandler,
};
