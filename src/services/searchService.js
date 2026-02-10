const Person = require("../models/person");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

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
  if (!query || typeof query !== "string") {
    throw new AppError("INVALID_QUERY", "Search query is required");
  }

  if (query.trim().length === 0) {
    throw new AppError("INVALID_QUERY", "Search query cannot be empty");
  }

  // Validate limit
  const parsedLimit = parseInt(limit, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1) {
    throw new AppError("INVALID_LIMIT", "Limit must be a positive integer");
  }

  if (parsedLimit > 100) {
    throw new AppError("LIMIT_EXCEEDED", "Limit cannot exceed 100");
  }

  // Validate skip
  const parsedSkip = parseInt(skip, 10);
  if (isNaN(parsedSkip) || parsedSkip < 0) {
    throw new AppError("INVALID_SKIP", "Skip must be a non-negative integer");
  }

  logger.info("Executing text search", {
    query,
    limit: parsedLimit,
    skip: parsedSkip,
  });

  // Build search query
  let searchQuery = Person.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } },
  );

  // Apply field selection if specified
  if (fields && Array.isArray(fields) && fields.length > 0) {
    const projection = fields.join(" ");
    searchQuery = searchQuery.select(projection);
  }

  // Sort by relevance score (text score)
  searchQuery = searchQuery.sort({ score: { $meta: "textScore" } });

  // Apply pagination
  searchQuery = searchQuery.skip(parsedSkip).limit(parsedLimit);

  // Execute search and count in parallel to halve MongoDB round-trips
  const [results, totalCount] = await Promise.all([
    searchQuery.lean().exec(),
    Person.countDocuments({ $text: { $search: query } }),
  ]);

  logger.info("Search executed successfully", {
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
      nextSkip:
        parsedSkip + results.length < totalCount
          ? parsedSkip + parsedLimit
          : null,
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
  const { query, limit = 20, skip = 0 } = params;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new AppError("INVALID_QUERY", "Search query is required");
  }

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const parsedSkip = Math.max(parseInt(skip, 10) || 0, 0);

  logger.info("Executing fuzzy search (text search returned no results)", {
    query,
  });

  // Split query into terms and escape regex special characters
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const searchFields = [
    "snapshot.fullName",
    "snapshot.currentTitle",
    "snapshot.currentCompany",
  ];

  // AND-join: every term must match at least one field in the document
  // "John Doe" requires both "John" AND "Doe" to appear (in any field)
  const termConditions = terms.map((term) => {
    const regex = new RegExp(term, "i");
    return {
      $or: searchFields.map((field) => ({ [field]: regex })),
    };
  });

  const filter =
    termConditions.length === 1 ? termConditions[0] : { $and: termConditions };

  // Relevance scoring: fullName matches weighted 3x, other fields 1x
  const relevanceFields = terms.flatMap((term) =>
    searchFields.map((field) => ({
      $cond: [
        {
          $regexMatch: {
            input: { $ifNull: [`$${field}`, ""] },
            regex: term,
            options: "i",
          },
        },
        field === "snapshot.fullName" ? 3 : 1,
        0,
      ],
    })),
  );

  const pipeline = [
    { $match: filter },
    { $addFields: { _relevance: { $sum: relevanceFields } } },
    { $sort: { _relevance: -1 } },
    { $skip: parsedSkip },
    { $limit: parsedLimit },
    { $project: { _relevance: 0 } },
  ];

  const [results, totalCount] = await Promise.all([
    Person.aggregate(pipeline).exec(),
    Person.countDocuments(filter),
  ]);

  logger.info("Fuzzy search completed", {
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
      nextSkip:
        parsedSkip + results.length < totalCount
          ? parsedSkip + parsedLimit
          : null,
      fuzzy: true,
      message: "Using fuzzy matching (no exact text matches found)",
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
    logger.info("Text search returned no results, trying fuzzy search", {
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
