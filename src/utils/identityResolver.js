const crypto = require('crypto');
const logger = require('./logger');

/**
 * Identity Resolution Utility
 *
 * Extracts canonical identifiers from LinkedIn URLs and webhook data.
 *
 * Priority:
 * 1. Sales Navigator person ID (ACwAAABCDEF format) - MOST STABLE
 * 2. LinkedIn numeric member ID (e.g., 12345678) - STABLE
 * 3. Public profile URL (e.g., /in/username) - UNSTABLE (can change)
 *
 * NEVER use profile URLs as primary identity - they change when users rename profiles.
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
  if (!url || typeof url !== 'string') return null;

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
  if (!url || typeof url !== 'string') return null;

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
  if (!url || typeof url !== 'string') return null;

  try {
    // Remove protocol and domain, normalize
    const normalized = url
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, '')
      .replace(/\/$/, '')
      .trim();

    // Pattern: /in/username or /pub/username
    const publicPattern = /^\/(in|pub)\/([^\/\?]+)/;
    const match = normalized.match(publicPattern);

    return match ? `linkedin.com${match[0]}` : null;
  } catch (error) {
    logger.warn('Failed to extract public profile URL', { url, error: error.message });
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
  if (!companyId || typeof companyId !== 'string') return null;

  // Company IDs are typically numeric
  const numericPattern = /^(\d+)$/;
  const match = companyId.match(numericPattern);

  return match ? match[1] : null;
}

function extractCompanyProfileUrl(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    const normalized = url
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com/i, '')
      .replace(/\/$/, '')
      .trim();

    const companyPattern = /^\/company\/([^\/\?]+)/;
    const match = normalized.match(companyPattern);

    return match ? `linkedin.com${match[0]}` : null;
  } catch (error) {
    logger.warn('Failed to extract company profile URL', { url, error: error.message });
    return null;
  }
}
const CANONICAL_ID_NAMESPACE = process.env.CANONICAL_ID_NAMESPACE || '9a6c1cf1-5f9f-4f7e-9b5d-3a0d8d8c0f1a';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
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
  const nameBytes = Buffer.from(canonicalKey, 'utf8');
  const hash = crypto
    .createHash('sha1')
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
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { person_id, aliases, source }
 */
