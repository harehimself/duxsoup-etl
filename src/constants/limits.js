/**
 * Array size limits for Person snapshot fields.
 *
 * Caps prevent unbounded growth from deduplication edge cases
 * or exceptionally long career histories. When a cap is hit,
 * the entry is dropped and a warning is logged.
 */

const MAX_ROLES = parseInt(process.env.MAX_PERSON_ROLES || "50", 10);
const MAX_EDUCATION = parseInt(process.env.MAX_PERSON_EDUCATION || "20", 10);
const MAX_SKILLS = parseInt(process.env.MAX_PERSON_SKILLS || "100", 10);
const DEBOUNCE_WINDOW_MS = parseInt(
  process.env.DEBOUNCE_WINDOW_MS || "30000",
  10,
);

const MERGE_OBS_RATIO_THRESHOLD = parseInt(
  process.env.MERGE_OBS_RATIO_THRESHOLD || "10",
  10,
);

const ALERT_DEDUP_WINDOW_MS = parseInt(
  process.env.ALERT_DEDUP_WINDOW_MS || String(6 * 60 * 60 * 1000),
  10,
);

const MAX_RETRY_ATTEMPTS = parseInt(
  process.env.MAX_DEAD_LETTER_RETRIES || "10",
  10,
);
const BACKOFF_CAP_MINUTES = parseInt(
  process.env.DEAD_LETTER_BACKOFF_CAP_MINUTES || "720",
  10,
);

const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || "50", 10);

const MAX_DEBOUNCE_CACHE_SIZE = parseInt(
  process.env.MAX_DEBOUNCE_CACHE_SIZE || "10000",
  10,
);

const MAX_METRICS_CACHE_SIZE = parseInt(
  process.env.MAX_METRICS_CACHE_SIZE || "100",
  10,
);

module.exports = {
  MAX_ROLES,
  MAX_EDUCATION,
  MAX_SKILLS,
  DEBOUNCE_WINDOW_MS,
  MERGE_OBS_RATIO_THRESHOLD,
  ALERT_DEDUP_WINDOW_MS,
  MAX_RETRY_ATTEMPTS,
  BACKOFF_CAP_MINUTES,
  MAX_BATCH_SIZE,
  MAX_DEBOUNCE_CACHE_SIZE,
  MAX_METRICS_CACHE_SIZE,
};
