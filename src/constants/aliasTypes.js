/**
 * Alias Type Taxonomy
 *
 * Defines all supported alias types for Person, Company, and Location entities.
 * Used for consistent identity resolution across the system.
 */

/**
 * Person Alias Types
 * Used to track different identifiers for the same person
 */
const PERSON_ALIAS_TYPES = {
  SALES_NAV_ID: 'salesNavId',      // Sales Navigator person ID (ACwAAA* or ACoAAA*) - MOST STABLE
  NUMERIC_ID: 'numericId',          // LinkedIn numeric member ID (e.g., 12345678) - STABLE
  PUBLIC_URL: 'publicUrl',          // Public profile URL slug (e.g., linkedin.com/in/johndoe) - UNSTABLE
  SALES_URL: 'salesUrl',            // Full Sales Navigator URL
  RECRUITER_URL: 'recruiterUrl',    // Full Recruiter profile URL
};

/**
 * Company Alias Types
 * Used to track different identifiers for the same company
 */
const COMPANY_ALIAS_TYPES = {
  NUMERIC_ID: 'numericId',          // LinkedIn numeric company ID - MOST STABLE
  PROFILE_URL: 'profileUrl',        // Company profile URL (linkedin.com/company/*)
  NAME: 'name',                     // Company name (normalized) - LEAST STABLE
};

/**
 * Location Alias Types
 * Used to track different representations of the same location
 */
const LOCATION_ALIAS_TYPES = {
  RAW: 'raw',                       // Raw location string from webhook
  NORMALIZED: 'normalized',         // Normalized/slugified location string
};

/**
 * Get all valid alias types for a given entity type
 * @param {string} entityType - 'person', 'company', or 'location'
 * @returns {string[]} Array of valid alias type values
 */
function getAliasTypesForEntity(entityType) {
  switch (entityType) {
    case 'person':
      return Object.values(PERSON_ALIAS_TYPES);
    case 'company':
      return Object.values(COMPANY_ALIAS_TYPES);
    case 'location':
      return Object.values(LOCATION_ALIAS_TYPES);
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

/**
 * Check if an alias type is valid for a given entity
 * @param {string} entityType - 'person', 'company', or 'location'
 * @param {string} aliasType - The alias type to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidAliasType(entityType, aliasType) {
  const validTypes = getAliasTypesForEntity(entityType);
  return validTypes.includes(aliasType);
}

/**
 * Get the stability ranking for person alias types
 * Higher number = more stable identifier
 * @param {string} aliasType - Person alias type
 * @returns {number} Stability score (0-5)
 */
function getPersonAliasStability(aliasType) {
  const stability = {
    [PERSON_ALIAS_TYPES.SALES_NAV_ID]: 5,
    [PERSON_ALIAS_TYPES.NUMERIC_ID]: 4,
    [PERSON_ALIAS_TYPES.RECRUITER_URL]: 3,
    [PERSON_ALIAS_TYPES.SALES_URL]: 2,
    [PERSON_ALIAS_TYPES.PUBLIC_URL]: 1,
  };
  return stability[aliasType] || 0;
}

module.exports = {
  PERSON_ALIAS_TYPES,
  COMPANY_ALIAS_TYPES,
  LOCATION_ALIAS_TYPES,
  getAliasTypesForEntity,
  isValidAliasType,
  getPersonAliasStability,
};
