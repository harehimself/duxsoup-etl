const Person = require("../models/person");
const Visit = require("../models/visit");
const Scan = require("../models/scan");
const DeadLetter = require("../models/deadLetter");
const logger = require("../utils/logger");
const metricsCache = require("../utils/metricsCache");
/**
 * Health Controller - Ops monitoring endpoints
 *
 * Provides metrics for operational health.
 */

/**
 * GET /health/ingestion
 * Monitors webhook → people pipeline health
 */
async function getIngestionHealth(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const health = await metricsCache.getOrFetch(
      "ingestion",
      async () => {
        const now = new Date();
        const last24h = new Date(now - 24 * 60 * 60 * 1000);

        // Count dead letters
        const [deadLettersPending, deadLettersFailed, totalObservations24h] =
          await Promise.all([
            DeadLetter.countDocuments({ status: "pending" }),
            DeadLetter.countDocuments({ status: "failed_again" }),
            Promise.all([
              Visit.countDocuments({ createdAt: { $gte: last24h } }),
              Scan.countDocuments({ createdAt: { $gte: last24h } }),
            ]).then(([visits, scans]) => visits + scans),
          ]);

        // Calculate success rate
        const deadLettersCreated24h = await DeadLetter.countDocuments({
          createdAt: { $gte: last24h },
        });

        const peopleUpsertAttempts24h = totalObservations24h;
        const peopleUpsertFailures24h = deadLettersCreated24h;
        const peopleUpsertSuccesses24h =
          peopleUpsertAttempts24h - peopleUpsertFailures24h;

        const successRate =
          peopleUpsertAttempts24h > 0
            ? (peopleUpsertSuccesses24h / peopleUpsertAttempts24h) * 100
            : 100;

        const result = {
          status:
            successRate >= 95
              ? "healthy"
              : successRate >= 90
                ? "degraded"
                : "unhealthy",
          metrics: {
            people_upsert_success_rate_24h: Math.round(successRate * 100) / 100,
            total_observations_24h: totalObservations24h,
            people_upsert_successes_24h: peopleUpsertSuccesses24h,
            people_upsert_failures_24h: peopleUpsertFailures24h,
            dead_letters_pending: deadLettersPending,
            dead_letters_failed_again: deadLettersFailed,
          },
          alerts: [],
        };

        // Generate alerts
        if (successRate < 95) {
          result.alerts.push({
            level: successRate < 90 ? "critical" : "warning",
            message: `People upsert success rate below threshold: ${successRate.toFixed(2)}%`,
          });
        }

        if (deadLettersPending > 100) {
          result.alerts.push({
            level: "warning",
            message: `High number of pending dead letters: ${deadLettersPending}`,
          });
        }

        if (deadLettersFailed > 10) {
          result.alerts.push({
            level: "critical",
            message: `Dead letters failing to replay: ${deadLettersFailed}`,
          });
        }

        return result;
      },
      fresh ? 0 : undefined,
    );

    res.json(health);
  } catch (error) {
    logger.error("Failed to get ingestion health", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      error: "Failed to compute ingestion health",
      message: error.message,
    });
  }
}

/**
 * GET /health/parity
 * Monitors coverage between legacy (visits/scans) and new (people)
 */
