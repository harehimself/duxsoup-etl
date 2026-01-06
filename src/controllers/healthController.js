const Person = require('../models/person');
const Visit = require('../models/visit');
const Scan = require('../models/scan');
const DeadLetter = require('../models/deadLetter');
const logger = require('../utils/logger');

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
    // Count distinct people in observations
    const [visitPeopleCount, scanPeopleCount, totalPeopleCount] = await Promise.all([
      Visit.distinct('Profile').then(profiles => profiles.length),
      Scan.distinct('Profile').then(profiles => profiles.length),
      Person.countDocuments(),
    ]);

    // Estimate distinct people in legacy system (union of visits + scans)
    // This is approximate - exact count would require $setUnion aggregation
    const estimatedLegacyPeople = visitPeopleCount + scanPeopleCount;

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

    res.json({
      ingestion: ingestionHealth,
      parity: parityHealth,
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
};
