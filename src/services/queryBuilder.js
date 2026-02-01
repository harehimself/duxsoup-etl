const Person = require("../models/person");
const { validateQuery } = require("../utils/queryValidation");
const logger = require("../utils/logger");

/**
 * Query Builder Service
 *
 * Converts validated filter DSL to MongoDB queries and executes them.
 * Handles complex queries with AND/OR logic, sorting, and pagination.
 */

/**
 * Query people collection with filters, sorting, and pagination
 *
 * @param {Object} queryParams - Query parameters
 * @param {Object} queryParams.filters - MongoDB filter object
 * @param {Object} queryParams.sort - Sort specification
 * @param {Number} queryParams.limit - Result limit
 * @param {Number} queryParams.skip - Results to skip
 * @param {Array<String>} queryParams.fields - Fields to return (optional)
 * @returns {Promise<Object>} Query results with metadata
 */
async function queryPeople(queryParams) {
  // Validate query parameters
  const validated = validateQuery(queryParams);
  const { filters, sort, limit, skip } = validated;
  const { fields } = queryParams;

  logger.info("Executing people query", {
    filters,
    sort,
    limit,
    skip,
    fields,
  });

  // Build query
  let query = Person.find(filters);

  // Apply field selection if specified
  if (fields && Array.isArray(fields) && fields.length > 0) {
    const projection = fields.join(" ");
    query = query.select(projection);
  }

  // Apply sorting
  if (Object.keys(sort).length > 0) {
    query = query.sort(sort);
  } else {
    // Default sort by last observed (most recent first)
    query = query.sort({ "meta.lastObservedAt": -1 });
  }

  // Apply pagination
  query = query.skip(skip).limit(limit);

  // Execute query and count
  const [results, totalCount] = await Promise.all([
    query.lean().exec(),
    Person.countDocuments(filters),
  ]);

  logger.info("Query executed successfully", {
    resultCount: results.length,
    totalCount,
    hasMore: skip + results.length < totalCount,
  });

  return {
    results,
    metadata: {
      count: results.length,
      totalCount,
      limit,
      skip,
      hasMore: skip + results.length < totalCount,
      nextSkip: skip + results.length < totalCount ? skip + limit : null,
    },
  };
}

/**
 * Query companies (distinct companies from people collection)
 *
 * @param {Object} queryParams - Query parameters
 * @param {Object} queryParams.filters - MongoDB filter object for people
 * @param {Number} queryParams.limit - Result limit
 * @returns {Promise<Object>} Company aggregation results
 */
async function queryCompanies(queryParams) {
  const { filters = {}, limit = 100 } = queryParams;

  logger.info("Executing companies query", { filters, limit });

  // Build aggregation pipeline
  const pipeline = [];

  // Match stage (apply filters)
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }

  // Group by company
  pipeline.push({
    $group: {
      _id: "$snapshot.currentCompany",
      companyId: { $first: "$snapshot.currentCompanyId" },
      employeeCount: { $sum: 1 },
      employees: {
        $push: {
          id: "$_id",
          fullName: "$snapshot.fullName",
          title: "$snapshot.currentTitle",
          connections: "$snapshot.connections",
        },
      },
      avgConnections: { $avg: "$snapshot.connections" },
      cities: { $addToSet: "$snapshot.city" },
      industries: { $addToSet: "$snapshot.industry" },
    },
  });

  // Filter out null/empty companies
  pipeline.push({
    $match: {
      _id: { $ne: null, $nin: [""] },
    },
  });

  // Sort by employee count (descending)
  pipeline.push({
    $sort: { employeeCount: -1 },
  });

  // Limit results
  pipeline.push({ $limit: limit });

  // Project final shape
  pipeline.push({
    $project: {
      _id: 0,
      companyName: "$_id",
      companyId: 1,
      employeeCount: 1,
      employees: { $slice: ["$employees", 10] }, // Limit employee list to 10
      avgConnections: { $round: ["$avgConnections", 0] },
      cities: 1,
      industries: 1,
    },
  });

  const results = await Person.aggregate(pipeline);

  logger.info("Company query executed", { resultCount: results.length });

  return {
    results,
    metadata: {
      count: results.length,
      limit,
    },
  };
}

/**
 * Build a seniority filter (VP, Director, C-level, etc.)
 *
 * @param {String} level - Seniority level (vp, director, c-level, senior, manager, individual)
 * @returns {Object} MongoDB filter object
 */
function buildSeniorityFilter(level) {
  const patterns = {
    "c-level": /Chief|CEO|CFO|CTO|COO|CMO|CSO|CIO|CPO|CRO/i,
    vp: /VP|Vice President|V\.P\./i,
    director: /Director|Dir\./i,
    senior: /Senior|Sr\.|Lead/i,
    manager: /Manager|Mgr\./i,
    individual: /Engineer|Developer|Analyst|Designer|Specialist|Coordinator/i,
  };

  const pattern = patterns[level.toLowerCase()];

  if (!pattern) {
    throw new Error(
      `Invalid seniority level: ${level}. Valid levels: ${Object.keys(patterns).join(", ")}`,
    );
  }

  return {
    "snapshot.currentTitle": { $regex: pattern.source, $options: "i" },
  };
}

/**
 * Build a connections range filter
 *
 * @param {String} range - Range name (influencer, well-connected, connected, new)
 * @returns {Object} MongoDB filter object
 */
function buildConnectionsFilter(range) {
  const ranges = {
    influencer: { $gte: 1000 },
    "well-connected": { $gte: 500, $lt: 1000 },
    connected: { $gte: 100, $lt: 500 },
    new: { $lt: 100 },
  };

  const filter = ranges[range.toLowerCase()];

  if (!filter) {
    throw new Error(
      `Invalid connections range: ${range}. Valid ranges: ${Object.keys(ranges).join(", ")}`,
    );
  }

  return {
    "snapshot.connections": filter,
  };
}

module.exports = {
  queryPeople,
  queryCompanies,
  buildSeniorityFilter,
  buildConnectionsFilter,
};