async function getParityHealth(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const health = await metricsCache.getOrFetch(
      "parity",
      async () => {
        // Count distinct people in observations using union strategy
        const [visitProfiles, scanProfiles, totalPeopleCount] =
          await Promise.all([
            Visit.distinct("Profile"),
            Scan.distinct("Profile"),
            Person.countDocuments(),
          ]);

        // Calculate true union of distinct people (no double-counting)
        const allProfiles = new Set([...visitProfiles, ...scanProfiles]);
        const estimatedLegacyPeople = allProfiles.size;

        const visitPeopleCount = visitProfiles.length;
        const scanPeopleCount = scanProfiles.length;

        // Coverage ratio (how many people we've successfully created)
        const coverageRatio =
          estimatedLegacyPeople > 0
            ? totalPeopleCount / estimatedLegacyPeople
            : 0;

        const result = {
          status:
            coverageRatio >= 0.98
              ? "ready"
              : coverageRatio >= 0.9
                ? "building"
                : "incomplete",
          metrics: {
            people_count: totalPeopleCount,
            distinct_people_in_visits: visitPeopleCount,
            distinct_people_in_scans: scanPeopleCount,
            estimated_legacy_people: estimatedLegacyPeople,
            coverage_ratio: Math.round(coverageRatio * 10000) / 10000,
            coverage_percent: Math.round(coverageRatio * 100 * 100) / 100,
          },
          cutover_gates: {
            coverage_ratio_ge_98: coverageRatio >= 0.98,
            dead_letters_near_zero: null, // Will be filled below
          },
        };

        // Check dead letters status
        const deadLettersPending = await DeadLetter.countDocuments({
          status: "pending",
        });
        result.cutover_gates.dead_letters_near_zero = deadLettersPending < 10;

        // Determine if ready for cutover
        const readyForCutover =
          result.cutover_gates.coverage_ratio_ge_98 &&
          result.cutover_gates.dead_letters_near_zero;

        result.ready_for_cutover = readyForCutover;

        if (!readyForCutover) {
          result.blockers = [];
          if (!result.cutover_gates.coverage_ratio_ge_98) {
            result.blockers.push(
              `Coverage ratio ${(coverageRatio * 100).toFixed(2)}% below 98% threshold`,
            );
          }
          if (!result.cutover_gates.dead_letters_near_zero) {
            result.blockers.push(
              `${deadLettersPending} pending dead letters (threshold: < 10)`,
            );
          }
        }

        return result;
      },
      fresh ? 0 : undefined,
    );

    res.json(health);
  } catch (error) {
    logger.error("Failed to get parity health", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      error: "Failed to compute parity health",
      message: error.message,
    });
  }
}

/**
 * GET /health/coverage-breakdown
 * Breakdown of people by identity source to identify coverage gaps
 */
async function getCoverageBreakdown(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const breakdown = await metricsCache.getOrFetch(
      "coverage-breakdown",
      async () => {
        const totalPeople = await Person.countDocuments();

        // Count by primary identity source (what _id format they use)
        const salesNavPeople = await Person.countDocuments({
          _id: { $regex: /^AC[ow]AA/ },
        });

        const numericPeople = await Person.countDocuments({
          _id: { $regex: /^\d{8,}$/ },
        });

        const urlFallbackPeople = totalPeople - salesNavPeople - numericPeople;

        // Count "url-fallback-only" people (no stable ID aliases)
        // These are people who have NO salesNavId or numericId aliases
        const urlFallbackOnlyPeople = await Person.countDocuments({
          _id: { $regex: /^linkedin\.com/ }, // URL format _id
          $and: [{ "aliases.type": { $nin: ["salesNavId", "numericId"] } }],
        });

        // Also count people who DO have stable IDs in aliases but not as primary
        const upgradablePeople = await Person.countDocuments({
          _id: { $regex: /^linkedin\.com/ }, // URL format _id
          "aliases.type": { $in: ["salesNavId", "numericId"] },
        });

        const result = {
          total_people: totalPeople,
          by_identity_source: {
            sales_nav_id: salesNavPeople,
            member_numeric_id: numericPeople,
            public_url_fallback: urlFallbackPeople,
          },
          percentages: {
            sales_nav_id:
              Math.round((salesNavPeople / totalPeople) * 100 * 100) / 100,
            member_numeric_id:
              Math.round((numericPeople / totalPeople) * 100 * 100) / 100,
            public_url_fallback:
              Math.round((urlFallbackPeople / totalPeople) * 100 * 100) / 100,
          },
          url_fallback_analysis: {
            url_fallback_only: urlFallbackOnlyPeople,
            upgradable_to_stable_id: upgradablePeople,
            stuck_on_url: urlFallbackOnlyPeople - upgradablePeople,
          },
          recommendations: [],
        };

        // Generate recommendations
        if (upgradablePeople > 0) {
          result.recommendations.push({
            action: "run_linking_job",
            message: `${upgradablePeople} people have stable IDs in aliases but URL as primary. Run linking job to upgrade them.`,
            impact: `Could reduce URL-fallback count by ${upgradablePeople}`,
          });
        }

        if (urlFallbackOnlyPeople - upgradablePeople > 0) {
          result.recommendations.push({
            action: "investigate_observations",
            message: `${urlFallbackOnlyPeople - upgradablePeople} people are stuck with only URL identity. Check their observations for missing ID fields.`,
            impact:
              "May require webhook payload fixes or manual data enrichment",
          });
        }

        return result;
      },
      fresh ? 0 : undefined,
    );

    res.json(breakdown);
  } catch (error) {
    logger.error("Failed to get coverage breakdown", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to compute coverage breakdown",
      message: error.message,
    });
  }
}

