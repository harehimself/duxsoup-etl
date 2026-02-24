/**
 * Company Name Normalizer
 *
 * Trims, collapses whitespace, and strips trailing legal suffixes from
 * company names to produce a canonical stored value.
 *
 * Follows the same single-value pattern as normalizeEmail() and normalizePhone()
 * — the transform produces the stored value (no dual display/canonical).
 *
 * Examples:
 *   "  Microsoft  Corporation " -> "Microsoft"
 *   "Acme, Inc."               -> "Acme"
 *   "J.P. Morgan & Co."        -> "J.P. Morgan"
 *   "Deloitte"                 -> "Deloitte" (no suffix, unchanged)
 *   null / ""                  -> null
 */

/**
 * Legal suffixes to strip, ordered longest-first to avoid partial matches.
 * Each suffix must be preceded by a comma or whitespace in the company name.
 *
 * Escaped for use inside a RegExp character group:
 *   - Dots are literal (escaped with \.)
 *   - Pipe separates alternatives
 */
const LEGAL_SUFFIXES = [
  // Long-form English
  "Limited Liability Company",
  "Limited Partnership",
  "Corporation",
  "Incorporated",
  "Limited",
  // Abbreviated English
  "L\\.L\\.C\\.",
  "LLC",
  "Corp\\.",
  "Inc\\.",
  "L\\.P\\.",
  "Ltd\\.",
  "Co\\.",
  "LP",
  // UK / International
  "P\\.L\\.C\\.",
  "PLC",
  // German
  "GmbH",
  "AG",
  // French / Spanish / Latin
  "S\\.A\\.",
  "SA",
  "S\\.r\\.l\\.",
  "SRL",
  // Dutch
  "B\\.V\\.",
  "BV",
  "N\\.V\\.",
  "NV",
  // Australian / Indian
  "Pty\\.",
  "Pvt\\.",
];

/**
 * Precompiled regex: match an optional comma/whitespace separator followed by
 * one legal suffix at the end of the string (case-insensitive).
 *
 * The (?:^|[,\s]+) alternation handles both suffix-only input ("Inc." → null)
 * and normal company names ("Acme Inc." → "Acme").
 *
 * The [,\s]+ branch ensures we never strip substrings embedded in real
 * words (e.g., "Incredible" won't lose "Inc", "Cooper" won't lose "Co.").
 */
const SUFFIX_REGEX = new RegExp(
  `(?:^|[,\\s]+)(?:${LEGAL_SUFFIXES.join("|")})\\.?\\s*$`,
  "i",
);

/**
 * Cleanup regex: strip trailing ampersand left behind after suffix removal
 * (e.g., "J.P. Morgan &" → "J.P. Morgan" after "& Co." strips "Co.").
 */
const TRAILING_AMP_REGEX = /\s*&\s*$/;

/**
 * Normalize a company name for canonical storage.
 *
 * @param {*} value - Raw company name from webhook
 * @returns {string|null} Normalized name or null
 */
function normalizeCompanyName(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;

  // Trim + collapse whitespace (superset of cleanString)
  let name = value.trim().replace(/\s+/g, " ");
  if (name === "") return null;

  // Strip one trailing legal suffix
  name = name.replace(SUFFIX_REGEX, "").trim();

  // Clean up trailing ampersand left by "& Co." patterns
  name = name.replace(TRAILING_AMP_REGEX, "").trim();

  return name === "" ? null : name;
}

module.exports = { normalizeCompanyName };
