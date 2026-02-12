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

const DATA_FRESHNESS_THRESHOLD_HOURS = parseInt(
  process.env.DATA_FRESHNESS_THRESHOLD_HOURS || "6",
  10,
);

const SIGNAL_DEFAULT_DAYS = parseInt(
  process.env.SIGNAL_DEFAULT_DAYS || "30",
  10,
);
const SIGNAL_MAX_DAYS = parseInt(process.env.SIGNAL_MAX_DAYS || "180", 10);
const SIGNAL_DEFAULT_LIMIT = parseInt(
  process.env.SIGNAL_DEFAULT_LIMIT || "50",
  10,
);
const SIGNAL_MAX_LIMIT = parseInt(process.env.SIGNAL_MAX_LIMIT || "500", 10);
const SIGNAL_CACHE_TTL_MS = parseInt(
  process.env.SIGNAL_CACHE_TTL_MS || String(5 * 60 * 1000),
  10,
);
const SIGNAL_NEW_DM_MIN_RANK = parseInt(
  process.env.SIGNAL_NEW_DM_MIN_RANK || "5",
  10,
);

const MAX_OBSERVATION_REFS = parseInt(
  process.env.MAX_OBSERVATION_REFS || "200",
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
  DATA_FRESHNESS_THRESHOLD_HOURS,
  SIGNAL_DEFAULT_DAYS,
  SIGNAL_MAX_DAYS,
  SIGNAL_DEFAULT_LIMIT,
  SIGNAL_MAX_LIMIT,
  SIGNAL_CACHE_TTL_MS,
  SIGNAL_NEW_DM_MIN_RANK,
  MAX_OBSERVATION_REFS,
};
