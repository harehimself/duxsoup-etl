const enrichmentGapService = require("../services/enrichmentGapService");
const { escapeCsvField } = require("../services/exportService");
const metricsCache = require("../utils/metricsCache");
const logger = require("../utils/logger");
const {
  ENRICHMENT_GAP_MAX_LIMIT,
  ENRICHMENT_GAP_DEFAULT_LIMIT,
  ENRICHMENT_GAP_CACHE_TTL_MS,
} = require("../constants/limits");

/**
 * GET /api/insights/enrichment-gaps
 *
 * Enrichment gap analysis dashboard: per-field missing counts/percentages,
 * ranked by severity, with seniority-tier breakdown.
 *
 * Query params:
 *   seniority - seniority tier filter (e.g., "VP", "CXO")
 *   minRank   - minimum seniority rank (1-8)
 *   company   - company name filter (regex)
 *   companyId - company ID filter
 *   fields    - comma-separated gap fields to report
 *   fresh     - bypass cache ("true")
 */
async function getEnrichmentGaps(req, res, next) {
  try {
    const seniority = req.query.seniority || null;
    const minRank = req.query.minRank
      ? Math.max(Math.min(parseInt(req.query.minRank) || 1, 8), 1)
      : null;
    const company = req.query.company || null;
    const companyId = req.query.companyId || null;
    const fields = req.query.fields
      ? req.query.fields
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean)
      : null;
    const fresh = req.query.fresh === "true";

    const options = {};
    if (seniority) options.seniority = seniority;
    if (minRank) options.minRank = minRank;
    if (company) options.company = company;
    if (companyId) options.companyId = companyId;
    if (fields) options.fields = fields;

    const cacheKey = `enrichment-gaps:${JSON.stringify(options)}`;

    const data = await metricsCache.getOrFetch(
      cacheKey,
      () => enrichmentGapService.getEnrichmentGaps(options),
      fresh ? 0 : ENRICHMENT_GAP_CACHE_TTL_MS,
    );

    res.json({
      success: true,
      data,
      metadata: {
        filters: options,
        generatedAt: new Date().toISOString(),
        cached: !fresh,
      },
    });
  } catch (error) {
    logger.error("Error getting enrichment gaps", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

/**
 * GET /api/insights/enrichment-gaps/revisit-list
 *
 * Prioritized list of people with enrichment gaps, scored by
 * contact value + gap severity. Returns CSV (default) or JSON.
 *
 * Query params:
 *   limit     - max results (default 100, max 500)
 *   minScore  - minimum priority score (default 0)
 *   seniority - seniority tier filter
 *   minRank   - minimum seniority rank (1-8)
 *   company   - company name filter (regex)
 *   companyId - company ID filter
 *   format    - response format: csv (default) or json
 */
async function getRevisitList(req, res, next) {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || ENRICHMENT_GAP_DEFAULT_LIMIT, 1),
      ENRICHMENT_GAP_MAX_LIMIT,
    );
    const minScore = Math.max(parseInt(req.query.minScore) || 0, 0);
    const seniority = req.query.seniority || null;
    const minRank = req.query.minRank
      ? Math.max(Math.min(parseInt(req.query.minRank) || 1, 8), 1)
      : null;
    const company = req.query.company || null;
    const companyId = req.query.companyId || null;
    const format = req.query.format === "json" ? "json" : "csv";

    const options = { limit, minScore };
    if (seniority) options.seniority = seniority;
    if (minRank) options.minRank = minRank;
    if (company) options.company = company;
    if (companyId) options.companyId = companyId;

    const results = await enrichmentGapService.getRevisitList(options);

    if (format === "csv") {
      const csvHeaders = [
        "Profile URL",
        "Name",
        "Title",
        "Company",
        "Priority Score",
        "Gap Score",
        "Contact Value",
        "Missing Fields",
        "Last Observed",
      ];

      const csvRows = results.map((r) =>
        [
          r.profileUrl,
          r.name,
          r.currentTitle,
          r.currentCompany,
          r.priorityScore,
          r.gapScore,
          r.contactValue,
          r.missingFields.join("; "),
          r.lastObservedAt ? new Date(r.lastObservedAt).toISOString() : "",
        ]
          .map(escapeCsvField)
          .join(","),
      );

      const csv = [csvHeaders.map(escapeCsvField).join(","), ...csvRows].join(
        "\n",
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=revisit-list.csv",
      );
      return res.send(csv);
    }

    // JSON format
    res.json({
      success: true,
      data: results,
      total: results.length,
      limit,
      metadata: {
        filters: options,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting revisit list", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = { getEnrichmentGaps, getRevisitList };
