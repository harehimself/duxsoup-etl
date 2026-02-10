/**
 * Throughput Tracker
 *
 * Circular buffer of per-second counters for real-time webhook
 * throughput metrics. O(1) per record, ~300KB memory for 1h window.
 */

const BUFFER_SIZE = 3600; // 1 hour of per-second buckets

/**
 * Each bucket tracks counts for a single second.
 */
function emptyBucket() {
  return {
    total: 0,
    success: 0,
    failure: 0,
    debounced: 0,
    duplicate: 0,
    phase2Failure: 0,
    byType: {},
    latencySum: 0,
    latencyCount: 0,
  };
}

const buckets = new Array(BUFFER_SIZE);
const bucketTimestamps = new Array(BUFFER_SIZE);

// Initialize all buckets
for (let i = 0; i < BUFFER_SIZE; i++) {
  buckets[i] = emptyBucket();
  bucketTimestamps[i] = 0;
}

/**
 * Get the bucket index for a given timestamp.
 */
function indexForTime(ts) {
  return Math.floor(ts / 1000) % BUFFER_SIZE;
}

/**
 * Get or create a fresh bucket for the current second.
 * If the bucket is from a different second, reset it.
 */
function getCurrentBucket() {
  const now = Date.now();
  const idx = indexForTime(now);
  const currentSecond = Math.floor(now / 1000);

  if (bucketTimestamps[idx] !== currentSecond) {
    buckets[idx] = emptyBucket();
    bucketTimestamps[idx] = currentSecond;
  }

  return buckets[idx];
}

/**
 * Record a webhook processing event.
 *
 * @param {Object} event
 * @param {String} event.type - 'visit' or 'scan'
 * @param {Boolean} event.success - Whether the webhook succeeded
 * @param {Boolean} [event.debounced=false] - Was Phase 2 debounced
 * @param {Boolean} [event.duplicate=false] - Was this a duplicate event
 * @param {Boolean} [event.phase2Failure=false] - Did Phase 2 fail
 * @param {Number} [event.latencyMs] - Processing latency in milliseconds
 */
function record(event) {
  const bucket = getCurrentBucket();

  bucket.total++;
  if (event.success) {
    bucket.success++;
  } else {
    bucket.failure++;
  }
  if (event.debounced) bucket.debounced++;
  if (event.duplicate) bucket.duplicate++;
  if (event.phase2Failure) bucket.phase2Failure++;

  if (event.type) {
    bucket.byType[event.type] = (bucket.byType[event.type] || 0) + 1;
  }

  if (typeof event.latencyMs === "number") {
    bucket.latencySum += event.latencyMs;
    bucket.latencyCount++;
  }
}

/**
 * Aggregate stats from buckets within a given time window.
 *
 * @param {Number} windowSeconds - How many seconds back to aggregate
 * @returns {Object} Aggregated stats
 */
function aggregateWindow(windowSeconds) {
  const now = Date.now();
  const currentSecond = Math.floor(now / 1000);
  const cutoff = currentSecond - windowSeconds;

  const agg = {
    total: 0,
    success: 0,
    failure: 0,
    debounced: 0,
    duplicate: 0,
    phase2Failure: 0,
    byType: {},
    latencySum: 0,
    latencyCount: 0,
  };

  for (let s = cutoff + 1; s <= currentSecond; s++) {
    const idx = ((s % BUFFER_SIZE) + BUFFER_SIZE) % BUFFER_SIZE;
    if (bucketTimestamps[idx] !== s) continue; // stale or empty bucket

    const b = buckets[idx];
    agg.total += b.total;
    agg.success += b.success;
    agg.failure += b.failure;
    agg.debounced += b.debounced;
    agg.duplicate += b.duplicate;
    agg.phase2Failure += b.phase2Failure;
    agg.latencySum += b.latencySum;
    agg.latencyCount += b.latencyCount;

    for (const [type, count] of Object.entries(b.byType)) {
      agg.byType[type] = (agg.byType[type] || 0) + count;
    }
  }

  return agg;
}

/**
 * Get throughput statistics for multiple time windows.
 *
 * @returns {Object} Stats for 1m, 5m, 15m, and 1h windows
 */
function getStats() {
  const windows = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
  };

  const result = {};

  for (const [label, seconds] of Object.entries(windows)) {
    const agg = aggregateWindow(seconds);

    result[label] = {
      total: agg.total,
      success: agg.success,
      failure: agg.failure,
      debounced: agg.debounced,
      duplicate: agg.duplicate,
      phase2Failure: agg.phase2Failure,
      byType: agg.byType,
      rate: {
        perMinute:
          seconds > 0
            ? Math.round((agg.total / (seconds / 60)) * 100) / 100
            : 0,
        successRate:
          agg.total > 0
            ? Math.round((agg.success / agg.total) * 100 * 100) / 100
            : 100,
      },
      avgLatencyMs:
        agg.latencyCount > 0
          ? Math.round(agg.latencySum / agg.latencyCount)
          : 0,
    };
  }

  result.timestamp = new Date().toISOString();
  return result;
}

/**
 * Reset all counters. Used for testing.
 */
function reset() {
  for (let i = 0; i < BUFFER_SIZE; i++) {
    buckets[i] = emptyBucket();
    bucketTimestamps[i] = 0;
  }
}

module.exports = { record, getStats, reset };
