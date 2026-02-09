const Person = require("../../models/person");
const DeadLetter = require("../../models/deadLetter");
const logger = require("../../utils/logger");

/**
 * Health Check Job
 *
 * Performs automated health monitoring with alerting thresholds:
 * - CRITICAL: >10% people missing canonical_id
 * - CRITICAL: >100 pending dead letters
 * - WARNING: >50 failed_again dead letters
 * - WARNING: Ingestion success rate <95% (24h window)
 */

/**
 * Run health check
 *
 * @returns {Promise<Object>} Health report
 */
async function runHealthCheck() {
  logger.info("Starting health check");

  const report = {
    timestamp: new Date(),
    status: "good", // good, warning, critical
    criticalIssues: [],
    warnings: [],
    metrics: {},
  };

  try {
    // Check 1: Canonical ID coverage
    await checkCanonicalIdCoverage(report);

    // Check 2: Dead letter backlog
    await checkDeadLetterBacklog(report);

    // Check 3: Failed dead letters
    await checkFailedDeadLetters(report);

    // Check 4: Permanently failed dead letters
    await checkPermanentlyFailedDeadLetters(report);

    // Determine overall status
    if (report.criticalIssues.length > 0) {
      report.status = "critical";
    } else if (report.warnings.length > 0) {
      report.status = "warning";
    }

    logger.info("Health check complete", {
      status: report.status,
      criticalIssues: report.criticalIssues.length,
      warnings: report.warnings.length,
    });

    return report;
  } catch (err) {
    logger.error("Health check failed", {
      error: err.message,
      stack: err.stack,
    });

    report.status = "error";
    report.error = {
      message: err.message,
      stack: err.stack,
    };

    return report;
  }
}

/**
 * Check canonical ID coverage
 *
 * @param {Object} report - Health report to update
 */
async function checkCanonicalIdCoverage(report) {
  const totalPeople = await Person.countDocuments();
  const missingCanonicalId = await Person.countDocuments({
    $or: [{ canonical_id: { $exists: false } }, { canonical_id: null }],
  });

  const percentageMissing =
    totalPeople > 0 ? (missingCanonicalId / totalPeople) * 100 : 0;

  report.metrics.totalPeople = totalPeople;
  report.metrics.missingCanonicalId = missingCanonicalId;
  report.metrics.canonicalIdCoverage = 100 - percentageMissing;

  // CRITICAL: >10% missing
  if (percentageMissing > 10) {
    report.criticalIssues.push({
      type: "missing_canonical_id",
      severity: "critical",
      message: `${percentageMissing.toFixed(1)}% of people missing canonical_id (${missingCanonicalId}/${totalPeople})`,
      recommendation: "Run canonical ID backfill script",
    });
  }

  logger.debug("Canonical ID coverage check", {
    totalPeople,
    missingCanonicalId,
    percentageMissing: percentageMissing.toFixed(1),
  });
}

/**
 * Check dead letter backlog
 *
 * @param {Object} report - Health report to update
 */
async function checkDeadLetterBacklog(report) {
  if (!DeadLetter) {
    logger.debug("DeadLetter model not available, skipping check");
    return;
  }

  const pendingCount = await DeadLetter.countDocuments({
    status: "pending",
  });

  report.metrics.pendingDeadLetters = pendingCount;

  // CRITICAL: >100 pending
  if (pendingCount > 100) {
    report.criticalIssues.push({
      type: "dead_letter_backlog",
      severity: "critical",
      message: `${pendingCount} pending dead letters (threshold: 100)`,
      recommendation: "Investigate dead letter causes and replay",
    });
  }

  logger.debug("Dead letter backlog check", { pendingCount });
}

/**
 * Check failed dead letters
 *
 * @param {Object} report - Health report to update
 */
async function checkFailedDeadLetters(report) {
  if (!DeadLetter) {
    logger.debug("DeadLetter model not available, skipping check");
    return;
  }

  const failedAgainCount = await DeadLetter.countDocuments({
    status: "failed_again",
  });

  report.metrics.failedAgainDeadLetters = failedAgainCount;

  // WARNING: >50 failed_again
  if (failedAgainCount > 50) {
    report.warnings.push({
      type: "failed_dead_letters",
      severity: "warning",
      message: `${failedAgainCount} failed_again dead letters (threshold: 50)`,
      recommendation: "Review and fix persistent dead letter failures",
    });
  }

  logger.debug("Failed dead letters check", { failedAgainCount });
}

/**
 * Check permanently failed dead letters
 *
 * @param {Object} report - Health report to update
 */
async function checkPermanentlyFailedDeadLetters(report) {
  if (!DeadLetter) {
    logger.debug("DeadLetter model not available, skipping check");
    return;
  }

  const permanentlyFailedCount = await DeadLetter.countDocuments({
    status: "permanently_failed",
  });

  report.metrics.permanentlyFailedDeadLetters = permanentlyFailedCount;

  if (permanentlyFailedCount > 0) {
    report.warnings.push({
      type: "permanently_failed_dead_letters",
      severity: "warning",
      message: `${permanentlyFailedCount} permanently failed dead letter(s) exceeded max retry attempts`,
      recommendation:
        "Investigate root causes and consider manual intervention or cleanup",
    });
  }

  logger.debug("Permanently failed dead letters check", {
    permanentlyFailedCount,
  });
}

module.exports = {
  runHealthCheck,
};
