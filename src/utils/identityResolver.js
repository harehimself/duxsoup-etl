const crypto = require("crypto");
const logger = require("./logger");
const identityMatcher = require("./identityMatcher");
const { parseLocation } = require("./location-parser");

/**
 * Identity Resolution Utility
 *
 * NOW USES CENTRALIZED IDENTITY MATCHER (src/utils/identityMatcher.js)
 *
 * This file maintains backward compatibility with existing code
 * while using the waterfall identity matching logic internally.
 *
 * Waterfall Priority (from identityMatcher.js):
 * 1. Sales Navigator ID (ACwAAA/ACoAAA) - MOST STABLE, never changes
 * 2. LinkedIn Username - stable across Sales Nav + Regular LinkedIn
 * 3. Normalized Profile URL
 * 4. Public Profile / Recruiter Profile
 * 5. DuxSoup ID (last resort)
 *
 * MIGRATION NOTE: New code should use identityMatcher.js directly.
 * This file exists for backward compatibility with existing controllers.
 */

/**
 * Extract Sales Navigator person ID from URL or field
 * Format: ACwAAAxxxxxxx or ACoAAAxxxxxxx (base64-like ID)
 *
 * LinkedIn uses two formats:
 * - ACwAAA (common in scans): https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ
 * - ACoAAA (common in visits): https://www.linkedin.com/sales/people/ACoAABJdcQ8BIhAujd1YYtK2saU-EJcfP4SRYuQ
 *
 * @param {string} url - URL or field value
 * @returns {string|null} Sales Navigator person ID or null
 */
function extractSalesNavId(url) {
  if (!url || typeof url !== "string") return null;

  // Pattern: Match BOTH ACwAAA and ACoAAA followed by base64-like characters
  // Use explicit alternation to avoid character class ambiguity
  const salesNavPattern = /((?:ACwAAA|ACoAAA)[A-Za-z0-9_-]+)/;
  const match = url.match(salesNavPattern);

  return match ? match[1] : null;
}

/**
 * Extract LinkedIn numeric member ID from URL or field
 * Format: Numeric ID (e.g., 12345678)
 *
 * Note: This is harder to extract from public URLs.
 * Best source is from Sales Navigator URLs or API responses.
 *
 * @param {string} url - URL or field value
 * @returns {string|null} Numeric member ID or null
 */
function extractNumericId(url) {
  if (!url || typeof url !== "string") return null;

  // Pattern: /profile/[numeric_id] or similar
  const numericPattern = /\/profile\/(\d{8,})/;
  const match = url.match(numericPattern);

  return match ? match[1] : null;
}

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
    // Remove protocol and domain, normalize
    const normalized = url
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, "")
      .replace(/\/$/, "")
      .trim();

    // Pattern: /in/username or /pub/username
    const publicPattern = /^\/(in|pub)\/([^\/\?]+)/;
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

  // Company IDs are typically numeric
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
    // Extract numeric ID from company URL
    // Pattern: /company/12345678 or /company/12345678/
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

function extractCompanyProfileUrl(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const normalized = url
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, "")
      .replace(/\/$/, "")
      .trim();

    const companyPattern = /^\/company\/([^\/\?]+)/;
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
    .createHash("sha1")
    .update(Buffer.concat([namespaceBytes, nameBytes]))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  return bytesToUuid(hash.slice(0, 16));
}

/**
 * Resolve person identity from webhook data
 * Returns the best available canonical identifier and all aliases
 *
 * NOW USES CENTRALIZED IDENTITY MATCHER (identityMatcher.js)
 *
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { person_id, aliases, source, primary_id_type, canonical_key, canonical_id }
 */
