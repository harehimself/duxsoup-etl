/**
 * Centralized Identity Matching Utility
 *
 * Provides consistent waterfall identity resolution across all collections
 * (Scans, Visits, People, etc.)
 *
 * Priority Order:
 * 1. Sales Navigator ID (ACwAAA/ACoAAA) - MOST STABLE, never changes
 * 2. LinkedIn Username - stable across Sales Nav + Regular LinkedIn
 * 3. Normalized Profile URL
 * 4. Public Profile / Recruiter Profile
 * 5. DuxSoup ID (changes between scan sources - least stable)
 *
 * Usage:
 *   const { extractIdentifiers, getPrimaryIdentifier } = require('./utils/identityMatcher');
 *
 *   const identifiers = extractIdentifiers(webhookData);
 *   const primary = getPrimaryIdentifier(identifiers);
 *   // primary = { type: 'salesNavId', value: 'ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ' }
 */

const crypto = require("crypto");
const logger = require("./logger");
const { parseLocation } = require("./location-parser");
const { normalizeCompanyName } = require("./companyNormalizer");

/**
 * Safely decode percent-encoded URL components.
 * Returns the original string on malformed encoding (%ZZ, truncated %A).
 *
 * @param {string} url - Possibly percent-encoded string
 * @returns {string|null} Decoded string, or original on failure
 */
