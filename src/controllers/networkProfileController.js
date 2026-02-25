const networkProfileService = require("../services/networkProfileService");
const metricsCache = require("../utils/metricsCache");
const logger = require("../utils/logger");
const { NETWORK_PROFILE_CACHE_TTL_MS } = require("../constants/limits");

/**
 * Parse common query params shared between network-profile and network-profile/trends.
 */
function parseNetworkProfileOptions(query) {
  const industry = query.industry || null;
  const location = query.location || null;
  const seniority = query.seniority || null;
  const minRank = query.minRank
    ? Math.max(Math.min(parseInt(query.minRank) || 1, 8), 1)
    : null;
  const company = query.company || null;
  const companyId = query.companyId || null;
  const topN = Math.min(
    Math.max(parseInt(query.topN) || 10, 1),
    50, // Max 50 items per category
  );
  const fresh = query.fresh === "true";

  const options = { topN };
  if (industry) options.industry = industry;
  if (location) options.location = location;
  if (seniority) options.seniority = seniority;
  if (minRank) options.minRank = minRank;
  if (company) options.company = company;
  if (companyId) options.companyId = companyId;

  return { options, fresh };
}

/**
 * GET /api/insights/network-profile
 *
 * Network composition analysis for 1st-degree connections.
 * Returns distributions across companies, seniority, titles, industries,
 * geography, departments, and average tenure.
 *
 * Query params:
 *   industry  - industry filter (regex)
 *   location  - location filter (regex)
 *   seniority - seniority tier filter (e.g., "VP", "CXO")
 *   minRank   - minimum seniority rank (1-8)
 *   company   - company name filter (regex)
 *   companyId - company ID filter
 *   topN      - number of top items per category (default 10, max 50)
 *   fresh     - bypass cache ("true")
 */
async function getNetworkProfile(req, res, next) {
  try {
    const { options, fresh } = parseNetworkProfileOptions(req.query);

    const cacheKey = `network-profile:${JSON.stringify(options)}`;

    const data = await metricsCache.getOrFetch(
      cacheKey,
      () => networkProfileService.getNetworkProfile(options),
      fresh ? 0 : NETWORK_PROFILE_CACHE_TTL_MS,
    );

    res.json({
      success: true,
      data,
      metadata: {
        generatedAt: new Date().toISOString(),
        cached: !fresh,
      },
    });
  } catch (error) {
    logger.error("Error getting network profile", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

/**
 * GET /api/insights/network-profile/trends
 *
 * Network composition trends comparing current state against 30/60/90-day windows.
 * Returns growth rates across companies, seniority, industry, country, and department.
 *
 * Query params: same as network-profile
 */
async function getNetworkTrends(req, res, next) {
  try {
    const { options, fresh } = parseNetworkProfileOptions(req.query);

    const cacheKey = `network-trends:${JSON.stringify(options)}`;

    const data = await metricsCache.getOrFetch(
      cacheKey,
      () => networkProfileService.getNetworkTrends(options),
      fresh ? 0 : NETWORK_PROFILE_CACHE_TTL_MS,
    );

    res.json({
      success: true,
      data,
      metadata: {
        generatedAt: new Date().toISOString(),
        cached: !fresh,
      },
    });
  } catch (error) {
    logger.error("Error getting network trends", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = {
  getNetworkProfile,
  getNetworkTrends,
};
