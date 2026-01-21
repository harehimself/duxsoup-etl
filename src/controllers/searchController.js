const { smartSearch } = require('../services/searchService');
const logger = require('../utils/logger');

/**
 * Search Controller
 *
 * Handles HTTP requests for full-text search
 */

/**
 * Search people with full-text search
 *
 * GET /api/search?q=john+doe+google&limit=20&skip=0
 *
 * Query parameters:
 * - q: Search query string (required)
 * - limit: Result limit (default: 20, max: 100)
 * - skip: Results to skip for pagination (default: 0)
 * - fields: Comma-separated list of fields to return (optional)
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function searchPeopleHandler(req, res, next) {
  try {
    const { q: query, limit, skip, fields: fieldsParam } = req.query;

    logger.info('Received search request', { query, limit, skip });

    // Parse fields parameter (comma-separated)
    let fields = null;
    if (fieldsParam) {
      fields = fieldsParam.split(',').map((f) => f.trim());
    }

    const result = await smartSearch({
      query,
      limit,
      skip,
      fields,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    logger.error('Error executing search', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  searchPeopleHandler,
};
