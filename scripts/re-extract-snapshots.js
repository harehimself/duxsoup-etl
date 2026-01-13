#!/usr/bin/env node
/**
 * Re-Extract Snapshots
 * Re-runs upsertFromObservation for people with missing data
 * This fixes cases where Phase 1 (save observation) succeeded but Phase 2 (person upsert) failed
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

async function reExtractSnapshots() {
  console.log('━'.repeat(70));
  console.log(`  RE-EXTRACT SNAPSHOTS ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  // Find people with missing critical data who have observations
  // Highest priority: people missing names who have observations to recover from
  const peopleNeedingReExtraction = await Person.find({
    $and: [
      {
        $or: [
          { 'snapshot.fullName': { $exists: false } },
          { 'snapshot.fullName': null },
          { 'snapshot.fullName': '' }
        ]
      },
      {
        $or: [
          { 'observations.visits.0': { $exists: true } },
          { 'observations.scans.0': { $exists: true } }
        ]
      }
    ]
  }).lean();

  console.log(`Found ${peopleNeedingReExtraction.length} people needing re-extraction\n`);

  if (isDryRun) {
    console.log('Sample people (first 5):');
    peopleNeedingReExtraction.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p._id}`);
      console.log(`     fullName: ${p.snapshot?.fullName || 'MISSING'}`);
      console.log(`     Has ${p.observations?.visits?.length || 0} visits, ${p.observations?.scans?.length || 0} scans`);
    });
    console.log(`\n✓ Dry run complete. Run without --dry-run to fix ${peopleNeedingReExtraction.length} people.\n`);
    return;
  }

  // Re-extract from observations
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const person of peopleNeedingReExtraction) {
    try {
      // Prioritize visits (richer data)
      if (person.observations?.visits?.length > 0) {
        const visitId = person.observations.visits[0];
        const visit = await Visit.findById(visitId);

        if (visit) {
          await upsertFromObservation(visit, 'visit');
          successCount++;
        } else {
          console.warn(`⚠ Visit ${visitId} not found for person ${person._id}`);
          errorCount++;
        }
      } else if (person.observations?.scans?.length > 0) {
        const scanId = person.observations.scans[0];
        const scan = await Scan.findById(scanId);

        if (scan) {
          await upsertFromObservation(scan, 'scan');
          successCount++;
        } else {
          console.warn(`⚠ Scan ${scanId} not found for person ${person._id}`);
          errorCount++;
        }
      }

      if (successCount % 50 === 0) {
        console.log(`Progress: ${successCount}/${peopleNeedingReExtraction.length}...`);
      }
    } catch (error) {
      errorCount++;
      errors.push({
        person_id: person._id,
        error: error.message
      });

      if (errors.length <= 10) {
        console.error(`✗ Failed to re-extract ${person._id}: ${error.message}`);
      }
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('RE-EXTRACTION RESULTS:');
  console.log('━'.repeat(70));
  console.log(`✓ Successfully re-extracted: ${successCount}`);
  console.log(`✗ Failed: ${errorCount}`);

  if (errors.length > 10) {
    console.log(`\nFirst 10 errors:`);
    errors.slice(0, 10).forEach(e => {
      console.log(`  ${e.person_id}: ${e.error}`);
    });
  }

  console.log('━'.repeat(70) + '\n');
}

async function run() {
  try {
    await connectDB();
    await reExtractSnapshots();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
