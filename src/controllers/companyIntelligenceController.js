const companyIntelligenceService = require("../services/companyIntelligenceService");
const metricsCache = require("../utils/metricsCache");
const logger = require("../utils/logger");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCompanyIntelligence(req, res, next) {
  const { id } = req.params;

  if (!id || !id.trim()) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Company ID is required",
    });
  }

  try {
    const fresh = req.query.fresh === "true";
    const cacheKey = `company-intelligence:${id}`;

    const data = await metricsCache.getOrFetch(
      cacheKey,
      () => companyIntelligenceService.getCompanyIntelligence(id),
      fresh ? 0 : CACHE_TTL_MS,
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: `No people found linked to company ${id}`,
      });
    }

    res.json({
      success: true,
      data,
      metadata: {
        companyId: id,
        generatedAt: new Date().toISOString(),
        cached: !fresh,
      },
    });
  } catch (error) {
    logger.error("Error getting company intelligence", {
      company_id: id,
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = { getCompanyIntelligence };
