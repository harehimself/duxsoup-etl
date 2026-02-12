/**
 * URL Normalizer
 *
 * Ensures URL fields use HTTPS protocol. DuxSoup webhooks sometimes deliver
 * company website URLs with http:// protocol; this utility normalizes them.
 */

/**
 * Ensure a URL uses HTTPS protocol.
 * Converts http:// to https://, trims whitespace, and passes through
 * all other values unchanged (including null, undefined, non-strings).
 *
 * @param {*} value - URL string to normalize
 * @returns {*} Normalized URL with https://, or original value if not applicable
 */
function ensureHttps(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("http://")) {
    return "https://" + trimmed.slice(7);
  }
  return trimmed;
}

module.exports = { ensureHttps };
