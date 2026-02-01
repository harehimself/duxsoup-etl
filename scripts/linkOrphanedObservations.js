/**
 * Link Orphaned Observations to Existing People
 *
 * Finds visits and scans that are not referenced by any person document
 * and attempts to link them to existing people based on identifier matching.
 *
 * Strategy:
 * 1. Find all orphaned observations (not in any person.observations array)
 * 2. For each orphan, extract identifiers (salesNavId, numericId, linkedInUsername)
 * 3. Find matching person by aliases
 * 4. Link observation to person if exactly 1 match found
 * 5. Report unresolvable and ambiguous cases
 *
 * Usage:
 *   node scripts/linkOrphanedObservations.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Don't make any changes, just report what would happen
 *   --limit N   Process only first N orphaned observations (for testing)
 */

const mongoose = require('mongoose');
const database = require('../src/utils/database');
const logger = require('../src/utils/logger');
const identityMatcher = require('../src/utils/identityMatcher');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : null;

/**
 * Get all visit IDs referenced by people
 */
async function getReferencedVisitIds() {
  const result = await Person.aggregate([
    { $unwind: '$observations.visits' },
    { $group: { _id: null, refs: { $addToSet: '$observations.visits' } } },
  ]);

  return result.length > 0 ? result[0].refs : [];
}

/**
 * Get all scan IDs referenced by people
 */
async function getReferencedScanIds() {
  const result = await Person.aggregate([
    { $unwind: '$observations.scans' },
    { $group: { _id: null, refs: { $addToSet: '$observations.scans' } } },
  ]);

  return result.length > 0 ? result[0].refs : [];
}

/**
 * Get all orphaned visit IDs (visits not referenced by any person)
 */
async function getOrphanedVisitIds(referencedIds) {
  const referencedSet = new Set(referencedIds.map((id) => id.toString()));

  const allVisits = await Visit.find({}, { _id: 1 }).lean();

  const orphanedIds = allVisits
    .filter((visit) => !referencedSet.has(visit._id.toString()))
    .map((visit) => visit._id);

  return orphanedIds;
}

/**
 * Get all orphaned scan IDs (scans not referenced by any person)
 */
async function getOrphanedScanIds(referencedIds) {
  const referencedSet = new Set(referencedIds.map((id) => id.toString()));

  const allScans = await Scan.find({}, { _id: 1 }).lean();

  const orphanedIds = allScans
    .filter((scan) => !referencedSet.has(scan._id.toString()))
    .map((scan) => scan._id);

  return orphanedIds;
}

/**
 * Extract identifiers from observation document
 */
function extractIdentifiersFromObservation(observation) {
  const identifiers = identityMatcher.extractIdentifiers(observation);

  return {
    salesNavId: identifiers.salesNavId || null,
    numericId: identifiers.numericId || null,
    linkedInUsername: identifiers.linkedInUsername || null,
    vanityName: identifiers.vanityName || null,
    duxsoupId: identifiers.duxsoupId || null,
  };
}

/**
 * Find matching person by aliases or _id
 */
async function findMatchingPerson(identifiers) {
  const aliasValues = [];

  if (identifiers.salesNavId) aliasValues.push(identifiers.salesNavId);
  if (identifiers.numericId) aliasValues.push(identifiers.numericId);
  if (identifiers.linkedInUsername)
    aliasValues.push(identifiers.linkedInUsername);
  if (identifiers.vanityName) aliasValues.push(identifiers.vanityName);

  if (aliasValues.length === 0) {
    return { matchCount: 0, people: [] };
  }

  // Search by both aliases AND _id (in case person was created with stable ID as _id)
  const people = await Person.find({
    $or: [
      {
        aliases: {
          $elemMatch: {
            type: {
              $in: ['salesNavId', 'numericId', 'linkedInUsername', 'vanityName'],
            },
            value: { $in: aliasValues },
          },
        },
      },
      { _id: { $in: aliasValues } },
    ],
  }).lean();

  return { matchCount: people.length, people };
}

/**
 * Link observation to person
 */
