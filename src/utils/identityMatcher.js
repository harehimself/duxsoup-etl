/**
 * Centralized Identity Matching Utility
 *
 * Provides consistent waterfall identity resolution across all collections
 * (Scans, Visits, People, etc.)
 *
 * Priority Order:
 * 1. LinkedIn Username (stable across Sales Nav + Regular LinkedIn)
 * 2. Sales Navigator ID (ACwAAA/ACoAAA)
 * 3. Normalized Profile URL
 * 4. Public Profile / Recruiter Profile
 * 5. DuxSoup ID (changes between scan sources - least stable)
 *
 * Usage:
 *   const { extractIdentifiers, getPrimaryIdentifier } = require('./utils/identityMatcher');
 *
 *   const identifiers = extractIdentifiers(webhookData);
 *   const primary = getPrimaryIdentifier(identifiers);
 *   // primary = { type: 'linkedInUsername', value: 'bret-lamb-1424546' }
 */

const crypto = require("crypto");

/**
 * Extract LinkedIn username from various sources
 *
 * IMPORTANT: Excludes Sales Navigator IDs (ACwAAA/ACoAAA patterns)
 * These should be handled by extractSalesNavId() instead
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - LinkedIn username or null
 */
function extractLinkedInUsername(data) {
  // Pattern to match LinkedIn usernames (alphanumeric, hyphens, underscores)
  const usernamePattern = /\/in\/([a-zA-Z0-9_-]+)\/?/;
  const pidPattern = /^pid\.([a-zA-Z0-9_-]+)$/;
  // Pattern to detect Sales Nav IDs (should NOT be treated as usernames)
  const salesNavIdPattern = /^A(Cw|Co)AAA/;

  /**
   * Helper to validate extracted username
   * Returns username if valid, null if it's actually a Sales Nav ID
   */
  function validateUsername(username) {
    if (!username) return null;
    // Reject if it's a Sales Navigator ID
    if (salesNavIdPattern.test(username)) {
      return null;
    }
    return username.toLowerCase();
  }

  // 1. Check DuxSoup ID for pid.username format
  const duxsoupId = data.id || data.data?.id;
  if (duxsoupId) {
    const pidMatch = duxsoupId.match(pidPattern);
    if (pidMatch) {
      const username = validateUsername(pidMatch[1]);
      if (username) return username;
    }
  }

  // 2. Check Profile URL
  const profile = data.Profile || data.data?.Profile;
  if (profile) {
    const match = profile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 3. Check PublicProfile
  const publicProfile = data.PublicProfile || data.data?.PublicProfile;
  if (publicProfile) {
    const match = publicProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 4. Check SalesProfile (rare, but possible)
  const salesProfile = data.SalesProfile || data.data?.SalesProfile;
  if (salesProfile) {
    const match = salesProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 5. Check RecruiterProfile
  const recruiterProfile = data.RecruiterProfile || data.data?.RecruiterProfile;
  if (recruiterProfile) {
    const match = recruiterProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  return null;
}

/**
 * Extract Sales Navigator ID from various fields
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - Sales Navigator ID or null
 */
function extractSalesNavId(data) {
  // Sales Nav IDs start with ACwAAA or ACoAAA
  const salesNavPattern = /A(Cw|Co)AAA[A-Za-z0-9_-]+/;

  // Check SalesProfile URL
  const salesProfile = data.SalesProfile || data.data?.SalesProfile;
  if (salesProfile) {
    const match = salesProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check Profile URL (sometimes contains Sales Nav ID)
  const profile = data.Profile || data.data?.Profile;
  if (profile) {
    const match = profile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check PublicProfile
  const publicProfile = data.PublicProfile || data.data?.PublicProfile;
  if (publicProfile) {
    const match = publicProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check RecruiterProfile
  const recruiterProfile = data.RecruiterProfile || data.data?.RecruiterProfile;
  if (recruiterProfile) {
    const match = recruiterProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  return null;
}

/**
 * Normalize Profile URL (remove trailing slashes, query params, protocol)
 *
 * @param {string} url - Profile URL
 * @returns {string|null} - Normalized URL or null
 */
function normalizeUrl(url) {
  if (!url) return null;
  try {
    let normalized = url.trim().toLowerCase();
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");
    // Remove query parameters
    normalized = normalized.split("?")[0];
    // Remove http/https differences
    normalized = normalized.replace(/^https?:\/\//, "");
    return normalized;
  } catch (e) {
    return url;
  }
}

/**
 * Extract all identifiers from webhook/observation data using waterfall priority
 *
 * @param {Object} data - Webhook or observation data
 * @returns {Object} - Object containing all extracted identifiers
 */
function extractIdentifiers(data) {
  const identifiers = {
    linkedInUsername: extractLinkedInUsername(data),
    salesNavId: extractSalesNavId(data),
    duxsoupId: data.id || data.data?.id || null,
    profileUrl: normalizeUrl(data.Profile || data.data?.Profile),
    publicProfile: normalizeUrl(data.PublicProfile || data.data?.PublicProfile),
    recruiterProfile: normalizeUrl(
      data.RecruiterProfile || data.data?.RecruiterProfile,
    ),
  };

  return identifiers;
}

/**
 * Get the primary identifier using waterfall approach
 *
 * Priority Order:
 * 1. LinkedIn Username (works across Sales Nav + Regular LinkedIn)
 * 2. Sales Navigator ID (stable, but only in Sales Nav)
 * 3. Normalized Profile URL (fallback for profiles without custom username)
 * 4. Public Profile / Recruiter Profile (rare)
 * 5. DuxSoup ID (last resort - changes between scan sources)
 *
 * @param {Object} identifiers - Object from extractIdentifiers()
 * @returns {Object|null} - { type: string, value: string } or null
 */
function getPrimaryIdentifier(identifiers) {
  if (identifiers.linkedInUsername) {
    return { type: "linkedInUsername", value: identifiers.linkedInUsername };
  }
  if (identifiers.salesNavId) {
    return { type: "salesNavId", value: identifiers.salesNavId };
  }
  if (identifiers.profileUrl) {
    return { type: "profileUrl", value: identifiers.profileUrl };
  }
  if (identifiers.publicProfile) {
    return { type: "publicProfile", value: identifiers.publicProfile };
  }
  if (identifiers.recruiterProfile) {
    return { type: "recruiterProfile", value: identifiers.recruiterProfile };
  }
  if (identifiers.duxsoupId) {
    return { type: "duxsoupId", value: identifiers.duxsoupId };
  }
  return null;
}

/**
 * Generate a stable identity key for deduplication
 *
 * Uses the primary identifier to create a unique key
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - Stable identity key or null
 */
function generateIdentityKey(data) {
  const identifiers = extractIdentifiers(data);
  const primary = getPrimaryIdentifier(identifiers);

  if (!primary) return null;

  // Create a hash of the identifier for storage efficiency
  return crypto
    .createHash("sha256")
    .update(`${primary.type}:${primary.value}`)
    .digest("hex");
}

/**
 * Check if two data objects represent the same person
 *
 * @param {Object} data1 - First webhook/observation
 * @param {Object} data2 - Second webhook/observation
 * @returns {boolean} - True if same person
 */
function isSamePerson(data1, data2) {
  const identifiers1 = extractIdentifiers(data1);
  const identifiers2 = extractIdentifiers(data2);

  // Check if any identifier matches
  if (
    identifiers1.linkedInUsername &&
    identifiers1.linkedInUsername === identifiers2.linkedInUsername
  ) {
    return true;
  }
  if (
    identifiers1.salesNavId &&
    identifiers1.salesNavId === identifiers2.salesNavId
  ) {
    return true;
  }
  if (
    identifiers1.profileUrl &&
    identifiers1.profileUrl === identifiers2.profileUrl
  ) {
    return true;
  }

  return false;
}

module.exports = {
  extractLinkedInUsername,
  extractSalesNavId,
  normalizeUrl,
  extractIdentifiers,
  getPrimaryIdentifier,
  generateIdentityKey,
  isSamePerson,
};