/**
 * GET /health/canonical-coverage
 * Coverage of canonical_id across people
 */
async function getCanonicalCoverage(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "canonical-coverage",
      async () => {
        const [totalPeople, missingCanonical] = await Promise.all([
          Person.countDocuments(),
          Person.countDocuments({
            $or: [
              { canonical_id: { $exists: false } },
              { canonical_id: null },
              { canonical_id: "" },
            ],
          }),
        ]);

        const covered = totalPeople - missingCanonical;
        const coverageRatio = totalPeople > 0 ? covered / totalPeople : 1;

        return {
          total_people: totalPeople,
          canonical_id_present: covered,
          canonical_id_missing: missingCanonical,
          coverage_ratio: Math.round(coverageRatio * 10000) / 10000,
          coverage_percent: Math.round(coverageRatio * 100 * 100) / 100,
        };
      },
      fresh ? 0 : undefined,
    );

    res.json(data);
  } catch (error) {
    logger.error("Failed to get canonical coverage", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to compute canonical coverage",
      message: error.message,
    });
  }
}

/**
 * GET /health/company-coverage
 * Coverage of canonical_id across companies
 */
async function getCompanyCoverage(req, res) {
  const Company = require("../models/company");
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "company-coverage",
      async () => {
        const [totalCompanies, missingCanonical] = await Promise.all([
          Company.countDocuments(),
          Company.countDocuments({
            $or: [
              { canonical_id: { $exists: false } },
              { canonical_id: null },
              { canonical_id: "" },
            ],
          }),
        ]);

        const covered = totalCompanies - missingCanonical;
        const coverageRatio = totalCompanies > 0 ? covered / totalCompanies : 1;

        return {
          total_companies: totalCompanies,
          canonical_id_present: covered,
          canonical_id_missing: missingCanonical,
          coverage_ratio: Math.round(coverageRatio * 10000) / 10000,
          coverage_percent: Math.round(coverageRatio * 100 * 100) / 100,
        };
      },
      fresh ? 0 : undefined,
    );

    res.json(data);
  } catch (error) {
    logger.error("Failed to get company coverage", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to compute company coverage",
      message: error.message,
    });
  }
}

/**
 * GET /health/location-coverage
 * Coverage of canonical_id across locations
 */
async function getLocationCoverage(req, res) {
  const Location = require("../models/location");
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "location-coverage",
      async () => {
        const [totalLocations, missingCanonical] = await Promise.all([
          Location.countDocuments(),
          Location.countDocuments({
            $or: [
              { canonical_id: { $exists: false } },
              { canonical_id: null },
              { canonical_id: "" },
            ],
          }),
        ]);

        const covered = totalLocations - missingCanonical;
        const coverageRatio = totalLocations > 0 ? covered / totalLocations : 1;

        return {
          total_locations: totalLocations,
          canonical_id_present: covered,
          canonical_id_missing: missingCanonical,
          coverage_ratio: Math.round(coverageRatio * 10000) / 10000,
          coverage_percent: Math.round(coverageRatio * 100 * 100) / 100,
        };
      },
      fresh ? 0 : undefined,
    );

    res.json(data);
  } catch (error) {
    logger.error("Failed to get location coverage", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to compute location coverage",
      message: error.message,
    });
  }
}

/**
 * GET /health/metrics
 * Combined health metrics for dashboards
 */
async function getMetrics(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "metrics",
      async () => {
        const [ingestionHealth, parityHealth] = await Promise.all([
          // Inline ingestion metrics
          (async () => {
            const now = new Date();
            const last24h = new Date(now - 24 * 60 * 60 * 1000);

            const [deadLettersPending, totalObs] = await Promise.all([
              DeadLetter.countDocuments({ status: "pending" }),
              Promise.all([
                Visit.countDocuments({ createdAt: { $gte: last24h } }),
                Scan.countDocuments({ createdAt: { $gte: last24h } }),
              ]).then(([v, s]) => v + s),
            ]);

            const deadLettersCreated = await DeadLetter.countDocuments({
              createdAt: { $gte: last24h },
            });

            const successRate =
              totalObs > 0
                ? ((totalObs - deadLettersCreated) / totalObs) * 100
                : 100;

            return {
              success_rate_24h: Math.round(successRate * 100) / 100,
              dead_letters_pending: deadLettersPending,
            };
          })(),

          // Inline parity metrics
          (async () => {
            const peopleCount = await Person.countDocuments();
            return { people_count: peopleCount };
          })(),
        ]);

        return {
          ingestion: ingestionHealth,
          parity: parityHealth,
          timestamp: new Date().toISOString(),
        };
      },
      fresh ? 0 : undefined,
    );

    res.json(data);
  } catch (error) {
    logger.error("Failed to get metrics", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to compute metrics",
      message: error.message,
    });
  }
}

