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
 * Calculate true median from an array of numeric values.
 * @param {number[]} values
 * @returns {number|null}
 */
function calculateMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Build base filter for 1st-degree connections with optional filters.
 *
 * @param {Object} options - Filter options
 * @returns {Object} MongoDB filter document
 */
function buildBaseFilter(options = {}) {
  const { industry, location, seniority, minRank, company, companyId } =
    options;

  const baseFilter = {
    "snapshot.degree": 1,
    mergedInto: { $exists: false },
  };

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

  return baseFilter;
}

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
  const { topN = 10 } = options;

  const baseFilter = buildBaseFilter(options);

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

    // Tenure: push values for true median calculation
    Person.aggregate([
      { $match: baseFilter },
      {
        $match: {
          "derived.yearsAtCurrentCompany": {
            $exists: true,
            $ne: null,
            $gt: 0,
          },
        },
      },
      {
        $group: {
          _id: null,
          avgTenureYears: { $avg: "$derived.yearsAtCurrentCompany" },
          values: { $push: "$derived.yearsAtCurrentCompany" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          avgTenureYears: { $round: ["$avgTenureYears", 1] },
          values: 1,
          count: 1,
        },
      },
    ]),
  ]);

  // Calculate percentages using totalCount as denominator
  const addPercentages = (items, total) => {
    return items.map((item) => ({
      ...item,
      percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
    }));
  };

  // Compute true median from pushed values
  const tenureData = tenureStats[0];
  const medianTenureYears = tenureData
    ? Math.round(calculateMedian(tenureData.values) * 10) / 10
    : 0;

  const result = {
    totalConnections: totalCount,
    topCompanies: addPercentages(topCompanies, totalCount),
    seniorityBreakdown: addPercentages(seniorityBreakdown, totalCount),
    topTitles: addPercentages(topTitles, totalCount),
    industryDistribution: addPercentages(industryDistribution, totalCount),
    geography: {
      topCities: addPercentages(geographyCity, totalCount),
      topCountries: addPercentages(geographyCountry, totalCount),
    },
    departmentBreakdown: addPercentages(departmentBreakdown, totalCount),
    averageTenure: {
      avgTenureYears: tenureData ? tenureData.avgTenureYears : 0,
      medianTenureYears,
      count: tenureData ? tenureData.count : 0,
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

/**
 * Get network composition trends comparing current state against 30/60/90-day windows.
 *
 * For each window, identifies connections added within that period and computes
 * growth rates across companies, seniority, industry, country, and department.
 *
 * @param {Object} options - Same filter options as getNetworkProfile
 * @returns {Promise<Object>} Network trends analysis
 */
async function getNetworkTrends(options = {}) {
  const baseFilter = buildBaseFilter(options);

  const now = new Date();
  const windowDays = [30, 60, 90];

  // 1 countDocuments for current total + 3 aggregate calls (one per window)
  const [totalConnections, ...windowResults] = await Promise.all([
    Person.countDocuments(baseFilter),
    ...windowDays.map((days) => {
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const windowFilter = { ...baseFilter, createdAt: { $gte: cutoff } };

      return Person.aggregate([
        { $match: windowFilter },
        {
          $facet: {
            total: [{ $count: "count" }],
            byCompany: [
              {
                $match: {
                  "snapshot.currentCompany": {
                    $exists: true,
                    $nin: ["", null],
                  },
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
              { $limit: 10 },
              {
                $project: {
                  _id: 0,
                  company: "$_id",
                  companyId: 1,
                  count: 1,
                },
              },
            ],
            bySeniority: [
              {
                $match: {
                  "snapshot.parsedSeniority": {
                    $exists: true,
                    $nin: ["", null],
                  },
                },
              },
              {
                $group: {
                  _id: "$snapshot.parsedSeniority",
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $project: { _id: 0, seniority: "$_id", count: 1 } },
            ],
            byIndustry: [
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
              { $limit: 10 },
              { $project: { _id: 0, industry: "$_id", count: 1 } },
            ],
            byCountry: [
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
              { $limit: 10 },
              { $project: { _id: 0, country: "$_id", count: 1 } },
            ],
            byDepartment: [
              {
                $match: {
                  "snapshot.parsedDepartment": {
                    $exists: true,
                    $nin: ["", null],
                  },
                },
              },
              {
                $group: {
                  _id: "$snapshot.parsedDepartment",
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $project: { _id: 0, department: "$_id", count: 1 } },
            ],
          },
        },
      ]);
    }),
  ]);

  const insights = [];
  const windows = {};

  windowDays.forEach((days, i) => {
    const facetResult = windowResults[i][0] || {};
    const newConnections =
      facetResult.total && facetResult.total[0]
        ? facetResult.total[0].count
        : 0;

    const previousTotal = totalConnections - newConnections;
    const growthRate =
      previousTotal > 0
        ? Math.round((newConnections / previousTotal) * 1000) / 10
        : newConnections > 0
          ? 100
          : 0;

    const byCompany = (facetResult.byCompany || []).map((item) => ({
      company: item.company,
      companyId: item.companyId,
      current: item.count,
      new: item.count,
      growthRate: item.count,
    }));

    const bySeniority = (facetResult.bySeniority || []).map((item) => ({
      seniority: item.seniority,
      current: item.count,
      new: item.count,
      growthRate: item.count,
    }));

    const byIndustry = (facetResult.byIndustry || []).map((item) => ({
      industry: item.industry,
      current: item.count,
      new: item.count,
      growthRate: item.count,
    }));

    const byCountry = (facetResult.byCountry || []).map((item) => ({
      country: item.country,
      current: item.count,
      new: item.count,
      growthRate: item.count,
    }));

    const byDepartment = (facetResult.byDepartment || []).map((item) => ({
      department: item.department,
      current: item.count,
      new: item.count,
      growthRate: item.count,
    }));

    windows[`${days}d`] = {
      newConnections,
      growthRate,
      byCompany,
      bySeniority,
      byIndustry,
      byCountry,
      byDepartment,
    };

    // Generate insights for the shortest window (30d) only
    if (days === 30 && newConnections > 0) {
      // Industry insights
      for (const item of facetResult.byIndustry || []) {
        if (item.count > 2 && previousTotal > 0) {
          const pct = Math.round((item.count / previousTotal) * 1000) / 10;
          if (pct > 10) {
            insights.push(
              `Your ${item.industry} connections grew ${pct}% in the last 30 days (${item.count} new)`,
            );
          }
        }
      }

      // Seniority insights
      for (const item of facetResult.bySeniority || []) {
        if (item.count > 2 && previousTotal > 0) {
          const pct = Math.round((item.count / previousTotal) * 1000) / 10;
          if (pct > 10) {
            insights.push(
              `${item.seniority}-level connections grew ${pct}% in the last 30 days (${item.count} new)`,
            );
          }
        }
      }

      // Company insights
      for (const item of facetResult.byCompany || []) {
        if (item.count > 2 && previousTotal > 0) {
          const pct = Math.round((item.count / previousTotal) * 1000) / 10;
          if (pct > 10) {
            insights.push(
              `${item.company} connections grew ${pct}% in the last 30 days (${item.count} new)`,
            );
          }
        }
      }
    }
  });

  logger.debug("Network trends built", {
    totalConnections,
    windows: Object.keys(windows),
    insightsCount: insights.length,
  });

  return {
    totalConnections,
    windows,
    insights,
    filters: options,
  };
}

module.exports = {
  getNetworkProfile,
  getNetworkTrends,
  _calculateMedian: calculateMedian,
  _buildBaseFilter: buildBaseFilter,
};
