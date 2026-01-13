#!/usr/bin/env node
/**
 * Create Missing People from Orphaned Observations
 * Processes observations that reference non-existent people and creates them
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const { upsertFromObservation } = require('../src/controllers/personController');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function findOrphanedObservations() {
  // Get all observation IDs referenced by people
  const referencedVisitIds = new Set();
  const referencedScanIds = new Set();

  const people = await Person.find({}, { 'observations.visits': 1, 'observations.scans': 1 }).lean();

  people.forEach(person => {
    person.observations?.visits?.forEach(id => referencedVisitIds.add(id.toString()));
    person.observations?.scans?.forEach(id => referencedScanIds.add(id.toString()));
  });

  // Find visits not in the referenced set
  const allVisits = await Visit.find({}, { _id: 1 }).lean();
  const orphanedVisits = allVisits.filter(v => !referencedVisitIds.has(v._id.toString()));

  // Find scans not in the referenced set
  const allScans = await Scan.find({}, { _id: 1 }).lean();
  const orphanedScans = allScans.filter(s => !referencedScanIds.has(s._id.toString()));

  return {
    visits: orphanedVisits.map(v => v._id),
    scans: orphanedScans.map(s => s._id)
  };
}

async function createMissingPeople() {
  console.log('━'.repeat(70));
  console.log(`  CREATE MISSING PEOPLE ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  console.log('Finding orphaned observations...\n');
  const orphaned = await findOrphanedObservations();

  console.log(`Found ${orphaned.visits.length} orphaned visits`);
  console.log(`Found ${orphaned.scans.length} orphaned scans\n`);

  const totalOrphaned = orphaned.visits.length + orphaned.scans.length;

  if (totalOrphaned === 0) {
    console.log('✓ No orphaned observations found!\n');
    return;
  }

  const stats = {
    total: totalOrphaned,
    created: 0,
    enriched: 0,
    noIdentity: 0,
    errors: 0,
    errorTypes: {}
  };

  // Process orphaned visits
  console.log('Processing orphaned visits...');
  for (const visitId of orphaned.visits) {
    try {
      const visit = await Visit.findById(visitId);
      if (!visit) {
        stats.errors++;
        continue;
      }

      if (!isDryRun) {
        // Check if person already exists
        const { resolvePersonIdentity } = require('../src/utils/identityResolver');
        const identity = resolvePersonIdentity(visit);

        if (identity.person_id) {
          const existingPerson = await Person.findById(identity.person_id);

          // Run the full upsert pipeline
          await upsertFromObservation(visit, 'visit');

          if (existingPerson) {
            stats.enriched++;
          } else {
            stats.created++;
          }
        } else {
          stats.noIdentity++;
        }
      } else {
        // In dry run, check if person exists
        const { resolvePersonIdentity } = require('../src/utils/identityResolver');
        const identity = resolvePersonIdentity(visit);

        if (identity.person_id) {
          const existingPerson = await Person.findById(identity.person_id);

          if (existingPerson) {
            stats.enriched++;
          } else {
            stats.created++;
          }
        } else {
          stats.noIdentity++;
        }
      }

      const processed = stats.created + stats.enriched;
      if (processed % 100 === 0 && processed > 0) {
        console.log(`  Progress: ${processed} processed (${stats.created} new, ${stats.enriched} enriched)...`);
      }
    } catch (error) {
      stats.errors++;

      // Track error types
      const errorKey = error.message.substring(0, 50);
      stats.errorTypes[errorKey] = (stats.errorTypes[errorKey] || 0) + 1;

      if (stats.errors <= 5) {
        console.error(`✗ Error processing visit ${visitId}: ${error.message}`);
      }
    }
  }

  // Process orphaned scans
  console.log('\nProcessing orphaned scans...');
  for (const scanId of orphaned.scans) {
    try {
      const scan = await Scan.findById(scanId);
      if (!scan) {
        stats.errors++;
        continue;
      }

      if (!isDryRun) {
        // Check if person already exists
        const { resolvePersonIdentity } = require('../src/utils/identityResolver');
        const identity = resolvePersonIdentity(scan);

        if (identity.person_id) {
          const existingPerson = await Person.findById(identity.person_id);

          // Run the full upsert pipeline
          await upsertFromObservation(scan, 'scan');

          if (existingPerson) {
            stats.enriched++;
          } else {
            stats.created++;
          }
        } else {
          stats.noIdentity++;
        }
      } else {
        // In dry run, check if person exists
        const { resolvePersonIdentity } = require('../src/utils/identityResolver');
        const identity = resolvePersonIdentity(scan);

        if (identity.person_id) {
          const existingPerson = await Person.findById(identity.person_id);

          if (existingPerson) {
            stats.enriched++;
          } else {
            stats.created++;
          }
        } else {
          stats.noIdentity++;
        }
      }

      const processed = stats.created + stats.enriched;
      if (processed % 100 === 0 && processed > 0) {
        console.log(`  Progress: ${processed} processed (${stats.created} new, ${stats.enriched} enriched)...`);
      }
    } catch (error) {
      stats.errors++;

      // Track error types
      const errorKey = error.message.substring(0, 50);
      stats.errorTypes[errorKey] = (stats.errorTypes[errorKey] || 0) + 1;

      if (stats.errors <= 5) {
        console.error(`✗ Error processing scan ${scanId}: ${error.message}`);
      }
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('CREATION SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total orphaned observations: ${stats.total}`);
  console.log(`New people created: ${stats.created}`);
  console.log(`Existing people enriched: ${stats.enriched}`);
  console.log(`Total processed: ${stats.created + stats.enriched}`);
  console.log(`No stable identity: ${stats.noIdentity}`);
  console.log(`Errors: ${stats.errors}`);

  if (Object.keys(stats.errorTypes).length > 0) {
    console.log('\nTop error types:');
    const sortedErrors = Object.entries(stats.errorTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    sortedErrors.forEach(([error, count]) => {
      console.log(`  ${count}x: ${error}...`);
    });
  }

  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log(`✓ Dry run complete. Run without --dry-run to process ${stats.created + stats.enriched} observations.\n`);
    console.log(`  Will create: ${stats.created} new people`);
    console.log(`  Will enrich: ${stats.enriched} existing people\n`);
  } else {
    console.log(`✓ Successfully processed ${stats.created + stats.enriched} orphaned observations\n`);
    console.log(`  Created: ${stats.created} new people`);
    console.log(`  Enriched: ${stats.enriched} existing people\n`);

    if (stats.errors > 0) {
      console.log(`⚠ ${stats.errors} observations failed - these may need manual review\n`);
    }
  }
}

async function run() {
  try {
    await connectDB();
    await createMissingPeople();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
