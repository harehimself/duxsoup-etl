const Person = require('../models/person');
const Visit = require('../models/visit');
const Scan = require('../models/scan');
const { getConfig } = require('../utils/env');
const logger = require('../utils/logger');

/**
 * Person Read Service - Hybrid cutover implementation
 *
 * Implements safe, reversible cutover from legacy (visits/scans) to people collection.
 *
 * Read modes (controlled by READ_SOURCE env):
 * - hybrid (default): Try people first, fallback to legacy if not found
 * - people: People-only (no fallback)
 * - legacy: Old behavior (visits/scans only)
 */

// Metrics tracking (in-memory, reset on restart)
const metrics = {
  people_read_attempts: 0,
  people_read_success: 0,
  people_read_not_found: 0,
  legacy_fallback_hits: 0,
  legacy_fallback_success: 0,
  legacy_fallback_not_found: 0,
  last_reset: new Date(),
};

/**
 * Reset metrics (for testing or daily reset)
 */
function resetMetrics() {
  metrics.people_read_attempts = 0;
  metrics.people_read_success = 0;
  metrics.people_read_not_found = 0;
  metrics.legacy_fallback_hits = 0;
  metrics.legacy_fallback_success = 0;
  metrics.legacy_fallback_not_found = 0;
  metrics.last_reset = new Date();
}

/**
 * Get current metrics
 */
function getMetrics() {
  const total = metrics.people_read_attempts;
  const fallbackRate = total > 0 ? (metrics.legacy_fallback_hits / total) * 100 : 0;
  const successRate = total > 0 ? (metrics.people_read_success / total) * 100 : 0;
  const notFoundRate = total > 0 ? (metrics.people_read_not_found / total) * 100 : 0;

  return {
    ...metrics,
    people_read_success_rate: Math.round(successRate * 100) / 100,
    people_read_not_found_rate: Math.round(notFoundRate * 100) / 100,
    legacy_fallback_hit_rate: Math.round(fallbackRate * 100) / 100,
  };
}

/**
 * Find person by canonical ID (from people collection)
 */
async function findPersonById(personId) {
  const config = getConfig();
  metrics.people_read_attempts++;

  // Mode: legacy - skip people entirely
  if (config.readSource === 'legacy') {
    logger.debug('Read mode: legacy, skipping people collection', { personId });
    return await findPersonFromLegacy(personId);
  }

  // Try people collection first
  const person = await Person.findOne({ canonical_id: personId }) || await Person.findById(personId);

  if (person) {
    metrics.people_read_success++;
    logger.debug('Person found in people collection', { personId });
    return {
      source: 'people',
      person,
    };
  }

  // Not found in people
  metrics.people_read_not_found++;

  // Mode: people-only - no fallback
  if (config.readSource === 'people') {
    logger.debug('Person not found, people-only mode (no fallback)', { personId });
    return null;
  }

  // Mode: hybrid - fallback to legacy
  metrics.legacy_fallback_hits++;

  logger.warn('FALLBACK_TO_LEGACY', {
    person_id: personId,
    reason: 'not_found',
    endpoint: 'findPersonById',
    read_source: config.readSource,
  });

  return await findPersonFromLegacy(personId);
}

/**
 * Find person by alias (Sales Nav ID, numeric ID, or public URL)
 */
async function findPersonByAlias(aliasValue) {
  const config = getConfig();
  metrics.people_read_attempts++;

  // Mode: legacy - skip people entirely
  if (config.readSource === 'legacy') {
    logger.debug('Read mode: legacy, skipping people collection', { aliasValue });
    return await findPersonFromLegacyByProfile(aliasValue);
  }

  // Try people collection first (search by alias)
  const person = await Person.findOne({
    'aliases.value': aliasValue,
  });

  if (person) {
    metrics.people_read_success++;
    logger.debug('Person found by alias in people collection', { aliasValue });
    return {
      source: 'people',
      person,
    };
  }

  // Not found in people
  metrics.people_read_not_found++;

  // Mode: people-only - no fallback
  if (config.readSource === 'people') {
    logger.debug('Person not found by alias, people-only mode (no fallback)', { aliasValue });
    return null;
  }

  // Mode: hybrid - fallback to legacy
  metrics.legacy_fallback_hits++;

  logger.warn('FALLBACK_TO_LEGACY', {
    alias_value: aliasValue,
    reason: 'not_found',
    endpoint: 'findPersonByAlias',
    read_source: config.readSource,
  });

  return await findPersonFromLegacyByProfile(aliasValue);
}

/**
 * Legacy fallback: Find person from visits/scans by canonical ID
 * This is a simplified legacy read - adapt to your actual legacy logic
 */
async function findPersonFromLegacy(personId) {
  // Try to find visits or scans for this person
  // Note: This is a simplified example - adjust based on your actual legacy structure

  const [visits, scans] = await Promise.all([
    Visit.find({ Profile: personId }).limit(10).lean(),
    Scan.find({ Profile: personId }).limit(10).lean(),
  ]);

  if (visits.length === 0 && scans.length === 0) {
    metrics.legacy_fallback_not_found++;
    logger.debug('Person not found in legacy either', { personId });
    return null;
  }

  metrics.legacy_fallback_success++;

  // Derive person data from latest visit/scan
  const latestObservation = visits[0] || scans[0];

  logger.debug('Person found in legacy (derived from observations)', {
    personId,
    visits: visits.length,
    scans: scans.length,
  });

  return {
    source: 'legacy',
    person: deriveLegacyPerson(latestObservation, visits, scans),
  };
}

/**
 * Legacy fallback: Find person by profile URL from visits/scans
 */
async function findPersonFromLegacyByProfile(profileValue) {
  const [visits, scans] = await Promise.all([
    Visit.find({ Profile: profileValue }).limit(10).lean(),
    Scan.find({ Profile: profileValue }).limit(10).lean(),
  ]);

  if (visits.length === 0 && scans.length === 0) {
    metrics.legacy_fallback_not_found++;
    logger.debug('Person not found in legacy by profile', { profileValue });
    return null;
  }

  metrics.legacy_fallback_success++;

  const latestObservation = visits[0] || scans[0];

  logger.debug('Person found in legacy by profile', {
    profileValue,
    visits: visits.length,
    scans: scans.length,
  });

  return {
    source: 'legacy',
    person: deriveLegacyPerson(latestObservation, visits, scans),
  };
}

/**
 * Derive person object from legacy observations
 * Mimics old behavior for backwards compatibility
 */
function deriveLegacyPerson(latestObs, visits, scans) {
  return {
    _id: latestObs.Profile,
    profile: latestObs.Profile,
    firstName: latestObs['First Name'],
    lastName: latestObs['Last Name'],
    currentTitle: latestObs.Title,
    currentCompany: latestObs.Company,
    location: latestObs.Location,
    degree: latestObs.Degree,
    observations: {
      visits_count: visits.length,
      scans_count: scans.length,
      latest_visit: visits[0]?.VisitTime,
      latest_scan: scans[0]?.ScanTime,
    },
    _legacy_derived: true, // Flag for debugging
  };
}

module.exports = {
  findPersonById,
  findPersonByAlias,
  getMetrics,
  resetMetrics,
};