/**
 * GET /health/data-quality
 * Data completeness and quality metrics
 */
async function getDataQuality(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const quality = await metricsCache.getOrFetch(
      "data-quality",
      async () => {
        const totalPeople = await Person.countDocuments();

        // Count people missing key fields
        const [
          missingTitle,
          missingCompany,
          missingLocation,
          missingEmail,
          missingConnections,
        ] = await Promise.all([
          Person.countDocuments({
            $or: [
              { "snapshot.currentTitle": { $exists: false } },
              { "snapshot.currentTitle": null },
              { "snapshot.currentTitle": "" },
            ],
          }),
          Person.countDocuments({
            $or: [
              { "snapshot.currentCompany": { $exists: false } },
              { "snapshot.currentCompany": null },
              { "snapshot.currentCompany": "" },
            ],
          }),
          Person.countDocuments({
            $or: [
              { "snapshot.location": { $exists: false } },
              { "snapshot.location": null },
              { "snapshot.location": "" },
            ],
          }),
          Person.countDocuments({
            $or: [
              { "snapshot.email": { $exists: false } },
              { "snapshot.email": null },
              { "snapshot.email": "" },
            ],
          }),
          Person.countDocuments({
            $or: [
              { "snapshot.connections": { $exists: false } },
              { "snapshot.connections": null },
            ],
          }),
        ]);

        const pct = (missing) =>
          totalPeople > 0
            ? Math.round(((totalPeople - missing) / totalPeople) * 100 * 100) /
              100
            : 0;

        return {
          totalPeople,
          fields: {
            currentTitle: {
              present: totalPeople - missingTitle,
              missing: missingTitle,
              coverage: pct(missingTitle),
            },
            currentCompany: {
              present: totalPeople - missingCompany,
              missing: missingCompany,
              coverage: pct(missingCompany),
            },
            location: {
              present: totalPeople - missingLocation,
              missing: missingLocation,
              coverage: pct(missingLocation),
            },
            email: {
              present: totalPeople - missingEmail,
              missing: missingEmail,
              coverage: pct(missingEmail),
            },
            connections: {
              present: totalPeople - missingConnections,
              missing: missingConnections,
              coverage: pct(missingConnections),
            },
          },
          overallCompleteness:
            totalPeople > 0
              ? Math.round(
                  ((5 * totalPeople -
                    missingTitle -
                    missingCompany -
                    missingLocation -
                    missingEmail -
                    missingConnections) /
                    (5 * totalPeople)) *
                    100 *
                    100,
                ) / 100
              : 0,
          timestamp: new Date().toISOString(),
        };
      },
      fresh ? 0 : undefined,
    );

    res.json({ success: true, data: quality });
  } catch (error) {
    logger.error("Failed to get data quality", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to compute data quality",
      message: error.message,
    });
  }
}

/**
 * GET /health/dashboard
 * Consolidated dashboard with key metrics from all health endpoints
 */
