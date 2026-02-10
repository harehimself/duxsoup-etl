/**
 * In-memory alert deduplication store.
 *
 * Tracks a SHA-256 hash of each alert's stable content and suppresses
 * duplicates within a configurable time window. Same pattern as
 * metricsCache.js — plain Map with TTL, no external dependencies.
 */

const crypto = require("crypto");
const { ALERT_DEDUP_WINDOW_MS } = require("../constants/limits");

const store = new Map();

/**
 * Compute a stable hash for a health report.
 *
 * Hash input = status + sorted criticalIssues messages + sorted warning messages.
 * This means:
 *  - Same issues in different order  -> same hash (deduplicated)
 *  - Same issues with different metric values -> same hash (deduplicated)
 *  - Different issues or different severity -> different hash (not deduplicated)
 *  - Escalation from warning to critical -> different hash (sends new alert)
 *
 * @param {Object} report - Health report
 * @returns {string} Hex-encoded SHA-256 hash
 */
function computeHash(report) {
  const { status, criticalIssues = [], warnings = [] } = report;

  const criticalMessages = criticalIssues
    .map((i) => i.message)
    .sort()
    .join("|");
  const warningMessages = warnings
    .map((w) => w.message)
    .sort()
    .join("|");

  const input = `${status}::${criticalMessages}::${warningMessages}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Check whether an alert with this hash was already sent within the
 * suppression window.
 *
 * Also lazily evicts expired entries.
 *
 * @param {string} hash - Alert content hash
 * @returns {boolean} True if duplicate (should suppress)
 */
function isDuplicate(hash) {
  const entry = store.get(hash);
  if (!entry) return false;

  if (Date.now() - entry.recordedAt > ALERT_DEDUP_WINDOW_MS) {
    store.delete(hash);
    return false;
  }

  return true;
}

/**
 * Record that an alert with this hash was sent.
 *
 * @param {string} hash - Alert content hash
 */
function record(hash) {
  store.set(hash, { recordedAt: Date.now() });
}

/**
 * Debugging helper — returns current dedup store state.
 *
 * @returns {{ count: number }}
 */
function getStats() {
  return { count: store.size };
}

/**
 * Testing helper — clear all stored hashes.
 */
function _reset() {
  store.clear();
}

module.exports = { computeHash, isDuplicate, record, getStats, _reset };
