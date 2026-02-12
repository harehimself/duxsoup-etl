const signalFeedService = require("../services/signalFeedService");
const metricsCache = require("../utils/metricsCache");
const logger = require("../utils/logger");
const {
  SIGNAL_CACHE_TTL_MS,
  SIGNAL_MAX_DAYS,
  SIGNAL_MAX_LIMIT,
} = require("../constants/limits");

/**
 * GET /api/signals/
 *
 * Engagement trigger feed: ranked, deduplicated signals with action context.
 *
 * Query params:
 *   type      - comma-separated: new_role,promotion,lateral_move,new_decision_maker
 *   minRank   - minimum seniority rank (1-8)
 *   company   - company name filter (regex)
 *   companyId - company ID filter
 *   days      - lookback window (default 30, max 180)
 *   limit     - max results (default 50, max 500)
 *   offset    - pagination offset
 *   fresh     - bypass cache ("true")
 */
async function getSignals(req, res, next) {
  try {
    // Parse and validate query params
    const types = req.query.type
      ? req.query.type
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    const invalidTypes = types.filter(
      (t) => !signalFeedService.VALID_SIGNAL_TYPES.includes(t),
    );
    if (invalidTypes.length > 0) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Invalid signal type(s): ${invalidTypes.join(", ")}. Valid types: ${signalFeedService.VALID_SIGNAL_TYPES.join(", ")}`,
      });
    }

    const minRank = Math.max(Math.min(parseInt(req.query.minRank) || 1, 8), 1);
    const days = Math.min(
      Math.max(parseInt(req.query.days) || 30, 1),
      SIGNAL_MAX_DAYS,
    );
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 50, 1),
      SIGNAL_MAX_LIMIT,
    );
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const company = req.query.company || null;
    const companyId = req.query.companyId || null;
    const fresh = req.query.fresh === "true";

    const options = {
      types: types.length > 0 ? types : undefined,
      minRank,
      days,
      limit,
      offset,
      company,
      companyId,
    };

    // Build cache key from normalized params
    const cacheKey = `signals:${JSON.stringify(options)}`;

    const data = await metricsCache.getOrFetch(
      cacheKey,
      () => signalFeedService.getSignals(options),
      fresh ? 0 : SIGNAL_CACHE_TTL_MS,
    );

    res.json({
      success: true,
      data: data.signals,
      total: data.total,
      limit: data.limit,
      offset: data.offset,
      metadata: {
        types: types.length > 0 ? types : signalFeedService.VALID_SIGNAL_TYPES,
        minRank,
        days,
        generatedAt: new Date().toISOString(),
        cached: !fresh,
      },
    });
  } catch (error) {
    logger.error("Error getting engagement signals", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = { getSignals };
