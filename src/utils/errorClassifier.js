/**
 * Error Classifier
 *
 * Classifies dead letter errors as permanent (non-retryable) or transient
 * (worth retrying). Used by dead letter creation, replay, and maintenance scripts.
 *
 * Permanent errors: validation failures, cast errors, duplicate keys — these
 * will never succeed on retry regardless of how many attempts.
 *
 * Transient errors: timeouts, connection resets, temporary unavailability —
 * these may succeed on a later retry.
 */

const PERMANENT_ERROR_PATTERNS = [
  /Cast to string failed/i,
  /ValidationError/i,
  /Cast to \[?ObjectId\]? failed/i,
  /CastError/i,
  /invalid _id/i,
  /Document failed validation/i,
  /E11000 duplicate key/i,
];

/**
 * Classify whether an error message represents a permanent or transient failure.
 *
 * @param {string} errorMessage - The error message to classify
 * @returns {'permanent'|'transient'} The error classification
 */
function classifyError(errorMessage) {
  if (!errorMessage) return "transient";
  return PERMANENT_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))
    ? "permanent"
    : "transient";
}

/**
 * Check if an error message represents a permanent (non-retryable) failure.
 *
 * @param {string} errorMessage - The error message to check
 * @returns {boolean} True if the error is permanent
 */
function isPermanentError(errorMessage) {
  return classifyError(errorMessage) === "permanent";
}

module.exports = { classifyError, isPermanentError, PERMANENT_ERROR_PATTERNS };
