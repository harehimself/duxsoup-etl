const Person = require('../models/person');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Search Service
 *
 * Full-text search across people names, titles, and companies
 * Uses MongoDB text index for relevance-based search
 */

/**
 * Search people using full-text search
 *
 * @param {Object} params - Search parameters
 * @param {String} params.query - Search query string
 * @param {Number} params.limit - Result limit (default: 20, max: 100)
 * @param {Number} params.skip - Results to skip (pagination)
 * @param {Array<String>} params.fields - Fields to return (optional)
 * @returns {Promise<Object>} Search results with metadata
 */
async function searchPeople(params) {
  const { query, limit = 20, skip = 0, fields } = params;

  // Validate query
  if (!query || typeof query !== 'string') {
    throw new AppError('INVALID_QUERY', 'Search query is required');
  }

  if (query.trim().length === 0) {
    throw new AppError('INVALID_QUERY', 'Search query cannot be empty');
  }

  // Validate limit
  const parsedLimit = parseInt(limit, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    throw new AppError('INVALID_LIMIT', 'Limit must be a positive integer');
  }

  if (parsedLimit > 100) {
    throw new AppError('LIMIT_EXCEEDED', 'Limit cannot exceed 100');
  }

  // Validate skip
  const parsedSkip = parseInt(skip, 10);
  if (isNaN(parsedSkip) || parsedSkip < 0) {
    throw new AppError('INVALID_SKIP', 'Skip must be a non-negative integer');
  }

  logger.info('Executing text search', { query, limit: parsedLimit, skip: parsedSkip });

  // Build search query
  let searchQuery = Person.find(
    { $text: { $search: query } },
    { score: { $meta: 'textScore' } },
  );

  // Apply field selection if specified
  if (fields && Array.isArray(fields) && fields.length > 0) {
    const projection = fields.join(' ');
    searchQuery = searchQuery.select(projection);
  }

  // Sort by relevance score (text score)
  searchQuery = searchQuery.sort({ score: { $meta: 'textScore' } });

  // Apply pagination
  searchQuery = searchQuery.skip(parsedSkip).limit(parsedLimit);

  // Execute query
  const results = await searchQuery.lean().exec();

  // Count total matches (expensive, consider caching for common queries)
  const totalCount = await Person.countDocuments({
    $text: { $search: query },
  });

  logger.info('Search executed successfully', {
    query,
    resultCount: results.length,
    totalCount,
  });

  return {
    results,
    metadata: {
      query,
      count: results.length,
      totalCount,
      limit: parsedLimit,
      skip: parsedSkip,
      hasMore: parsedSkip + results.length < totalCount,
      nextSkip: parsedSkip + results.length < totalCount ? parsedSkip + parsedLimit : null,
    },
  };
}

/**
 * Search people with fuzzy matching (fallback when text search returns no results)
 *
 * Uses regex for partial matching on names, titles, and companies
 *
 * @param {Object} params - Search parameters
 * @param {String} params.query - Search query string
 * @param {Number} params.limit - Result limit
 * @returns {Promise<Object>} Search results
 */
async function fuzzySearchPeople(params) {
  const { query, limit = 20 } = params;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new AppError('INVALID_QUERY', 'Search query is required');
  }

  logger.info('Executing fuzzy search (text search returned no results)', { query });

  // Escape special regex characters to prevent regex injection, then split on whitespace for OR matching
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '|');
  const regex = new RegExp(pattern, 'i');

  // Search across multiple fields
  const results = await Person.find({
    $or: [
      { 'snapshot.fullName': regex },
      { 'snapshot.currentTitle': regex },
      { 'snapshot.currentCompany': regex },
    ],
  })
    .limit(limit)
    .lean()
    .exec();

  logger.info('Fuzzy search completed', {
    query,
    resultCount: results.length,
  });

  return {
    results,
    metadata: {
      query,
      count: results.length,
      fuzzy: true,
      message: 'Using fuzzy matching (no exact text matches found)',
    },
  };
}

/**
 * Smart search that tries text search first, then falls back to fuzzy search
 *
 * @param {Object} params - Search parameters
 * @returns {Promise<Object>} Search results
 */
async function smartSearch(params) {
  // Try text search first
  const textResults = await searchPeople(params);

  // If no results, try fuzzy search
  if (textResults.results.length === 0) {
    logger.info('Text search returned no results, trying fuzzy search', {
      query: params.query,
    });

    return await fuzzySearchPeople(params);
  }

  return textResults;
}

module.exports = {
  searchPeople,
  fuzzySearchPeople,
  smartSearch,
};