async function getDashboard(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const dashboard = await metricsCache.getOrFetch(
      "dashboard",
      async () => {
        const now = new Date();
        const last24h = new Date(now - 24 * 60 * 60 * 1000);
        const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const Change = require("../models/change");
        const Company = require("../models/company");

        const [
          totalPeople,
          totalCompanies,
          totalVisits,
          totalScans,
          visits24h,
          scans24h,
          deadLettersPending,
          deadLettersFailed,
          changesLast7d,
          recentChanges,
        ] = await Promise.all([
          Person.countDocuments(),
          Company.countDocuments(),
          Visit.countDocuments(),
          Scan.countDocuments(),
          Visit.countDocuments({ createdAt: { $gte: last24h } }),
          Scan.countDocuments({ createdAt: { $gte: last24h } }),
          DeadLetter.countDocuments({ status: "pending" }),
          DeadLetter.countDocuments({ status: "failed_again" }),
          Change.countDocuments({ timestamp: { $gte: last7d } }),
          Change.find().sort({ timestamp: -1 }).limit(5).lean(),
        ]);

        const deadLettersCreated24h = await DeadLetter.countDocuments({
          createdAt: { $gte: last24h },
        });
        const totalObs24h = visits24h + scans24h;
        const successRate =
          totalObs24h > 0
            ? ((totalObs24h - deadLettersCreated24h) / totalObs24h) * 100
            : 100;

        return {
          summary: {
            totalPeople,
            totalCompanies,
            totalObservations: totalVisits + totalScans,
            observations24h: totalObs24h,
          },
          ingestion: {
            successRate24h: Math.round(successRate * 100) / 100,
            visits24h,
            scans24h,
            deadLettersPending,
            deadLettersFailed,
            status:
              successRate >= 95
                ? "healthy"
                : successRate >= 90
                  ? "degraded"
                  : "unhealthy",
          },
          changes: {
            last7Days: changesLast7d,
            recent: recentChanges,
          },
          timestamp: now.toISOString(),
        };
      },
      fresh ? 0 : undefined,
    );

    res.json({ success: true, data: dashboard });
  } catch (error) {
    logger.error("Failed to get dashboard", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to compute dashboard",
      message: error.message,
    });
  }
}

/**
 * GET /health/quality
 * Structural data quality dashboard — identity resolution, alias coverage,
 * enrichment depth, and freshness buckets.
 */
