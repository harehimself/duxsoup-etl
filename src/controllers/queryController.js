const { queryPeople, queryCompanies } = require('../services/queryBuilder');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Query Controller
 *
 * Handles HTTP requests for querying people and companies
 */

/**
 * Query people with filters, sorting, and pagination
 *
 * POST /api/query/people
 *
 * Request body:
 * {
 *   "filters": {
 *     "snapshot.currentTitle": { "$regex": "VP|Director", "$options": "i" },
 *     "snapshot.currentCompany": "Google",
 *     "snapshot.city": "San Francisco"
 *   },
 *   "sort": { "snapshot.connections": -1 },
 *   "limit": 100,
 *   "skip": 0,
 *   "fields": ["snapshot.fullName", "snapshot.currentTitle", "snapshot.currentCompany"]
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function queryPeopleHandler(req, res, next) {
  try {
    const { filters, sort, limit, skip, fields } = req.body;

    logger.info('Received people query request', {
      filters,
      sort,
      limit,
      skip,
      fieldsCount: fields?.length,
    });

    const result = await queryPeople({
      filters,
      sort,
      limit,
      skip,
      fields,
    });

    res.json({
      success: true,
      data: result.results,
      pagination: {
        offset: skip || 0,
        limit: result.metadata.limit,
        count: result.metadata.count,
        totalCount: result.metadata.totalCount,
        hasMore: result.metadata.hasMore,
        nextSkip: result.metadata.nextSkip,
      },
    });
  } catch (err) {
    logger.error('Error executing people query', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Query companies (aggregated from people)
 *
 * POST /api/query/companies
 *
 * Request body:
 * {
 *   "filters": {
 *     "snapshot.city": "San Francisco",
 *     "snapshot.industry": "Technology"
 *   },
 *   "limit": 50
 * }
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function queryCompaniesHandler(req, res, next) {
  try {
    const { filters, limit } = req.body;

    logger.info('Received companies query request', { filters, limit });

    const result = await queryCompanies({
      filters,
      limit,
    });

    res.json({
      success: true,
      data: result.results,
      pagination: {
        count: result.metadata.count,
      },
    });
  } catch (err) {
    logger.error('Error executing companies query', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

/**
 * Get query helper information
 *
 * GET /api/query/help
 *
 * Returns information about available filters, operators, and examples
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
function getQueryHelp(req, res) {
  const {
    ALLOWED_FILTER_FIELDS,
    ALLOWED_SORT_FIELDS,
    MAX_LIMIT,
  } = require('../utils/queryValidation');

  res.json({
    success: true,
    data: {
      allowedFilterFields: ALLOWED_FILTER_FIELDS,
      allowedSortFields: ALLOWED_SORT_FIELDS,
      allowedOperators: [
        '$eq',
        '$ne',
        '$gt',
        '$gte',
        '$lt',
        '$lte',
        '$in',
        '$nin',
        '$regex',
        '$options',
        '$exists',
        '$and',
        '$or',
      ],
      maxLimit: MAX_LIMIT,
      examples: [
        {
          description: 'Find VPs at Google in San Francisco',
          query: {
            filters: {
              'snapshot.currentTitle': {
                $regex: 'VP|Vice President',
                $options: 'i',
              },
              'snapshot.currentCompany': 'Google',
              'snapshot.city': 'San Francisco',
            },
            sort: { 'snapshot.connections': -1 },
            limit: 50,
          },
        },
        {
          description: 'Find engineers with 500+ connections',
          query: {
            filters: {
              'snapshot.currentTitle': { $regex: 'Engineer', $options: 'i' },
              'snapshot.connections': { $gte: 500 },
            },
            sort: { 'snapshot.connections': -1 },
            limit: 100,
          },
        },
        {
          description: 'Find people at tech companies OR finance companies',
          query: {
            filters: {
              $or: [
                { 'snapshot.industry': { $regex: 'Technology', $options: 'i' } },
                { 'snapshot.industry': { $regex: 'Finance', $options: 'i' } },
              ],
            },
            limit: 100,
          },
        },
      ],
    },
  });
}

module.exports = {
  queryPeopleHandler,
  queryCompaniesHandler,
  getQueryHelp,
};
