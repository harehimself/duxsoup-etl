#!/usr/bin/env node
/**
 * Link Orphaned Observations
 * Finds visits/scans not referenced by any person and links them to the correct person
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const { resolvePersonIdentity } = require('../src/utils/identityMatcher');
const identityResolverService = require('../src/services/identityResolverService');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function findOrphanedObservations() {
  console.log('Finding orphaned observations...\n');

  // Get all observation IDs referenced by people
  const referencedVisitIds = new Set();
  const referencedScanIds = new Set();

  const people = await Person.find({}, { 'observations.visits': 1, 'observations.scans': 1 }).lean();

  people.forEach(person => {
    person.observations?.visits?.forEach(id => referencedVisitIds.add(id.toString()));
    person.observations?.scans?.forEach(id => referencedScanIds.add(id.toString()));
  });

  console.log(`Found ${referencedVisitIds.size} referenced visits`);
  console.log(`Found ${referencedScanIds.size} referenced scans\n`);

  // Find visits not in the referenced set
  const allVisits = await Visit.find({}, { _id: 1 }).lean();
  const orphanedVisits = allVisits.filter(v => !referencedVisitIds.has(v._id.toString()));

  // Find scans not in the referenced set
  const allScans = await Scan.find({}, { _id: 1 }).lean();
  const orphanedScans = allScans.filter(s => !referencedScanIds.has(s._id.toString()));

  console.log(`Found ${orphanedVisits.length} orphaned visits`);
  console.log(`Found ${orphanedScans.length} orphaned scans\n`);

  return {
    visits: orphanedVisits.map(v => v._id),
    scans: orphanedScans.map(s => s._id)
  };
}

async function linkOrphanedObservations() {
  console.log('━'.repeat(70));
  console.log(`  LINK ORPHANED OBSERVATIONS ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  const orphaned = await findOrphanedObservations();
  const totalOrphaned = orphaned.visits.length + orphaned.scans.length;

  if (totalOrphaned === 0) {
    console.log('✓ No orphaned observations found!\n');
    return;
  }

  const stats = {
    total: totalOrphaned,
    linked: 0,
    noIdentity: 0,
    personNotFound: 0,
    alreadyLinked: 0,
    errors: 0
  };

  const updates = [];

  // Process orphaned visits
  console.log('Processing orphaned visits...');
  for (const visitId of orphaned.visits) {
    try {
      const visit = await Visit.findById(visitId).lean();
      if (!visit) {
        stats.errors++;
        continue;
      }

      // Resolve identity from visit data
      const identity = resolvePersonIdentity(visit);

      if (!identity.person_id) {
        stats.noIdentity++;
        if (stats.noIdentity <= 5) {
          console.log(`⚠ Visit ${visitId} has no stable identity`);
        }
        continue;
      }

      // Find the person
      const person = await Person.findById(identity.person_id).lean();

      if (!person) {
        stats.personNotFound++;
        if (stats.personNotFound <= 5) {
          console.log(`⚠ Person ${identity.person_id} not found for visit ${visitId}`);
        }
        continue;
      }

      // Check if already linked (shouldn't happen but be safe)
      const alreadyLinked = person.observations?.visits?.some(id => id.toString() === visitId.toString());
      if (alreadyLinked) {
        stats.alreadyLinked++;
        continue;
      }

      updates.push({
        personId: person._id,
        observationType: 'visit',
        observationId: visitId
      });

      stats.linked++;

      if (stats.linked % 100 === 0) {
        console.log(`  Progress: ${stats.linked} linked...`);
      }
    } catch (error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`✗ Error processing visit ${visitId}: ${error.message}`);
      }
    }
  }

  // Process orphaned scans
  console.log('\nProcessing orphaned scans...');
  for (const scanId of orphaned.scans) {
    try {
      const scan = await Scan.findById(scanId).lean();
      if (!scan) {
        stats.errors++;
        continue;
      }

      // Resolve identity from scan data
      const identity = resolvePersonIdentity(scan);

      if (!identity.person_id) {
        stats.noIdentity++;
        if (stats.noIdentity <= 5) {
          console.log(`⚠ Scan ${scanId} has no stable identity`);
        }
        continue;
      }

      // Find the person
      const person = await Person.findById(identity.person_id).lean();

      if (!person) {
        stats.personNotFound++;
        if (stats.personNotFound <= 5) {
          console.log(`⚠ Person ${identity.person_id} not found for scan ${scanId}`);
        }
        continue;
      }

      // Check if already linked
      const alreadyLinked = person.observations?.scans?.some(id => id.toString() === scanId.toString());
      if (alreadyLinked) {
        stats.alreadyLinked++;
        continue;
      }

      updates.push({
        personId: person._id,
        observationType: 'scan',
        observationId: scanId
      });

      stats.linked++;

      if (stats.linked % 100 === 0) {
        console.log(`  Progress: ${stats.linked} linked...`);
      }
    } catch (error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`✗ Error processing scan ${scanId}: ${error.message}`);
      }
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('LINKING SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total orphaned: ${stats.total}`);
  console.log(`Can be linked: ${stats.linked}`);
  console.log(`No stable identity: ${stats.noIdentity}`);
  console.log(`Person not found: ${stats.personNotFound}`);
  console.log(`Already linked: ${stats.alreadyLinked}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log(`✓ Dry run complete. Run without --dry-run to link ${updates.length} observations.\n`);

    if (updates.length > 0) {
      console.log('Sample updates (first 5):');
      updates.slice(0, 5).forEach((u, i) => {
        console.log(`  ${i + 1}. Link ${u.observationType} ${u.observationId} → person ${u.personId}`);
      });
      console.log('');
    }
  } else {
    // Execute updates
    console.log(`Linking ${updates.length} observations...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      try {
        const field = update.observationType === 'visit'
          ? 'observations.visits'
          : 'observations.scans';

        // Use $push with $slice to cap array size (prevents unbounded growth)
        const { MAX_OBSERVATION_REFS } = require('../src/constants/limits');
        await Person.updateOne(
          { _id: update.personId },
          {
            $push: {
              [field]: {
                $each: [update.observationId],
                $slice: -MAX_OBSERVATION_REFS
              }
            }
          }
        );

        successCount++;

        if (successCount % 100 === 0) {
          console.log(`  ${successCount}/${updates.length} linked...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to link ${update.observationType} ${update.observationId}: ${error.message}`);
      }
    }

    console.log('\n' + '━'.repeat(70));
    console.log('LINKING RESULTS:');
    console.log('━'.repeat(70));
    console.log(`✓ Successfully linked: ${successCount} observations`);
    console.log(`✓ Orphaned observations recovered`);
    if (errorCount > 0) {
      console.log(`✗ Failed: ${errorCount}`);
    }

    if (stats.noIdentity > 0) {
      console.log(`\n⚠ ${stats.noIdentity} observations couldn't be linked (no stable identity)`);
      console.log('  These may need manual review or identity resolution');
    }

    if (stats.personNotFound > 0) {
      console.log(`\n⚠ ${stats.personNotFound} observations reference non-existent people`);
      console.log('  These may need person records created first');
    }

    console.log('━'.repeat(70) + '\n');
  }
}

async function run() {
  try {
    await connectDB();
    await linkOrphanedObservations();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
