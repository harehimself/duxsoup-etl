/**
 * Twitter Handle Normalizer
 *
 * Normalizes Twitter handles to bare lowercase usernames.
 * Handles: "@handle", "handle", "https://twitter.com/handle", "https://x.com/handle"
 *
 * Follows the same warn-only pattern as normalizeEmail() and normalizePhone().
 */

const logger = require("./logger");

/**
 * Normalize a Twitter handle to a bare lowercase username.
 *
 * @param {*} value - Raw Twitter value from webhook
 * @returns {string|null} Normalized handle or null
 */
function normalizeTwitter(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;

  let handle = value.trim();
  if (handle === "") return null;

  // Extract username from URL (twitter.com or x.com)
  const urlMatch = handle.match(
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([^/?#]+)/i,
  );
  if (urlMatch) {
    handle = urlMatch[1];
  }

  // Strip leading @
  if (handle.startsWith("@")) {
    handle = handle.slice(1);
  }

  // Lowercase
  handle = handle.toLowerCase();

  if (handle === "") return null;

  // Validate: Twitter handles are 1-15 chars, alphanumeric + underscore
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    logger.warn("Twitter handle fails format validation", { twitter: handle });
  }

  return handle;
}

module.exports = { normalizeTwitter };
