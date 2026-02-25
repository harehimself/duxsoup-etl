/**
 * URL Validator
 *
 * Validates that URL fields have an http:// or https:// scheme.
 * Non-URL strings are rejected with a warning and stored as null.
 */

const logger = require("./logger");
const { ensureHttps } = require("./urlNormalizer");

/**
 * Validate that a value is a URL with http:// or https:// scheme.
 * Returns the trimmed URL if valid, null otherwise.
 *
 * - Null/undefined/empty/non-string → returns null (no warning)
 * - Valid http:// or https:// URL → returns trimmed value
 * - Invalid (bare domain, ftp://, plain text) → logs warning, returns null
 *
 * @param {*} value - Raw value from webhook
 * @param {string} fieldName - Field name for warning context
 * @returns {string|null} Validated URL or null
 */
function validateUrl(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  logger.warn("Invalid URL format", { field: fieldName, value: trimmed });
  return null;
}

/**
 * Validate a URL and then ensure it uses HTTPS.
 * Composes validateUrl() with ensureHttps() from urlNormalizer.
 *
 * @param {*} value - Raw value from webhook
 * @param {string} fieldName - Field name for warning context
 * @returns {string|null} Validated HTTPS URL or null
 */
function validateAndEnsureHttps(value, fieldName) {
  const validated = validateUrl(value, fieldName);
  if (validated === null) return null;
  return ensureHttps(validated);
}

module.exports = { validateUrl, validateAndEnsureHttps };