async function getDataQualityDashboard(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "quality-dashboard",
      async () => {
        const now = new Date();
        const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const d90 = new Date(now - 90 * 24 * 60 * 60 * 1000);

        const notMerged = { mergedInto: { $exists: false } };

        const [identityResult, aliasResult, enrichmentResult, freshnessResult] =
          await Promise.all([
            // Pipeline A — Identity counts
            Person.aggregate([
              { $match: notMerged },
              {
                $project: {
                  hasSalesNavId: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: { $ifNull: ["$aliases", []] },
                            cond: { $eq: ["$$this.type", "salesNavId"] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  hasNumericId: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: { $ifNull: ["$aliases", []] },
                            cond: { $eq: ["$$this.type", "numericId"] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  hasCanonicalId: {
                    $cond: [{ $ifNull: ["$canonical_id", false] }, true, false],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  withSalesNavId: {
                    $sum: { $cond: ["$hasSalesNavId", 1, 0] },
                  },
                  withNumericId: {
                    $sum: { $cond: ["$hasNumericId", 1, 0] },
                  },
                  withStableId: {
                    $sum: {
                      $cond: [
                        { $or: ["$hasSalesNavId", "$hasNumericId"] },
                        1,
                        0,
                      ],
                    },
                  },
                  withCanonicalId: {
                    $sum: { $cond: ["$hasCanonicalId", 1, 0] },
                  },
                },
              },
            ]),

            // Pipeline B — Alias type distribution
            Person.aggregate([
              { $match: notMerged },
              { $unwind: "$aliases" },
              { $group: { _id: "$aliases.type", count: { $sum: 1 } } },
            ]),

            // Pipeline C — Enrichment coverage
            Person.aggregate([
              { $match: notMerged },
              {
                $project: {
                  hasRoles: {
                    $and: [
                      { $isArray: "$snapshot.roles" },
                      { $gt: [{ $size: "$snapshot.roles" }, 0] },
                    ],
                  },
                  hasEducation: {
                    $and: [
                      { $isArray: "$snapshot.education" },
                      { $gt: [{ $size: "$snapshot.education" }, 0] },
                    ],
                  },
                  hasSkills: {
                    $and: [
                      { $isArray: "$snapshot.skills" },
                      { $gt: [{ $size: "$snapshot.skills" }, 0] },
                    ],
                  },
                  hasEmail: {
                    $and: [
                      { $ne: ["$snapshot.email", null] },
                      { $ne: ["$snapshot.email", ""] },
                    ],
                  },
                  hasPhone: {
                    $and: [
                      { $ne: ["$snapshot.phone", null] },
                      { $ne: ["$snapshot.phone", ""] },
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  withRoles: { $sum: { $cond: ["$hasRoles", 1, 0] } },
                  withEducation: {
                    $sum: { $cond: ["$hasEducation", 1, 0] },
                  },
                  withSkills: { $sum: { $cond: ["$hasSkills", 1, 0] } },
                  withEmail: { $sum: { $cond: ["$hasEmail", 1, 0] } },
                  withPhone: { $sum: { $cond: ["$hasPhone", 1, 0] } },
                },
              },
            ]),

            // Pipeline D — Freshness buckets
            Person.aggregate([
              { $match: notMerged },
              {
                $project: {
                  last7d: { $gte: ["$meta.lastObservedAt", d7] },
                  last30d: { $gte: ["$meta.lastObservedAt", d30] },
                  stale90d: { $lt: ["$meta.lastObservedAt", d90] },
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  updatedLast7d: { $sum: { $cond: ["$last7d", 1, 0] } },
                  updatedLast30d: { $sum: { $cond: ["$last30d", 1, 0] } },
                  stale90d: { $sum: { $cond: ["$stale90d", 1, 0] } },
                },
              },
            ]),
          ]);

        const id = identityResult[0] || {
          total: 0,
          withSalesNavId: 0,
          withNumericId: 0,
          withStableId: 0,
          withCanonicalId: 0,
        };
        const en = enrichmentResult[0] || {
          total: 0,
          withRoles: 0,
          withEducation: 0,
          withSkills: 0,
          withEmail: 0,
          withPhone: 0,
        };
        const fr = freshnessResult[0] || {
          total: 0,
          updatedLast7d: 0,
          updatedLast30d: 0,
          stale90d: 0,
        };

        const totalPeople = id.total;
        const pct = (count) =>
          totalPeople > 0
            ? Math.round((count / totalPeople) * 100 * 10) / 10
            : 0;

        // Build alias map from aggregation result
        const aliasMap = {};
        for (const row of aliasResult) {
          aliasMap[row._id] = row.count;
        }

        return {
          totalPeople,
          identity: {
            withSalesNavId: {
              count: id.withSalesNavId,
              percent: pct(id.withSalesNavId),
            },
            withNumericId: {
              count: id.withNumericId,
              percent: pct(id.withNumericId),
            },
            withStableId: {
              count: id.withStableId,
              percent: pct(id.withStableId),
            },
            withoutStableId: {
              count: totalPeople - id.withStableId,
              percent: pct(totalPeople - id.withStableId),
            },
            withCanonicalId: {
              count: id.withCanonicalId,
              percent: pct(id.withCanonicalId),
            },
            withoutCanonicalId: {
              count: totalPeople - id.withCanonicalId,
              percent: pct(totalPeople - id.withCanonicalId),
            },
          },
          aliases: {
            salesNavId: aliasMap.salesNavId || 0,
            numericId: aliasMap.numericId || 0,
            duxsoupId: aliasMap.duxsoupId || 0,
            linkedInUsername: aliasMap.linkedInUsername || 0,
            vanityName: aliasMap.vanityName || 0,
            publicUrl: aliasMap.publicUrl || 0,
            salesUrl: aliasMap.salesUrl || 0,
            recruiterUrl: aliasMap.recruiterUrl || 0,
          },
          enrichment: {
            withRoles: { count: en.withRoles, percent: pct(en.withRoles) },
            withoutRoles: {
              count: totalPeople - en.withRoles,
              percent: pct(totalPeople - en.withRoles),
            },
            withEducation: {
              count: en.withEducation,
              percent: pct(en.withEducation),
            },
            withSkills: { count: en.withSkills, percent: pct(en.withSkills) },
            withEmail: { count: en.withEmail, percent: pct(en.withEmail) },
            withPhone: { count: en.withPhone, percent: pct(en.withPhone) },
          },
          freshness: {
            updatedLast7d: {
              count: fr.updatedLast7d,
              percent: pct(fr.updatedLast7d),
            },
            updatedLast30d: {
              count: fr.updatedLast30d,
              percent: pct(fr.updatedLast30d),
            },
            stale90d: { count: fr.stale90d, percent: pct(fr.stale90d) },
          },
          timestamp: now.toISOString(),
        };
      },
      fresh ? 0 : undefined,
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to get data quality dashboard", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to compute data quality dashboard",
      message: error.message,
    });
  }
}

/**
 * GET /health/test-notifications
 * Test notification configuration (email + SMS)
 */
async function testNotifications(req, res) {
  try {
    const notificationService = require("../services/notificationService");
    const results = await notificationService.testNotifications();

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.error("Failed to test notifications", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to test notifications",
      message: error.message,
    });
  }
}

/**
 * GET /health/throughput
 * Real-time webhook throughput metrics (1m, 5m, 15m, 1h windows)
 */
async function getThroughput(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "throughput",
      async () => {
        const throughputTracker = require("../utils/throughputTracker");
        return throughputTracker.getStats();
      },
      fresh ? 0 : 30000, // 30s TTL for near-real-time data
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to get throughput metrics", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to compute throughput metrics",
      message: error.message,
    });
  }
}

