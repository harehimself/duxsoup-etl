/**
 * Warning Collector
 *
 * Per-request collector for structured warnings that surface data quality
 * issues in webhook API responses without blocking processing.
 *
 * Usage:
 *   const { createCollector } = require('./warningCollector');
 *   const collector = createCollector();
 *   collector.add('ROLES_AT_CAPACITY', 'Role dropped: roles array at capacity', { field: 'roles', details: { max: 50 } });
 *   // ... later
 *   response.warnings = collector.getAll();
 */

const WARNING_CODES = {
  // Schema validation
  SCHEMA_TYPE_VIOLATION: "SCHEMA_TYPE_VIOLATION",
  SCHEMA_UNKNOWN_FIELD: "SCHEMA_UNKNOWN_FIELD",

  // Identity
  NO_STABLE_ID: "NO_STABLE_ID",

  // Field validation
  INVALID_EMAIL_FORMAT: "INVALID_EMAIL_FORMAT",
  INVALID_CONNECTIONS: "INVALID_CONNECTIONS",
  INVALID_DEGREE: "INVALID_DEGREE",
  INVERTED_DATE_RANGE: "INVERTED_DATE_RANGE",

  // Capacity limits
  ROLES_AT_CAPACITY: "ROLES_AT_CAPACITY",
  EDUCATION_AT_CAPACITY: "EDUCATION_AT_CAPACITY",
  SKILLS_AT_CAPACITY: "SKILLS_AT_CAPACITY",

  // Phase 2 failures
  COMPANY_UPSERT_FAILED: "COMPANY_UPSERT_FAILED",
  LOCATION_UPSERT_FAILED: "LOCATION_UPSERT_FAILED",
  PERSON_UPSERT_FAILED: "PERSON_UPSERT_FAILED",

  // Debounce
  DEBOUNCED: "DEBOUNCED",
};

/**
 * Create a new per-request warning collector.
 *
 * @returns {{ add: Function, getAll: Function, hasWarnings: Function, codes: Object }}
 */
function createCollector() {
  const warnings = [];

  return {
    /**
     * Add a warning to the collector.
     *
     * @param {string} code - Programmatic warning code (use WARNING_CODES)
     * @param {string} message - Human-readable description
     * @param {Object} [opts] - Optional context
     * @param {string} [opts.field] - Snapshot field affected
     * @param {Object} [opts.details] - Additional contextual data
     */
    add(code, message, opts) {
      const warning = { code, message };
      if (opts?.field) warning.field = opts.field;
      if (opts?.details) warning.details = opts.details;
      warnings.push(warning);
    },

    /**
     * Get all collected warnings.
     * @returns {Array<{code: string, message: string, field?: string, details?: Object}>}
     */
    getAll() {
      return warnings;
    },

    /**
     * Check whether any warnings have been collected.
     * @returns {boolean}
     */
    hasWarnings() {
      return warnings.length > 0;
    },

    /** Reference to WARNING_CODES for convenience. */
    codes: WARNING_CODES,
  };
}

module.exports = { WARNING_CODES, createCollector };
