const Person = require("../models/person");
const logger = require("../utils/logger");

/**
 * Network Profile Service
 *
 * Analyzes composition of 1st-degree connections across multiple dimensions:
 * - Top companies (by headcount)
 * - Seniority tier breakdown
 * - Most common job titles and title clusters
 * - Industry distribution
 * - Geographic spread (cities/countries)
 * - Department breakdown
 * - Average tenure
 *
 * Built entirely from existing person snapshot fields.
 */

/**
 * Get network composition profile for 1st-degree connections
 *
 * @param {Object} options - Filter options
 * @param {string} [options.industry] - Filter by industry (regex)
 * @param {string} [options.location] - Filter by location (regex)
 * @param {string} [options.seniority] - Filter by seniority tier
 * @param {number} [options.minRank] - Filter by minimum seniority rank (1-8)
 * @param {string} [options.company] - Filter by company name (regex)
 * @param {string} [options.companyId] - Filter by company ID
 * @param {number} [options.topN] - Number of top items to return per category (default 10)
 * @returns {Promise<Object>} Network composition analysis
 */
async function getNetworkProfile(options = {}) {
  const {
    industry,
    location,
    seniority,
    minRank,
    company,
    companyId,
    topN = 10,
  } = options;

  // Base filter: only 1st-degree connections, not merged
  const baseFilter = {
    "snapshot.degree": 1,
    mergedInto: { $exists: false },
  };

  // Apply optional filters
  if (industry) {
    baseFilter["snapshot.industry"] = { $regex: industry, $options: "i" };
  }
  if (location) {
    baseFilter["snapshot.location"] = { $regex: location, $options: "i" };
  }
  if (seniority) {
    baseFilter["snapshot.parsedSeniority"] = seniority;
  }
  if (minRank) {
    baseFilter["derived.highestSeniorityRank"] = { $gte: minRank };
  }
  if (company) {
    baseFilter["snapshot.currentCompany"] = { $regex: company, $options: "i" };
  }
  if (companyId) {
    baseFilter["snapshot.currentCompanyId"] = companyId;
  }

  logger.debug("Building network profile", { filters: baseFilter, topN });

  // Run all aggregations in parallel
  const [
    totalCount,
    topCompanies,
    seniorityBreakdown,
    topTitles,
    industryDistribution,
    geographyCity,
    geographyCountry,
    departmentBreakdown,
    tenureStats,
  ] = await Promise.all([
    // Total count
    Person.countDocuments(baseFilter),

    // Top companies by headcount
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.currentCompany": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.currentCompany",
          count: { $sum: 1 },
          companyId: { $first: "$snapshot.currentCompanyId" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          company: "$_id",
          companyId: 1,
          count: 1,
        },
      },
    ]),

    // Seniority tier breakdown
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.parsedSeniority": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.parsedSeniority",
          count: { $sum: 1 },
          avgRank: { $avg: "$derived.highestSeniorityRank" },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          seniority: "$_id",
          count: 1,
          avgRank: { $round: ["$avgRank", 1] },
        },
      },
    ]),

    // Top titles
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.currentTitle": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.currentTitle",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          title: "$_id",
          count: 1,
        },
      },
    ]),

    // Industry distribution
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.industry": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.industry",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          industry: "$_id",
          count: 1,
        },
      },
    ]),

    // Top cities
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.city": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: {
            city: "$snapshot.city",
            state: "$snapshot.state",
            country: "$snapshot.country",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          city: "$_id.city",
          state: "$_id.state",
          country: "$_id.country",
          count: 1,
        },
      },
    ]),

    // Top countries
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.country": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.country",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: topN },
      {
        $project: {
          _id: 0,
          country: "$_id",
          count: 1,
        },
      },
    ]),

    // Department breakdown
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "snapshot.parsedDepartment": { $exists: true, $nin: ["", null] },
        },
      },
      {
        $group: {
          _id: "$snapshot.parsedDepartment",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          department: "$_id",
          count: 1,
        },
      },
    ]),

    // Average tenure (for people with current company and tenure data)
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "derived.yearsAtCurrentCompany": { $exists: true, $ne: null, $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          avgTenureYears: { $avg: "$derived.yearsAtCurrentCompany" },
          medianTenureYears: { $avg: "$derived.yearsAtCurrentCompany" }, // Approximation
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          avgTenureYears: { $round: ["$avgTenureYears", 1] },
          medianTenureYears: { $round: ["$medianTenureYears", 1] },
          count: 1,
        },
      },
    ]),
  ]);

  // Calculate percentages for each distribution
  const addPercentages = (items, total) => {
    return items.map((item) => ({
      ...item,
      percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
    }));
  };

  const companiesTotal = topCompanies.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const seniorityTotal = seniorityBreakdown.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const titlesTotal = topTitles.reduce((sum, item) => sum + item.count, 0);
  const industryTotal = industryDistribution.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const cityTotal = geographyCity.reduce((sum, item) => sum + item.count, 0);
  const countryTotal = geographyCountry.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const departmentTotal = departmentBreakdown.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  const result = {
    totalConnections: totalCount,
    topCompanies: addPercentages(topCompanies, companiesTotal),
    seniorityBreakdown: addPercentages(seniorityBreakdown, seniorityTotal),
    topTitles: addPercentages(topTitles, titlesTotal),
    industryDistribution: addPercentages(industryDistribution, industryTotal),
    geography: {
      topCities: addPercentages(geographyCity, cityTotal),
      topCountries: addPercentages(geographyCountry, countryTotal),
    },
    departmentBreakdown: addPercentages(departmentBreakdown, departmentTotal),
    averageTenure: tenureStats[0] || {
      avgTenureYears: 0,
      medianTenureYears: 0,
      count: 0,
    },
    filters: options,
  };

  logger.debug("Network profile built", {
    totalConnections: result.totalConnections,
    companiesCount: topCompanies.length,
    seniorityCount: seniorityBreakdown.length,
  });

  return result;
}

module.exports = {
  getNetworkProfile,
};