function resolvePersonIdentity(webhookData) {
  // Use centralized identity matcher for extraction
  const identifiers = identityMatcher.extractIdentifiers(webhookData);
  const primary = identityMatcher.getPrimaryIdentifier(identifiers);

  const aliases = [];
  let person_id = null;
  let source = null;
  let primaryIdType = null;

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

  // Map the primary identifier to person_id
  person_id = primary.value;
  primaryIdType = primary.type;

  // Map identifier types to source names for backward compatibility
  const sourceMapping = {
    linkedInUsername: "linkedInUsername",
    salesNavId: "salesNavId",
    profileUrl: "profileUrl",
    publicProfile: "publicUrl",
    recruiterProfile: "recruiterUrl",
    duxsoupId: "duxsoupId",
  };

  source = sourceMapping[primary.type] || primary.type;

  // Build aliases from all extracted identifiers
  if (identifiers.linkedInUsername) {
    aliases.push({
      type: "linkedInUsername",
      value: identifiers.linkedInUsername,
    });
  }

  if (identifiers.salesNavId) {
    aliases.push({ type: "salesNavId", value: identifiers.salesNavId });
  }

  if (identifiers.duxsoupId) {
    aliases.push({ type: "duxsoupId", value: identifiers.duxsoupId });
  }

  if (identifiers.profileUrl) {
    aliases.push({ type: "profileUrl", value: identifiers.profileUrl });
  }

  if (identifiers.publicProfile) {
    aliases.push({ type: "publicUrl", value: identifiers.publicProfile });
  }

  if (identifiers.recruiterProfile) {
    aliases.push({ type: "recruiterUrl", value: identifiers.recruiterProfile });
  }

  // Add original URL fields as aliases (normalized)
  if (webhookData.SalesProfile) {
    const normalizedSalesUrl = identityMatcher.normalizeUrl(
      webhookData.SalesProfile,
    );
    if (normalizedSalesUrl) {
      aliases.push({ type: "salesUrl", value: normalizedSalesUrl });
    }
  }

  if (webhookData.RecruiterProfile) {
    const normalizedRecruiterUrl = identityMatcher.normalizeUrl(
      webhookData.RecruiterProfile,
    );
    if (normalizedRecruiterUrl) {
      aliases.push({ type: "recruiterUrl", value: normalizedRecruiterUrl });
    }
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

/**
 * Resolve company identity from webhook data
 *
 * Priority:
 * 1. CompanyID field (numeric ID) - MOST STABLE
 * 2. Extract numeric ID from CompanyProfile URL
 * 3. Company name as last resort
 *
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { company_id, aliases, source }
 */
function resolveCompanyIdentity(webhookData) {
  const aliases = [];
  let company_id = null;
  let source = null;
  let primaryIdType = null;

  // Priority 1: CompanyID field (numeric ID from DuxSoup)
  if (webhookData.CompanyID) {
    const numericId = extractCompanyId(webhookData.CompanyID);
    if (numericId) {
      company_id = numericId;
      source = "numericId";
      primaryIdType = "numericId";
      aliases.push({ type: "numericId", value: numericId });
    }
  }

  // Priority 2: Extract numeric ID from CompanyProfile URL
  // Example: "linkedin.com/company/82978333" → "82978333"
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

  // Always add CompanyProfile URL as alias (if available)
  if (webhookData.CompanyProfile) {
    const profileUrl = extractCompanyProfileUrl(webhookData.CompanyProfile);
    if (profileUrl && !aliases.find((a) => a.value === profileUrl)) {
      aliases.push({ type: "profileUrl", value: profileUrl });
    }
  }

  // Always add company name as alias (if available)
  // NOTE: Company name alone is NOT used as _id because:
  // 1. Company model requires numeric IDs only
  // 2. Names are unstable (companies rebrand)
  // 3. Names can duplicate across different companies
  // Better to skip company creation than use unstable identifier
  if (webhookData.Company) {
    const name = webhookData.Company.trim();
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

function normalizeLocationName(value) {
  if (!value || typeof value !== "string") return null;

  // Normalize whitespace but preserve accents, periods, commas
  return value.trim().replace(/\s+/g, " ");
}

function slugifyLocation(value) {
  if (!value) return null;

  // Create slug for ID purposes: lowercase, no accents, hyphens for spaces
  // But we keep the normalized form with accents in the snapshot
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents for ID
    .replace(/[^\w\s-]/g, "") // Remove special chars
    .trim()
    .replace(/\s+/g, "-");
}

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

  // Parse the location into structured components
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
    parsed, // Include parsed location components
  };
}
module.exports = {
  extractSalesNavId,
  extractNumericId,
  extractPublicProfileUrl,
  extractCompanyId,
  extractCompanyIdFromUrl,
  extractCompanyProfileUrl,
  buildCanonicalKey,
  computeCanonicalId,
  resolvePersonIdentity,
  resolveCompanyIdentity,
  normalizeLocationName,
  resolveLocationIdentity,
};
