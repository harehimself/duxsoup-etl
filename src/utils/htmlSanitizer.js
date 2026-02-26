/**
 * HTML Sanitizer
 *
 * Strips HTML tags and decodes common HTML entities from text fields.
 * Used on summary and role description fields which may contain HTML
 * artifacts from LinkedIn scraping via DuxSoup.
 *
 * Follows the same normalizer pattern as twitterNormalizer, phoneNormalizer, etc.
 */

const logger = require("./logger");

/**
 * Common HTML entity map for decoding.
 */
const HTML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&#39;": "'",
  "&quot;": '"',
};

const ENTITY_PATTERN = /&amp;|&lt;|&gt;|&nbsp;|&#39;|&quot;/gi;

/**
 * Strip HTML tags and decode common entities from a string value.
 *
 * @param {*} value - Raw value from webhook
 * @returns {string|null} Cleaned string or null
 */
function stripHtmlTags(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;

  if (value === "") return null;

  const original = value;

  // Strip HTML tags
  let cleaned = value.replace(/<[^>]*>/g, "");

  // Decode common HTML entities
  cleaned = cleaned.replace(
    ENTITY_PATTERN,
    (match) => HTML_ENTITIES[match.toLowerCase()],
  );

  // If empty after stripping, return null
  if (cleaned.trim() === "") return null;

  // Log when HTML was actually stripped
  if (cleaned !== original) {
    logger.debug("Stripped HTML from text field", {
      originalLength: original.length,
      cleanedLength: cleaned.length,
    });
  }

  return cleaned;
}

module.exports = { stripHtmlTags };