async function linkObservationToPerson(personId, observationId, observationType) {
  if (isDryRun) {
    logger.info('[DRY-RUN] Would link observation to person', {
      personId,
      observationId: observationId.toString(),
      observationType,
    });
    return;
  }

  const updateField =
    observationType === 'visit'
      ? 'observations.visits'
      : 'observations.scans';

  const result = await Person.updateOne(
    { _id: personId },
    {
      $addToSet: { [updateField]: observationId },
      $inc: { 'meta.observationsCount': 1 },
    }
  );

  logger.info('Linked observation to person', {
    personId,
    observationId: observationId.toString(),
    observationType,
    modifiedCount: result.modifiedCount,
  });
}

/**
 * Process orphaned visits
 */
async function processOrphanedVisits(orphanedIds) {
  const results = {
    total: orphanedIds.length,
    linked: 0,
    ambiguous: 0,
    unresolvable: 0,
    linkedSamples: [],
    ambiguousSamples: [],
    unresolvableSamples: [],
  };

  const processIds = limit ? orphanedIds.slice(0, limit) : orphanedIds;

  logger.info(`Processing ${processIds.length} orphaned visits...`);

  for (const visitId of processIds) {
    const visit = await Visit.findById(visitId).lean();
    if (!visit) {
      logger.warn('Orphaned visit not found', { visitId: visitId.toString() });
      continue;
    }

    const identifiers = extractIdentifiersFromObservation(visit);
    const { matchCount, people } = await findMatchingPerson(identifiers);

    if (matchCount === 1) {
      // Single match - link it
      await linkObservationToPerson(people[0]._id, visitId, 'visit');
      results.linked++;

      if (results.linkedSamples.length < 5) {
        results.linkedSamples.push({
          observationId: visitId.toString(),
          personId: people[0]._id,
          matchType: identifiers.salesNavId
            ? 'salesNavId'
            : identifiers.numericId
              ? 'numericId'
              : 'linkedInUsername',
        });
      }
    } else if (matchCount > 1) {
      // Multiple matches - ambiguous
      results.ambiguous++;

      if (results.ambiguousSamples.length < 5) {
        results.ambiguousSamples.push({
          observationId: visitId.toString(),
          matchCount,
          identifiers,
          peopleIds: people.map((p) => p._id),
        });
      }

      logger.warn('Ambiguous match for orphaned visit', {
        visitId: visitId.toString(),
        matchCount,
        identifiers,
      });
    } else {
      // No match - unresolvable
      results.unresolvable++;

      if (results.unresolvableSamples.length < 5) {
        results.unresolvableSamples.push({
          observationId: visitId.toString(),
          identifiers,
        });
      }

      logger.warn('Unresolvable orphaned visit', {
        visitId: visitId.toString(),
        identifiers,
      });
    }
  }

  return results;
}

/**
 * Process orphaned scans
 */
async function processOrphanedScans(orphanedIds) {
  const results = {
    total: orphanedIds.length,
    linked: 0,
    ambiguous: 0,
    unresolvable: 0,
    linkedSamples: [],
    ambiguousSamples: [],
    unresolvableSamples: [],
  };

  const processIds = limit ? orphanedIds.slice(0, limit) : orphanedIds;

  logger.info(`Processing ${processIds.length} orphaned scans...`);

  for (const scanId of processIds) {
    const scan = await Scan.findById(scanId).lean();
    if (!scan) {
      logger.warn('Orphaned scan not found', { scanId: scanId.toString() });
      continue;
    }

    const identifiers = extractIdentifiersFromObservation(scan);
    const { matchCount, people } = await findMatchingPerson(identifiers);

    if (matchCount === 1) {
      // Single match - link it
      await linkObservationToPerson(people[0]._id, scanId, 'scan');
      results.linked++;

      if (results.linkedSamples.length < 5) {
        results.linkedSamples.push({
          observationId: scanId.toString(),
          personId: people[0]._id,
          matchType: identifiers.salesNavId
            ? 'salesNavId'
            : identifiers.numericId
              ? 'numericId'
              : 'linkedInUsername',
        });
      }
    } else if (matchCount > 1) {
      // Multiple matches - ambiguous
      results.ambiguous++;

      if (results.ambiguousSamples.length < 5) {
        results.ambiguousSamples.push({
          observationId: scanId.toString(),
          matchCount,
          identifiers,
          peopleIds: people.map((p) => p._id),
        });
      }

      logger.warn('Ambiguous match for orphaned scan', {
        scanId: scanId.toString(),
        matchCount,
        identifiers,
      });
    } else {
      // No match - unresolvable
      results.unresolvable++;

      if (results.unresolvableSamples.length < 5) {
        results.unresolvableSamples.push({
          observationId: scanId.toString(),
          identifiers,
        });
      }

      logger.warn('Unresolvable orphaned scan', {
        scanId: scanId.toString(),
        identifiers,
      });
    }
  }

  return results;
}

