/**
 * Sales Navigator ID Extraction Utility
 *
 * Robust extraction of salesNavId from LinkedIn URLs with:
 * - Case-insensitive matching
 * - Trailing parameter removal
 * - Support for all LinkedIn URL formats
 *
 * Handles URLs from:
 * - salesUrl (sales/people/ and sales/lead/ formats)
 * - recruiterUrl (talent/profile/ format)
 * - profileUrl (various formats)
 * - publicUrl (in/ format with salesNavId)
 */

/**
 * Extract Sales Navigator ID from any LinkedIn URL
 *
 * Pattern: ACwAAA or ACoAAA followed by alphanumeric chars, hyphens, underscores
 * Case-insensitive to handle lowercase IDs in URLs
 * Strips trailing parameters (,name,o7fk or ,NAME_SEARCH,Z1JY)
 *
 * @param {string} url - LinkedIn URL (salesUrl, recruiterUrl, profileUrl, etc.)
 * @returns {string|null} - Extracted salesNavId or null
 *
 * @example
 * extractSalesNavIdFromUrl('www.linkedin.com/sales/people/acoaaa0cm4mbva7a,name,o7fk')
 * // Returns: 'acoaaa0cm4mbva7a'
 *
 * extractSalesNavIdFromUrl('https://www.linkedin.com/sales/lead/ACwAAA0CM4MB,NAME_SEARCH,Z1JY')
 * // Returns: 'ACwAAA0CM4MB'
 *
 * extractSalesNavIdFromUrl('www.linkedin.com/talent/profile/acwaaa123')
 * // Returns: 'acwaaa123'
 */
function extractSalesNavIdFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Pattern: A(Cw|Co)AAA followed by base64-like characters
  // /i flag makes it case-insensitive (matches ACwAAA, acwaaa, AcWaAa, etc.)
  const salesNavPattern = /A(Cw|Co)AAA[A-Za-z0-9_-]+/i;

  // Extract the ID using regex
  const match = url.match(salesNavPattern);
  if (!match) {
    return null;
  }

  // Clean the extracted ID
  let salesNavId = match[0];

  // Remove trailing parameters (everything after comma)
  // Example: "ACwAAA123,name,o7fk" -> "ACwAAA123"
  salesNavId = salesNavId.split(',')[0];

  // Remove query parameters (everything after ?)
  // Example: "ACwAAA123?param=value" -> "ACwAAA123"
  salesNavId = salesNavId.split('?')[0];

  // Trim whitespace
  salesNavId = salesNavId.trim();

  return salesNavId;
}

/**
 * Extract Sales Navigator ID from webhook/observation data
 *
 * Checks multiple fields in priority order:
 * 1. SalesProfile (direct Sales Nav URL)
 * 2. Profile (may contain Sales Nav ID)
 * 3. PublicProfile (may contain Sales Nav ID)
 * 4. RecruiterProfile (Recruiter URLs)
 * 5. salesUrl (from your real data examples)
 * 6. recruiterUrl (from your real data examples)
 * 7. profileUrl (from your real data examples)
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - Extracted salesNavId or null
 */
function extractSalesNavId(data) {
  if (!data) {
    return null;
  }

  // List of fields to check (in priority order)
  const urlFields = [
    // Standard DuxSoup webhook fields
    'SalesProfile',
    'Profile',
    'PublicProfile',
    'RecruiterProfile',

    // Additional URL fields from your real data
    'salesUrl',
    'recruiterUrl',
    'profileUrl',

    // Nested data fields (webhooks often nest in data.*)
    'data.SalesProfile',
    'data.Profile',
    'data.PublicProfile',
    'data.RecruiterProfile',
    'data.salesUrl',
    'data.recruiterUrl',
    'data.profileUrl',
  ];

  // Try each field until we find a salesNavId
  for (const field of urlFields) {
    // Handle nested fields (data.Profile)
    const fieldParts = field.split('.');
    let value = data;

    for (const part of fieldParts) {
      value = value?.[part];
      if (!value) break;
    }

    if (value && typeof value === 'string') {
      const salesNavId = extractSalesNavIdFromUrl(value);
      if (salesNavId) {
        return salesNavId;
      }
    }
  }

  return null;
}

/**
 * Normalize Sales Navigator ID to canonical case format
 *
 * LinkedIn's canonical format uses mixed case: ACwAAA or ACoAAA
 * URLs may contain lowercase versions: acwaaa or acoaaa
 *
 * This function normalizes to the canonical format for consistency.
 *
 * @param {string} salesNavId - Sales Navigator ID (any case)
 * @returns {string} - Normalized to canonical case (ACwAAA/ACoAAA prefix)
 *
 * @example
 * normalizeToCanonicalCase('acwaaa0cm4mb123')
 * // Returns: 'ACwAAA0cm4mb123'
 *
 * normalizeToCanonicalCase('ACoAAA123xyz')
 * // Returns: 'ACoAAA123xyz'
 */
function normalizeToCanonicalCase(salesNavId) {
  if (!salesNavId || typeof salesNavId !== 'string') {
    return salesNavId;
  }

  // Check if it starts with ACwAAA (case-insensitive)
  if (salesNavId.toLowerCase().startsWith('acwaaa')) {
    // Normalize to ACwAAA + rest of ID
    return 'ACwAAA' + salesNavId.substring(6);
  }

  // Check if it starts with ACoAAA (case-insensitive)
  if (salesNavId.toLowerCase().startsWith('acoaaa')) {
    // Normalize to ACoAAA + rest of ID
    return 'ACoAAA' + salesNavId.substring(6);
  }

  // Already in canonical format or unknown format
  return salesNavId;
}

/**
 * Extract numeric ID from duxsoupId
 *
 * DuxSoup IDs come in two formats:
 * - Numeric: "id.218248067"
 * - Username: "pid.kayleighhogan"
 *
 * This extracts the numeric portion when available.
 *
 * @param {string} duxsoupId - DuxSoup ID
 * @returns {string|null} - Numeric ID or null
 *
 * @example
 * extractNumericId('id.218248067')
 * // Returns: '218248067'
 *
 * extractNumericId('pid.kayleighhogan')
 * // Returns: null (not numeric)
 */
function extractNumericId(duxsoupId) {
  if (!duxsoupId || typeof duxsoupId !== 'string') {
    return null;
  }

  // Match patterns: "id.218248067" or plain "218248067"
  const numericPattern = /(?:id\.)?(\d{8,})/;
  const match = duxsoupId.match(numericPattern);

  return match ? match[1] : null;
}

module.exports = {
  extractSalesNavIdFromUrl,
  extractSalesNavId,
  normalizeToCanonicalCase,
  extractNumericId,
};