/**
 * GET /health/data-cleanliness
 * Field-level data cleanliness metrics: whitespace issues, invalid emails,
 * duplicate skills, duplicate education entries, and missing key fields.
 */
async function getDataCleanliness(req, res) {
  try {
    const fresh = req.query.fresh === "true";
    const data = await metricsCache.getOrFetch(
      "data-cleanliness",
      async () => {
        const notMerged = { mergedInto: { $exists: false } };

        const [
          totalPeople,
          whitespaceSample,
          emailResults,
          skillResults,
          educationResults,
          missingFieldResults,
          phoneResults,
        ] = await Promise.all([
          Person.countDocuments(notMerged),

          // Whitespace issues: sample 1000 records, check 5 key fields
          Person.aggregate([
            { $match: notMerged },
            { $sample: { size: 1000 } },
            {
              $project: {
                hasIssue: {
                  $or: [
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$snapshot.firstName", ""] },
                        regex: /^\s|\s$|\s{2,}/,
                      },
                    },
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$snapshot.lastName", ""] },
                        regex: /^\s|\s$|\s{2,}/,
                      },
                    },
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$snapshot.currentTitle", ""] },
                        regex: /^\s|\s$|\s{2,}/,
                      },
                    },
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$snapshot.currentCompany", ""] },
                        regex: /^\s|\s$|\s{2,}/,
                      },
                    },
                    {
                      $regexMatch: {
                        input: { $ifNull: ["$snapshot.location", ""] },
                        regex: /^\s|\s$|\s{2,}/,
                      },
                    },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                sampled: { $sum: 1 },
                withIssues: { $sum: { $cond: ["$hasIssue", 1, 0] } },
              },
            },
          ]),

          // Invalid emails: full scan of records with email
          Person.aggregate([
            {
              $match: {
                ...notMerged,
                "snapshot.email": { $nin: [null, ""] },
              },
            },
            {
              $project: {
                isInvalid: {
                  $not: {
                    $regexMatch: {
                      input: "$snapshot.email",
                      regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                invalid: { $sum: { $cond: ["$isInvalid", 1, 0] } },
              },
            },
          ]),

          // Skill duplicates: compare skills.length vs Set(skills.map(toLower)).size
          Person.aggregate([
            {
              $match: {
                ...notMerged,
                "snapshot.skills": { $exists: true, $ne: [] },
              },
            },
            {
              $project: {
                totalSkills: { $size: "$snapshot.skills" },
                uniqueSkills: {
                  $size: {
                    $setUnion: [
                      {
                        $map: {
                          input: "$snapshot.skills",
                          as: "s",
                          in: { $toLower: "$$s" },
                        },
                      },
                      [],
                    ],
                  },
                },
              },
            },
            {
              $project: {
                hasDupes: { $gt: ["$totalSkills", "$uniqueSkills"] },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                withDuplicates: { $sum: { $cond: ["$hasDupes", 1, 0] } },
              },
            },
          ]),

          // Education duplicates: compare education length vs set of toLower(school|degree|field)
          Person.aggregate([
            {
              $match: {
                ...notMerged,
                "snapshot.education": { $exists: true, $ne: [] },
              },
            },
            {
              $project: {
                totalEdu: { $size: "$snapshot.education" },
                uniqueEdu: {
                  $size: {
                    $setUnion: [
                      {
                        $map: {
                          input: "$snapshot.education",
                          as: "e",
                          in: {
                            $concat: [
                              {
                                $toLower: {
                                  $ifNull: ["$$e.school", ""],
                                },
                              },
                              "|",
                              {
                                $toLower: {
                                  $ifNull: ["$$e.degree", ""],
                                },
                              },
                              "|",
                              {
                                $toLower: {
                                  $ifNull: ["$$e.field", ""],
                                },
                              },
                            ],
                          },
                        },
                      },
                      [],
                    ],
                  },
                },
              },
            },
            {
              $project: {
                hasDupes: { $gt: ["$totalEdu", "$uniqueEdu"] },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                withDuplicates: { $sum: { $cond: ["$hasDupes", 1, 0] } },
              },
            },
          ]),

          // Missing key fields: count null/empty for email, phone, currentTitle
          Person.aggregate([
            { $match: notMerged },
            {
              $project: {
                missingEmail: {
                  $or: [
                    { $eq: ["$snapshot.email", null] },
                    { $eq: ["$snapshot.email", ""] },
                    {
                      $eq: [{ $type: "$snapshot.email" }, "missing"],
                    },
                  ],
                },
                missingPhone: {
                  $or: [
                    { $eq: ["$snapshot.phone", null] },
                    { $eq: ["$snapshot.phone", ""] },
                    {
                      $eq: [{ $type: "$snapshot.phone" }, "missing"],
                    },
                  ],
                },
                missingTitle: {
                  $or: [
                    { $eq: ["$snapshot.currentTitle", null] },
                    { $eq: ["$snapshot.currentTitle", ""] },
                    {
                      $eq: [{ $type: "$snapshot.currentTitle" }, "missing"],
                    },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                missingEmail: {
                  $sum: { $cond: ["$missingEmail", 1, 0] },
                },
                missingPhone: {
                  $sum: { $cond: ["$missingPhone", 1, 0] },
                },
                missingTitle: {
                  $sum: { $cond: ["$missingTitle", 1, 0] },
                },
              },
            },
          ]),

          // Phone format: count non-E.164 phones (not matching ^\+\d+$)
          Person.aggregate([
            {
              $match: {
                ...notMerged,
                "snapshot.phone": { $nin: [null, ""] },
              },
            },
            {
              $project: {
                notE164: {
                  $not: {
                    $regexMatch: {
                      input: "$snapshot.phone",
                      regex: /^\+\d+$/,
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                notE164: { $sum: { $cond: ["$notE164", 1, 0] } },
              },
            },
          ]),
        ]);

        const ws = whitespaceSample[0] || { sampled: 0, withIssues: 0 };
        const em = emailResults[0] || { total: 0, invalid: 0 };
        const sk = skillResults[0] || { total: 0, withDuplicates: 0 };
        const ed = educationResults[0] || { total: 0, withDuplicates: 0 };
        const mf = missingFieldResults[0] || {
          total: 0,
          missingEmail: 0,
          missingPhone: 0,
          missingTitle: 0,
        };
        const ph = phoneResults[0] || { total: 0, notE164: 0 };

        const pct = (count, total) =>
          total > 0 ? Math.round((count / total) * 100 * 100) / 100 : 0;

        return {
          totalPeople,
          whitespace: {
            sampled: ws.sampled,
            withIssues: ws.withIssues,
            percentage: pct(ws.withIssues, ws.sampled),
          },
          email: {
            totalWithEmail: em.total,
            invalid: em.invalid,
            percentage: pct(em.invalid, em.total),
          },
          skills: {
            totalWithSkills: sk.total,
            withDuplicates: sk.withDuplicates,
            percentage: pct(sk.withDuplicates, sk.total),
          },
          education: {
            totalWithEducation: ed.total,
            withDuplicates: ed.withDuplicates,
            percentage: pct(ed.withDuplicates, ed.total),
          },
          phone: {
            totalWithPhone: ph.total,
            notE164Format: ph.notE164,
            percentage: pct(ph.notE164, ph.total),
          },
          missingFields: {
            total: mf.total,
            missingEmail: {
              count: mf.missingEmail,
              percentage: pct(mf.missingEmail, mf.total),
            },
            missingPhone: {
              count: mf.missingPhone,
              percentage: pct(mf.missingPhone, mf.total),
            },
            missingTitle: {
              count: mf.missingTitle,
              percentage: pct(mf.missingTitle, mf.total),
            },
          },
          timestamp: new Date().toISOString(),
        };
      },
      fresh ? 0 : 600000, // 10-minute TTL
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error("Failed to get data cleanliness metrics", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Failed to compute data cleanliness metrics",
      message: error.message,
    });
  }
}

module.exports = {
  getIngestionHealth,
  getParityHealth,
  getMetrics,
  getCoverageBreakdown,
  getCanonicalCoverage,
  getCompanyCoverage,
  getLocationCoverage,
  getDataQuality,
  getDataQualityDashboard,
  getDashboard,
  testNotifications,
  getThroughput,
  getDataCleanliness,
};