function resolvePersonIdentity(webhookData) {
  const aliases = [];
  let person_id = null;
  let source = null;
  let primaryIdType = null;

  // Priority 1: Extract Sales Navigator ID from SalesProfile
  if (webhookData.SalesProfile) {
    const salesNavId = extractSalesNavId(webhookData.SalesProfile);
    if (salesNavId) {
      person_id = salesNavId;
      source = 'salesNavId';
      primaryIdType = 'salesNavId';
      aliases.push({ type: 'salesNavId', value: salesNavId });
      aliases.push({ type: 'salesUrl', value: webhookData.SalesProfile });
    }
  }

  // Priority 2: Try RecruiterProfile if SalesProfile not available
  if (!person_id && webhookData.RecruiterProfile) {
    const recruiterId = extractSalesNavId(webhookData.RecruiterProfile);
    if (recruiterId) {
      person_id = recruiterId;
      source = 'recruiterUrl';
      primaryIdType = 'salesNavId';
      aliases.push({ type: 'salesNavId', value: recruiterId });
      aliases.push({ type: 'recruiterUrl', value: webhookData.RecruiterProfile });
    }
  }

  // Priority 3: Try to extract Sales Nav ID or numeric ID from Profile field
  // (DuxSoup sometimes puts Sales Nav URLs in Profile field instead of SalesProfile)
  if (!person_id && webhookData.Profile) {
    // First try Sales Nav ID extraction
    const salesNavId = extractSalesNavId(webhookData.Profile);
    if (salesNavId) {
      person_id = salesNavId;
      source = 'salesNavId';
      primaryIdType = 'salesNavId';
      aliases.push({ type: 'salesNavId', value: salesNavId });
      aliases.push({ type: 'salesUrl', value: webhookData.Profile });
    } else {
      // Fallback to numeric ID extraction
      const numericId = extractNumericId(webhookData.Profile);
      if (numericId) {
        person_id = numericId;
        source = 'numericId';
        primaryIdType = 'numericId';
        aliases.push({ type: 'numericId', value: numericId });
      }
    }
  }

  // Priority 4: Fallback to public profile URL (UNSTABLE)
  if (!person_id && (webhookData.PublicProfile || webhookData['Profile URL'] || webhookData.Profile)) {
    const publicUrl = webhookData.PublicProfile || webhookData['Profile URL'] || webhookData.Profile;
    const normalizedUrl = extractPublicProfileUrl(publicUrl);

    if (normalizedUrl) {
      person_id = normalizedUrl; // Temporary ID
      source = 'publicUrl';
      primaryIdType = 'publicUrl';
      aliases.push({ type: 'publicUrl', value: normalizedUrl });

      logger.warn('Using unstable public URL as person_id - no stable ID found', {
        publicUrl: normalizedUrl,
        webhookData: {
          Profile: webhookData.Profile,
          PublicProfile: webhookData.PublicProfile,
          SalesProfile: webhookData.SalesProfile,
        },
      });
    }
  }

  // Add all profile URLs as aliases
  if (webhookData.Profile && !aliases.find(a => a.value === webhookData.Profile)) {
    const profileUrl = extractPublicProfileUrl(webhookData.Profile);
    if (profileUrl) {
      aliases.push({ type: 'publicUrl', value: profileUrl });
    }
  }

  if (webhookData.PublicProfile && !aliases.find(a => a.value === webhookData.PublicProfile)) {
    const publicUrl = extractPublicProfileUrl(webhookData.PublicProfile);
    if (publicUrl) {
      aliases.push({ type: 'publicUrl', value: publicUrl });
    }
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
 * @param {Object} webhookData - Visit or Scan webhook payload
 * @returns {Object} { company_id, aliases, source }
 */
function resolveCompanyIdentity(webhookData) {
  const aliases = [];
  let company_id = null;
  let source = null;
  let primaryIdType = null;

  // Priority 1: CompanyID field (numeric ID)
  if (webhookData.CompanyID) {
    const numericId = extractCompanyId(webhookData.CompanyID);
    if (numericId) {
      company_id = numericId;
      source = 'numericId';
      primaryIdType = 'numericId';
      aliases.push({ type: 'numericId', value: numericId });
    }
  }

  // Priority 2: Company profile URL as fallback
  if (webhookData.CompanyProfile) {
    const profileUrl = extractCompanyProfileUrl(webhookData.CompanyProfile) || webhookData.CompanyProfile;
    if (!company_id && profileUrl) {
      company_id = profileUrl;
      source = 'profileUrl';
      primaryIdType = 'profileUrl';
    }
    if (profileUrl) {
      aliases.push({ type: 'profileUrl', value: profileUrl });
    }
  }

  // Priority 3: Company name as fallback
  if (!company_id && webhookData.Company) {
    const name = webhookData.Company.trim();
    if (name) {
      company_id = name;
      source = 'name';
      primaryIdType = 'name';
      aliases.push({ type: 'name', value: name });
    }
  } else if (webhookData.Company) {
    const name = webhookData.Company.trim();
    if (name && !aliases.find(a => a.value === name)) {
      aliases.push({ type: 'name', value: name });
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
  if (!value || typeof value !== 'string') return null;

  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-.,]/g, '');
}

function slugifyLocation(value) {
  if (!value) return null;
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
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
    };
  }

  const slug = slugifyLocation(normalized);
  const canonicalKey = buildCanonicalKey('location', slug);

  return {
    location_id: slug,
    aliases: [
      { type: 'raw', value: locationValue },
      { type: 'normalized', value: normalized },
    ],
    source: 'normalized',
    primary_id_type: 'location',
    canonical_key: canonicalKey,
    canonical_id: computeCanonicalId(canonicalKey),
    normalized,
  };
}
module.exports = {
  extractSalesNavId,
  extractNumericId,
  extractPublicProfileUrl,
  extractCompanyId,
  extractCompanyProfileUrl,
  buildCanonicalKey,
  computeCanonicalId,
  resolvePersonIdentity,
  resolveCompanyIdentity,
  normalizeLocationName,
  resolveLocationIdentity,
};
