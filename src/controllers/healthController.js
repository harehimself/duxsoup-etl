const Person = require('../models/person');
const Visit = require('../models/visit');
const Scan = require('../models/scan');
const DeadLetter = require('../models/deadLetter');
const logger = require('../utils/logger');
const { getConfig } = require('../utils/env');
const personReadService = require('../services/personReadService');

/**
 * Health Controller - Ops monitoring endpoints
 *
 * Provides metrics for cutover gate decisions and operational health.
 */

/**
 * GET /health/ingestion
 * Monitors webhook → people pipeline health
 */
async function getIngestionHealth(req, res) {
  try {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);

    // Count dead letters
    const [deadLettersPending, deadLettersFailed, totalObservations24h] = await Promise.all([
      DeadLetter.countDocuments({ status: 'pending' }),
      DeadLetter.countDocuments({ status: 'failed_again' }),
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
    const peopleUpsertSuccesses24h = peopleUpsertAttempts24h - peopleUpsertFailures24h;

    const successRate =
      peopleUpsertAttempts24h > 0
        ? (peopleUpsertSuccesses24h / peopleUpsertAttempts24h) * 100
        : 100;

    const health = {
      status: successRate >= 95 ? 'healthy' : successRate >= 90 ? 'degraded' : 'unhealthy',
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
      health.alerts.push({
        level: successRate < 90 ? 'critical' : 'warning',
        message: `People upsert success rate below threshold: ${successRate.toFixed(2)}%`,
      });
    }

    if (deadLettersPending > 100) {
      health.alerts.push({
        level: 'warning',
        message: `High number of pending dead letters: ${deadLettersPending}`,
      });
    }

    if (deadLettersFailed > 10) {
      health.alerts.push({
        level: 'critical',
        message: `Dead letters failing to replay: ${deadLettersFailed}`,
      });
    }

    res.json(health);
  } catch (error) {
    logger.error('Failed to get ingestion health', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: 'error',
      error: 'Failed to compute ingestion health',
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
    // Count distinct people in observations using union strategy
    const [visitProfiles, scanProfiles, totalPeopleCount] = await Promise.all([
      Visit.distinct('Profile'),
      Scan.distinct('Profile'),
      Person.countDocuments(),
    ]);

    // Calculate true union of distinct people (no double-counting)
    const allProfiles = new Set([...visitProfiles, ...scanProfiles]);
    const estimatedLegacyPeople = allProfiles.size;

    const visitPeopleCount = visitProfiles.length;
    const scanPeopleCount = scanProfiles.length;

    // Coverage ratio (how many people we've successfully created)
    const coverageRatio =
      estimatedLegacyPeople > 0 ? totalPeopleCount / estimatedLegacyPeople : 0;

    const health = {
      status: coverageRatio >= 0.98 ? 'ready' : coverageRatio >= 0.90 ? 'building' : 'incomplete',
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
    const deadLettersPending = await DeadLetter.countDocuments({ status: 'pending' });
    health.cutover_gates.dead_letters_near_zero = deadLettersPending < 10;

    // Determine if ready for cutover
    const readyForCutover =
      health.cutover_gates.coverage_ratio_ge_98 &&
      health.cutover_gates.dead_letters_near_zero;

    health.ready_for_cutover = readyForCutover;

    if (!readyForCutover) {
      health.blockers = [];
      if (!health.cutover_gates.coverage_ratio_ge_98) {
        health.blockers.push(
          `Coverage ratio ${(coverageRatio * 100).toFixed(2)}% below 98% threshold`
        );
      }
      if (!health.cutover_gates.dead_letters_near_zero) {
        health.blockers.push(`${deadLettersPending} pending dead letters (threshold: < 10)`);
      }
    }

    res.json(health);
  } catch (error) {
    logger.error('Failed to get parity health', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: 'error',
      error: 'Failed to compute parity health',
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
    const totalPeople = await Person.countDocuments();

    // Count by primary identity source (what _id format they use)
    const salesNavPeople = await Person.countDocuments({
      _id: { $regex: /^ACwAAA/ }
    });

    const numericPeople = await Person.countDocuments({
      _id: { $regex: /^\d{8,}$/ }
    });

    const urlFallbackPeople = totalPeople - salesNavPeople - numericPeople;

    // Count "url-fallback-only" people (no stable ID aliases)
    // These are people who have NO salesNavId or numericId aliases
    const urlFallbackOnlyPeople = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ }, // URL format _id
      $and: [
        { 'aliases.type': { $nin: ['salesNavId', 'numericId'] } }
      ]
    });

    // Also count people who DO have stable IDs in aliases but not as primary
    const upgradablePeople = await Person.countDocuments({
      _id: { $regex: /^linkedin\.com/ }, // URL format _id
      'aliases.type': { $in: ['salesNavId', 'numericId'] }
    });

    const breakdown = {
      total_people: totalPeople,
      by_identity_source: {
        sales_nav_id: salesNavPeople,
        member_numeric_id: numericPeople,
        public_url_fallback: urlFallbackPeople,
      },
      percentages: {
        sales_nav_id: Math.round((salesNavPeople / totalPeople) * 100 * 100) / 100,
        member_numeric_id: Math.round((numericPeople / totalPeople) * 100 * 100) / 100,
        public_url_fallback: Math.round((urlFallbackPeople / totalPeople) * 100 * 100) / 100,
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
      breakdown.recommendations.push({
        action: 'run_linking_job',
        message: `${upgradablePeople} people have stable IDs in aliases but URL as primary. Run linking job to upgrade them.`,
        impact: `Could reduce URL-fallback count by ${upgradablePeople}`,
      });
    }

    if (urlFallbackOnlyPeople - upgradablePeople > 0) {
      breakdown.recommendations.push({
        action: 'investigate_observations',
        message: `${urlFallbackOnlyPeople - upgradablePeople} people are stuck with only URL identity. Check their observations for missing ID fields.`,
        impact: 'May require webhook payload fixes or manual data enrichment',
      });
    }

    res.json(breakdown);
  } catch (error) {
    logger.error('Failed to get coverage breakdown', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to compute coverage breakdown',
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
    const [ingestionHealth, parityHealth] = await Promise.all([
      // Inline ingestion metrics
      (async () => {
        const now = new Date();
        const last24h = new Date(now - 24 * 60 * 60 * 1000);

        const [deadLettersPending, totalObs] = await Promise.all([
          DeadLetter.countDocuments({ status: 'pending' }),
          Promise.all([
            Visit.countDocuments({ createdAt: { $gte: last24h } }),
            Scan.countDocuments({ createdAt: { $gte: last24h } }),
          ]).then(([v, s]) => v + s),
        ]);

        const deadLettersCreated = await DeadLetter.countDocuments({
          createdAt: { $gte: last24h },
        });

        const successRate =
          totalObs > 0 ? ((totalObs - deadLettersCreated) / totalObs) * 100 : 100;

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

    // Get read metrics (cutover monitoring)
    const config = getConfig();
    const readMetrics = personReadService.getMetrics();

    res.json({
      read_source: config.readSource,
      ingestion: ingestionHealth,
      parity: parityHealth,
      reads: {
        people_read_success_rate_24h: readMetrics.people_read_success_rate,
        people_read_not_found_rate_24h: readMetrics.people_read_not_found_rate,
        legacy_fallback_hit_rate_24h: readMetrics.legacy_fallback_hit_rate,
        legacy_fallback_hits_24h: readMetrics.legacy_fallback_hits,
        people_read_attempts: readMetrics.people_read_attempts,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get metrics', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to compute metrics',
      message: error.message,
    });
  }
}

module.exports = {
  getIngestionHealth,
  getParityHealth,
  getMetrics,
  getCoverageBreakdown,
};