function safeDecode(url) {
  if (!url || typeof url !== "string") return url;
  try {
    return decodeURIComponent(url);
  } catch (_e) {
    return url;
  }
}

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
  // Pattern to match LinkedIn usernames — broad character class to support
  // decoded international characters (é, ö, etc.) from percent-encoded URLs
  const usernamePattern = /\/in\/([^/?#]+?)(?:\/[a-z]{2})?\/?(?:[?#]|$)/;
  const pidPattern = /^pid\.([a-zA-Z0-9_-]+)$/;
  // Pattern to detect Sales Nav IDs (should NOT be treated as usernames)
  const salesNavIdPattern = /^A(Cw|Co)AA/;

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

  // 2. Check explicit LinkedIn username field
  const explicitUsername = data.LinkedInUsername || data.data?.LinkedInUsername;
  if (explicitUsername) {
    const username = validateUsername(explicitUsername);
    if (username) return username;
  }

  // 3. Check Profile URL (decode percent-encoding before regex)
  const profile = safeDecode(data.Profile || data.data?.Profile);
  if (profile) {
    const match = profile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 4. Check PublicProfile
  const publicProfile = safeDecode(
    data.PublicProfile || data.data?.PublicProfile,
  );
  if (publicProfile) {
    const match = publicProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 5. Check SalesProfile (rare, but possible)
  const salesProfile = safeDecode(data.SalesProfile || data.data?.SalesProfile);
  if (salesProfile) {
    const match = salesProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 6. Check RecruiterProfile
  const recruiterProfile = safeDecode(
    data.RecruiterProfile || data.data?.RecruiterProfile,
  );
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
 * UPDATED: Now uses the robust extractor from salesNavIdExtractor.js
 * - Case-insensitive extraction
 * - Parameter stripping (,name,o7fk)
 * - Canonical case normalization
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - Sales Navigator ID or null
 */
function extractSalesNavId(data) {
  // Delegate to the robust extractor
  const {
    extractSalesNavId: robustExtractor,
  } = require("./salesNavIdExtractor");
  return robustExtractor(data);
}

/**
 * Normalize Profile URL (remove trailing slashes, query params, protocol)
 *
 * @param {string} url - Profile URL
 * @returns {string|null} - Normalized URL or null
 */
function normalizeUrl(url) {
  if (!url) return null;
  // Guard: only process strings that look like URLs
  // Reject non-URL identifiers (Sales Nav IDs, numeric IDs, usernames)
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed) && !/linkedin\.com/i.test(trimmed)) {
    return null;
  }
  try {
    let normalized = safeDecode(trimmed).toLowerCase();
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");
    // Remove query parameters
    normalized = normalized.split("?")[0];
    // Remove comma-separated tracking params (e.g. ,NAME,o7fk on Sales Nav URLs)
    normalized = normalized.split(",")[0];
    // Remove http/https differences
    normalized = normalized.replace(/^https?:\/\//, "");
    // Normalize www subdomain
    normalized = normalized.replace(/^www\./, "");
    // Normalize double slashes and trailing slash
    normalized = normalized.replace(/\/\/+/g, "/").replace(/\/$/, "");
    // Strip locale suffix from /in/ profile URLs (e.g. /in/username/en → /in/username)
    normalized = normalized.replace(/(\/in\/[^/?#]+)\/[a-z]{2}$/, "$1");
    return normalized;
  } catch (_e) {
    return url;
  }
}

/**
 * Normalize public LinkedIn profile URLs to linkedin.com/in/<username> or linkedin.com/pub/<slug>
 *
 * @param {string} url - LinkedIn URL
 * @returns {string|null} - Normalized public profile URL or null
 */
function normalizePublicProfileUrl(url) {
  if (!url || typeof url !== "string") return null;

  const normalized = normalizeUrl(url);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/linkedin\.com\/(in|pub)\/([^/?]+)/);
  if (!match) {
    return null;
  }

  return `linkedin.com/${match[1]}/${match[2]}`;
}

/**
 * Normalize DuxSoup IDs to a canonical lowercase format.
 *
 * @param {string} duxsoupId - DuxSoup ID
 * @returns {string|null} - Normalized DuxSoup ID or null
 */
function normalizeDuxsoupId(duxsoupId) {
  if (!duxsoupId || typeof duxsoupId !== "string") {
    return null;
  }

  return duxsoupId.trim().toLowerCase();
}

/**
 * Extract LinkedIn vanity name from profile URLs
 *
 * The vanity name is the custom slug in linkedin.com/in/{vanityName}
 * Example: "www.linkedin.com/in/mike-hare" → "mike-hare"
 *
 * IMPORTANT: Excludes Sales Navigator IDs (ACwAAA/ACoAAA patterns)
 * Those are NOT vanity names even though they can appear in /in/ URLs.
 *
 * @param {Object} data - Webhook or observation data
 * @returns {string|null} - Vanity name or null
 */
function extractVanityName(data) {
  const vanityPattern = /\/in\/([^/?#]+?)(?:\/[a-z]{2})?\/?(?:[?#]|$)/;
  const salesNavIdPattern = /^A(Cw|Co)AA/;

  function extractFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    const decoded = safeDecode(url);
    const match = decoded.match(vanityPattern);
    if (!match) return null;
    const slug = match[1];
    // Reject Sales Navigator IDs masquerading in /in/ URLs
    if (salesNavIdPattern.test(slug)) return null;
    return slug.toLowerCase();
  }

  // Check Profile URL first (most common source)
  const profile = data.Profile || data.data?.Profile;
  const fromProfile = extractFromUrl(profile);
  if (fromProfile) return fromProfile;

  // Check PublicProfile
  const publicProfile = data.PublicProfile || data.data?.PublicProfile;
  const fromPublic = extractFromUrl(publicProfile);
  if (fromPublic) return fromPublic;

  return null;
}

/**
 * Extract all identifiers from webhook/observation data using waterfall priority
 *
 * UPDATED: Now includes numericId extraction and vanityName
 *
 * @param {Object} data - Webhook or observation data
 * @returns {Object} - Object containing all extracted identifiers
 */
function extractIdentifiers(data) {
  const { extractNumericId } = require("./salesNavIdExtractor");

  const duxsoupId = data.id || data.data?.id || null;
  const normalizedDuxsoupId = normalizeDuxsoupId(duxsoupId);
  const numericId = duxsoupId ? extractNumericId(duxsoupId) : null;

  const identifiers = {
    salesNavId: extractSalesNavId(data),
    numericId: numericId,
    linkedInUsername: extractLinkedInUsername(data),
    vanityName: extractVanityName(data),
    duxsoupId: normalizedDuxsoupId || duxsoupId,
    profileUrl: normalizeUrl(data.Profile || data.data?.Profile),
    publicProfile:
      normalizePublicProfileUrl(
        data.PublicProfile || data.data?.PublicProfile,
      ) ||
      normalizePublicProfileUrl(data.Profile || data.data?.Profile) ||
      normalizeUrl(data.PublicProfile || data.data?.PublicProfile),
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
 * 1. Sales Navigator ID (MOST STABLE - never changes, LinkedIn's canonical ID)
 * 2. Numeric ID (LinkedIn member ID - stable and immutable)
 * 3. LinkedIn Username (stable across Sales Nav + Regular LinkedIn)
 * 4. Normalized Profile URL (fallback for profiles without custom username)
 * 5. Public Profile / Recruiter Profile (rare)
 * 6. DuxSoup ID (last resort - changes between scan sources)
 *
 * Note: All identifiers are collected as aliases for cross-platform matching.
 * findByAnyAlias() can locate a person using any identifier type.
 *
 * @param {Object} identifiers - Object from extractIdentifiers()
 * @returns {Object|null} - { type: string, value: string } or null
 */
function getPrimaryIdentifier(identifiers) {
  if (identifiers.salesNavId) {
    return { type: "salesNavId", value: identifiers.salesNavId };
  }
  if (identifiers.numericId) {
    return { type: "numericId", value: identifiers.numericId };
  }
  if (identifiers.linkedInUsername) {
    return { type: "linkedInUsername", value: identifiers.linkedInUsername };
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

// ---------------------------------------------------------------------------
// Canonical ID generation (migrated from identityResolver.js)
// ---------------------------------------------------------------------------

const CANONICAL_ID_NAMESPACE =
  process.env.CANONICAL_ID_NAMESPACE || "9a6c1cf1-5f9f-4f7e-9b5d-3a0d8d8c0f1a";

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buffer) {
  const hex = buffer.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function buildCanonicalKey(primaryIdType, primaryIdValue) {
  if (!primaryIdType || !primaryIdValue) {
    return null;
  }
  return `${primaryIdType}:${primaryIdValue}`;
}

function computeCanonicalId(canonicalKey, namespace = CANONICAL_ID_NAMESPACE) {
  if (!canonicalKey) {
    return null;
  }

  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = Buffer.from(canonicalKey, "utf8");
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.concat([namespaceBytes, nameBytes]))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  return bytesToUuid(hash.slice(0, 16));
}

// ---------------------------------------------------------------------------
// URL extraction helpers (migrated from identityResolver.js)
// ---------------------------------------------------------------------------

/**
 * Extract public profile username from LinkedIn URL
 * Format: /in/username
 *
 * WARNING: Public profile URLs are UNSTABLE and can change.
 * Only use as a fallback alias, NEVER as primary identity.
 *
 * @param {string} url - Public profile URL
 * @returns {string|null} Profile username or null
 */
function extractPublicProfileUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const decoded = safeDecode(url);
    const normalized = decoded
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, "")
      .replace(/\/$/, "")
      .trim();

    const publicPattern = /^\/(in|pub)\/([^/?]+)/;
    const match = normalized.match(publicPattern);

    return match ? `linkedin.com${match[0]}` : null;
  } catch (error) {
    logger.warn("Failed to extract public profile URL", {
      url,
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract company numeric ID from webhook data
 *
 * @param {string} companyId - Company ID field from scan
 * @returns {string|null} Company numeric ID or null
 */
function extractCompanyId(companyId) {
  if (!companyId || typeof companyId !== "string") return null;

  const numericPattern = /^(\d+)$/;
  const match = companyId.match(numericPattern);

  return match ? match[1] : null;
}

/**
 * Extract company numeric ID from LinkedIn company profile URL
 * Example: "https://linkedin.com/company/82978333" → "82978333"
 *
 * @param {string} url - Company profile URL
 * @returns {string|null} Numeric company ID or null
 */
function extractCompanyIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const numericPattern = /\/company\/(\d+)/;
    const match = url.match(numericPattern);

    return match ? match[1] : null;
  } catch (error) {
    logger.warn("Failed to extract company ID from URL", {
      url,
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract normalized company profile URL
 *
 * @param {string} url - Company profile URL
 * @returns {string|null} Normalized company profile URL or null
 */
function extractCompanyProfileUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const decoded = safeDecode(url);
    const normalized = decoded
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, "")
      .replace(/\/$/, "")
      .trim();

    const companyPattern = /^\/company\/([^/?]+)/;
    const match = normalized.match(companyPattern);

    return match ? `linkedin.com${match[0]}` : null;
  } catch (error) {
    logger.warn("Failed to extract company profile URL", {
      url,
      error: error.message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Person identity resolution (migrated from identityResolver.js)
// ---------------------------------------------------------------------------

/**
 * Resolve person identity from webhook data
 * Returns the best available canonical identifier and all aliases
 *
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { person_id, aliases, source, primary_id_type, canonical_key, canonical_id }
 */
function resolvePersonIdentity(webhookData) {
  const identifiers = extractIdentifiers(webhookData);
  const primary = getPrimaryIdentifier(identifiers);

  const aliases = [];
  const aliasKeys = new Set();
  let person_id;
  let source;
  let primaryIdType;

  const addAlias = (type, value) => {
    if (!value) return;
    const key = `${type}:${value}`;
    if (aliasKeys.has(key)) return;
    aliasKeys.add(key);
    aliases.push({ type, value });
  };

  if (!primary) {
    logger.warn("No identifier found in webhook data", {
      webhookData: {
        Profile: webhookData.Profile,
        PublicProfile: webhookData.PublicProfile,
        SalesProfile: webhookData.SalesProfile,
        id: webhookData.id,
      },
    });

    return {
      person_id: null,
      aliases: [],
      source: null,
      primary_id_type: null,
      canonical_key: null,
      canonical_id: null,
    };
  }

  person_id = primary.value;
  primaryIdType = primary.type;

  const sourceMapping = {
    linkedInUsername: "linkedInUsername",
    salesNavId: "salesNavId",
    numericId: "numericId",
    profileUrl: "profileUrl",
    publicProfile: "publicUrl",
    recruiterProfile: "recruiterUrl",
    duxsoupId: "duxsoupId",
  };

  source = sourceMapping[primary.type] || primary.type;

  // Derive linkedInUsername from vanityName when username extraction fails
  if (!identifiers.linkedInUsername && identifiers.vanityName) {
    identifiers.linkedInUsername = identifiers.vanityName;
  }

  if (identifiers.linkedInUsername) {
    addAlias("linkedInUsername", identifiers.linkedInUsername);
  }
  if (identifiers.vanityName) {
    addAlias("vanityName", identifiers.vanityName);
  }
  if (identifiers.salesNavId) {
    addAlias("salesNavId", identifiers.salesNavId);
  }
  if (identifiers.numericId) {
    addAlias("numericId", identifiers.numericId);
  }
  if (identifiers.duxsoupId) {
    addAlias("duxsoupId", identifiers.duxsoupId);
  }
  if (identifiers.profileUrl) {
    addAlias("profileUrl", identifiers.profileUrl);
  }
  if (identifiers.publicProfile) {
    addAlias("publicUrl", identifiers.publicProfile);
  }
  if (identifiers.recruiterProfile) {
    addAlias("recruiterUrl", identifiers.recruiterProfile);
  }

  // Add original URL fields as aliases (normalized)
  if (webhookData.SalesProfile) {
    const normalizedSalesUrl = normalizeUrl(webhookData.SalesProfile);
    if (normalizedSalesUrl) {
      addAlias("salesUrl", normalizedSalesUrl);
    }
  }

  if (webhookData.RecruiterProfile) {
    const normalizedRecruiterUrl = normalizeUrl(webhookData.RecruiterProfile);
    if (normalizedRecruiterUrl) {
      addAlias("recruiterUrl", normalizedRecruiterUrl);
    }
  }

  const publicProfileFromUrl = normalizePublicProfileUrl(
    webhookData.Profile || webhookData.PublicProfile,
  );
  if (publicProfileFromUrl) {
    addAlias("publicUrl", publicProfileFromUrl);
  }

  const normalizedDuxsoupId = normalizeDuxsoupId(
    webhookData.id || webhookData.data?.id,
  );
  if (normalizedDuxsoupId && normalizedDuxsoupId !== identifiers.duxsoupId) {
    addAlias("duxsoupId", normalizedDuxsoupId);
  }

  // Log warning if using unstable identifier
  if (primary.type === "profileUrl" || primary.type === "publicProfile") {
    logger.warn(
      "Using unstable profile URL as person_id - no stable ID found",
      {
        identifierType: primary.type,
        identifierValue: primary.value,
        webhookData: {
          Profile: webhookData.Profile,
          PublicProfile: webhookData.PublicProfile,
          SalesProfile: webhookData.SalesProfile,
          id: webhookData.id,
        },
      },
    );
  }

  const canonical_key = buildCanonicalKey(primaryIdType, person_id);
  const canonical_id = computeCanonicalId(canonical_key);

  return {
    person_id,
    aliases,
    source,
    primary_id_type: primaryIdType,
    canonical_key,
    canonical_id,
  };
}

// ---------------------------------------------------------------------------
// Company identity resolution (migrated from identityResolver.js)
// ---------------------------------------------------------------------------

/**
 * Resolve company identity from webhook data
 *
 * Priority:
 * 1. CompanyID field (numeric ID) - MOST STABLE
 * 2. Extract numeric ID from CompanyProfile URL
 * 3. Company name as last resort (alias only, not used as _id)
 *
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { company_id, aliases, source, primary_id_type, canonical_key, canonical_id }
 */
function resolveCompanyIdentity(webhookData) {
  const aliases = [];
  let company_id = null;
  let source = null;
  let primaryIdType = null;

  if (webhookData.CompanyID) {
    const numericId = extractCompanyId(webhookData.CompanyID);
    if (numericId) {
      company_id = numericId;
      source = "numericId";
      primaryIdType = "numericId";
      aliases.push({ type: "numericId", value: numericId });
    }
  }

  if (!company_id && webhookData.CompanyProfile) {
    const numericIdFromUrl = extractCompanyIdFromUrl(
      webhookData.CompanyProfile,
    );
    if (numericIdFromUrl) {
      company_id = numericIdFromUrl;
      source = "numericId";
      primaryIdType = "numericId";
      aliases.push({ type: "numericId", value: numericIdFromUrl });
    }
  }

  if (webhookData.CompanyProfile) {
    const profileUrl = extractCompanyProfileUrl(webhookData.CompanyProfile);
    if (profileUrl && !aliases.find((a) => a.value === profileUrl)) {
      aliases.push({ type: "profileUrl", value: profileUrl });
    }
  }

  if (webhookData.Company) {
    const name = normalizeCompanyName(webhookData.Company);
    if (name && !aliases.find((a) => a.value === name)) {
      aliases.push({ type: "name", value: name });
    }
  }

  const canonical_key = buildCanonicalKey(primaryIdType, company_id);
  const canonical_id = computeCanonicalId(canonical_key);

  return {
    company_id,
    aliases,
    source,
    primary_id_type: primaryIdType,
    canonical_key,
    canonical_id,
  };
}

// ---------------------------------------------------------------------------
// Location identity resolution (migrated from identityResolver.js)
// ---------------------------------------------------------------------------

function normalizeLocationName(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().replace(/\s+/g, " ");
}

function slugifyLocation(value) {
  if (!value) return null;
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Resolve location identity from a location string
 *
 * @param {string} locationValue - Raw location string (e.g. "San Francisco, CA, USA")
 * @returns {Object} { location_id, aliases, source, primary_id_type, canonical_key, canonical_id, normalized, parsed }
 */
function resolveLocationIdentity(locationValue) {
  const normalized = normalizeLocationName(locationValue);
  if (!normalized) {
    return {
      location_id: null,
      aliases: [],
      source: null,
      primary_id_type: null,
      canonical_key: null,
      canonical_id: null,
      parsed: null,
    };
  }

  const slug = slugifyLocation(normalized);
  const canonicalKey = buildCanonicalKey("location", slug);
  const parsed = parseLocation(locationValue);

  return {
    location_id: slug,
    aliases: [
      { type: "raw", value: locationValue },
      { type: "normalized", value: normalized },
    ],
    source: "normalized",
    primary_id_type: "location",
    canonical_key: canonicalKey,
    canonical_id: computeCanonicalId(canonicalKey),
    normalized,
    parsed,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Helpers
  safeDecode,
  // Identifier extraction
  extractLinkedInUsername,
  extractVanityName,
  extractSalesNavId,
  extractIdentifiers,
  getPrimaryIdentifier,
  generateIdentityKey,
  isSamePerson,
  // URL normalization
  normalizeUrl,
  normalizePublicProfileUrl,
  normalizeDuxsoupId,
  // Canonical ID
  buildCanonicalKey,
  computeCanonicalId,
  // Person resolution
  resolvePersonIdentity,
  // Company resolution
  extractCompanyId,
  extractCompanyIdFromUrl,
  extractCompanyProfileUrl,
  resolveCompanyIdentity,
  // Location resolution
  normalizeLocationName,
  resolveLocationIdentity,
  // URL extraction
  extractPublicProfileUrl,
};
