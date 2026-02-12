const networkProfileService = require("../services/networkProfileService");
const metricsCache = require("../utils/metricsCache");
const logger = require("../utils/logger");
const { NETWORK_PROFILE_CACHE_TTL_MS } = require("../constants/limits");

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
    const industry = req.query.industry || null;
    const location = req.query.location || null;
    const seniority = req.query.seniority || null;
    const minRank = req.query.minRank
      ? Math.max(Math.min(parseInt(req.query.minRank) || 1, 8), 1)
      : null;
    const company = req.query.company || null;
    const companyId = req.query.companyId || null;
    const topN = Math.min(
      Math.max(parseInt(req.query.topN) || 10, 1),
      50, // Max 50 items per category
    );
    const fresh = req.query.fresh === "true";

    const options = { topN };
    if (industry) options.industry = industry;
    if (location) options.location = location;
    if (seniority) options.seniority = seniority;
    if (minRank) options.minRank = minRank;
    if (company) options.company = company;
    if (companyId) options.companyId = companyId;

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

module.exports = {
  getNetworkProfile,
};
