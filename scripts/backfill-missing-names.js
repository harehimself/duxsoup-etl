#!/usr/bin/env node
/**
 * Backfill Missing Names
 * Recovers missing fullName from observation data (visits/scans)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

// Check for --dry-run flag
const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB\n`);
}

async function backfillMissingNames() {
  console.log('━'.repeat(60));
  console.log(`  BACKFILL MISSING NAMES ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(60) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  // Find all people without names
  const peopleWithoutNames = await Person.find({
    $or: [
      { 'snapshot.fullName': { $exists: false } },
      { 'snapshot.fullName': '' },
      { 'snapshot.fullName': null }
    ]
  }).lean();

  console.log(`Found ${peopleWithoutNames.length} people without names\n`);

  let recovered = 0;
  let failed = 0;
  let noObservations = 0;

  const updates = [];

  for (const person of peopleWithoutNames) {
    let firstName = null;
    let lastName = null;
    let middleName = null;
    let source = null;
    let observationId = null;

    // Try to get name from visits first
    if (person.observations?.visits?.length > 0) {
      const visitId = person.observations.visits[0];
      const visit = await Visit.findById(visitId).lean();

      if (visit) {
        firstName = visit['First Name'];
        lastName = visit['Last Name'];
        middleName = visit['Middle Name'];
        source = 'visit';
        observationId = visitId;
      }
    }

    // If not found in visits, try scans
    if (!firstName && person.observations?.scans?.length > 0) {
      const scanId = person.observations.scans[0];
      const scan = await Scan.findById(scanId).lean();

      if (scan) {
        firstName = scan['First Name'];
        lastName = scan['Last Name'];
        middleName = scan['Middle Name'];
        source = 'scan';
        observationId = scanId;
      }
    }

    // Build full name
    const fullName = [firstName, middleName, lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      // Prepare update
      const update = {
        $set: {
          'snapshot.firstName': firstName || '',
          'snapshot.lastName': lastName || '',
          'snapshot.middleName': middleName || '',
          'snapshot.fullName': fullName,
        }
      };

      // Also add to _meta if not exists
      if (!person.snapshot?._meta?.fullName) {
        update.$set['snapshot._meta.fullName'] = {
          value: fullName,
          observedAt: Date.now(),
          source: source,
          observationId: observationId
        };
      }

      updates.push({
        personId: person._id,
        canonicalId: person.canonical_id,
        fullName: fullName,
        update: update
      });

      recovered++;

      if (!isDryRun && recovered % 50 === 0) {
        console.log(`Progress: ${recovered}/${peopleWithoutNames.length} recovered...`);
      }
    } else if (!person.observations?.visits?.length && !person.observations?.scans?.length) {
      noObservations++;
      if (isDryRun) {
        console.log(`⚠ Cannot recover: ${person._id} (no observations)`);
      }
    } else {
      failed++;
      if (isDryRun) {
        console.log(`✗ Cannot recover: ${person._id} (observations exist but no name data)`);
      }
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('BACKFILL SUMMARY:');
  console.log('━'.repeat(60));
  console.log(`Total people without names: ${peopleWithoutNames.length}`);
  console.log(`Recoverable: ${recovered}`);
  console.log(`No observations: ${noObservations}`);
  console.log(`Failed (has observations but no name): ${failed}`);
  console.log('━'.repeat(60) + '\n');

  if (isDryRun) {
    console.log('✓ Dry run complete. No changes made.');
    console.log(`\nRun without --dry-run to apply ${recovered} updates.\n`);

    // Show sample of what would be updated
    if (updates.length > 0) {
      console.log('Sample updates (first 5):');
      updates.slice(0, 5).forEach((u, i) => {
        console.log(`\n${i + 1}. ${u.personId}`);
        console.log(`   canonical_id: ${u.canonicalId}`);
        console.log(`   → Will set fullName to: "${u.fullName}"`);
      });
    }
  } else {
    // Execute updates
    console.log(`Executing ${updates.length} updates...`);

    let successCount = 0;
    let errorCount = 0;

    for (const updateItem of updates) {
      try {
        await Person.updateOne(
          { _id: updateItem.personId },
          updateItem.update
        );
        successCount++;

        if (successCount % 50 === 0) {
          console.log(`  ${successCount}/${updates.length} updated...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to update ${updateItem.personId}: ${error.message}`);
      }
    }

    console.log('\n' + '━'.repeat(60));
    console.log('UPDATE RESULTS:');
    console.log('━'.repeat(60));
    console.log(`✓ Successfully updated: ${successCount}`);
    if (errorCount > 0) {
      console.log(`✗ Failed: ${errorCount}`);
    }
    console.log('━'.repeat(60) + '\n');
  }
}

async function run() {
  try {
    await connectDB();
    await backfillMissingNames();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