/**
 * Print results report
 */
function printReport(visitResults, scanResults) {
  console.log('\n' + '='.repeat(80));
  console.log('ORPHAN LINKING RESULTS');
  console.log('='.repeat(80));

  if (isDryRun) {
    console.log('\n🔍 DRY-RUN MODE - No changes were made\n');
  }

  console.log('\nVisits:');
  console.log(`  Total orphaned: ${visitResults.total}`);
  console.log(`  Successfully linked: ${visitResults.linked}`);
  console.log(`  Ambiguous (multiple matches): ${visitResults.ambiguous}`);
  console.log(`  Unresolvable (no match): ${visitResults.unresolvable}`);

  console.log('\nScans:');
  console.log(`  Total orphaned: ${scanResults.total}`);
  console.log(`  Successfully linked: ${scanResults.linked}`);
  console.log(`  Ambiguous (multiple matches): ${scanResults.ambiguous}`);
  console.log(`  Unresolvable (no match): ${scanResults.unresolvable}`);

  if (visitResults.linkedSamples.length > 0) {
    console.log('\nSample linked visits (first 5):');
    visitResults.linkedSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} → ${sample.personId} (${sample.matchType})`
      );
    });
  }

  if (scanResults.linkedSamples.length > 0) {
    console.log('\nSample linked scans (first 5):');
    scanResults.linkedSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} → ${sample.personId} (${sample.matchType})`
      );
    });
  }

  if (visitResults.unresolvableSamples.length > 0) {
    console.log('\nSample unresolvable visits (first 5):');
    visitResults.unresolvableSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} | identifiers: ${JSON.stringify(sample.identifiers)}`
      );
    });
  }

  if (scanResults.unresolvableSamples.length > 0) {
    console.log('\nSample unresolvable scans (first 5):');
    scanResults.unresolvableSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} | identifiers: ${JSON.stringify(sample.identifiers)}`
      );
    });
  }

  if (visitResults.ambiguousSamples.length > 0) {
    console.log('\nSample ambiguous visits (first 5):');
    visitResults.ambiguousSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} | ${sample.matchCount} matches | identifiers: ${JSON.stringify(sample.identifiers)}`
      );
    });
  }

  if (scanResults.ambiguousSamples.length > 0) {
    console.log('\nSample ambiguous scans (first 5):');
    scanResults.ambiguousSamples.forEach((sample) => {
      console.log(
        `  - ${sample.observationId} | ${sample.matchCount} matches | identifiers: ${JSON.stringify(sample.identifiers)}`
      );
    });
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    logger.info('Starting orphaned observation linking process', {
      isDryRun,
      limit,
    });

    await database.connect();

    // Step 1: Find orphaned visits
    logger.info('Finding orphaned visits...');
    const referencedVisitIds = await getReferencedVisitIds();
    const orphanedVisitIds = await getOrphanedVisitIds(referencedVisitIds);
    logger.info(`Found ${orphanedVisitIds.length} orphaned visits`);

    // Step 2: Find orphaned scans
    logger.info('Finding orphaned scans...');
    const referencedScanIds = await getReferencedScanIds();
    const orphanedScanIds = await getOrphanedScanIds(referencedScanIds);
    logger.info(`Found ${orphanedScanIds.length} orphaned scans`);

    // Step 3: Process orphaned visits
    const visitResults = await processOrphanedVisits(orphanedVisitIds);

    // Step 4: Process orphaned scans
    const scanResults = await processOrphanedScans(orphanedScanIds);

    // Step 5: Print report
    printReport(visitResults, scanResults);

    logger.info('Orphaned observation linking process completed successfully');
  } catch (error) {
    logger.error('Orphaned observation linking process failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await database.disconnect();
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { main };
