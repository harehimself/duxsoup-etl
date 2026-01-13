#!/usr/bin/env node
/**
 * Re-parse Location Data
 * Updates existing person records with improved location parsing
 *
 * Fixes:
 * - Dallas-Fort Worth Metroplex
 * - New York City Metropolitan Area
 * - Greater Boston/Philadelphia/etc.
 * - Charlotte Metro, etc.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const { parseLocation } = require('../src/utils/location-parser');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function reparseLocations() {
  console.log('━'.repeat(70));
  console.log(`  RE-PARSE LOCATION DATA ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  // Find people with location but missing structured fields
  const peopleNeedingReparse = await Person.find({
    'snapshot.location': { $exists: true, $ne: null, $ne: '' },
    $or: [
      { 'snapshot.country': null },
      { 'snapshot.country': { $exists: false } },
      { 'snapshot.state': null },
      { 'snapshot.state': { $exists: false } }
    ]
  }).lean();

  console.log(`Found ${peopleNeedingReparse.length} people with unparsed locations\n`);

  const stats = {
    total: peopleNeedingReparse.length,
    updated: 0,
    noChange: 0,
    errors: 0,
    byLocationType: {}
  };

  const updates = [];
  const sampleUpdates = [];

  for (const person of peopleNeedingReparse) {
    const rawLocation = person.snapshot.location;

    try {
      // Parse location with improved parser
      const parsed = parseLocation(rawLocation);

      // Check if parsing improved (now has state/country)
      const hasImprovement =
        (parsed.country && !person.snapshot.country) ||
        (parsed.state && !person.snapshot.state) ||
        (parsed.city !== rawLocation); // Successfully extracted city from metro area

      if (hasImprovement) {
        const update = {
          $set: {
            'snapshot.city': parsed.city,
            'snapshot.state': parsed.state,
            'snapshot.stateCode': parsed.stateCode,
            'snapshot.country': parsed.country,
            'snapshot.countryCode': parsed.countryCode,
            'snapshot.province': parsed.province,
            'snapshot.region': parsed.region,
            'snapshot.locationType': parsed.locationType
          }
        };

        updates.push({
          personId: person._id,
          rawLocation: rawLocation,
          update: update
        });

        stats.updated++;
        stats.byLocationType[parsed.locationType] =
          (stats.byLocationType[parsed.locationType] || 0) + 1;

        // Collect samples
        if (sampleUpdates.length < 10) {
          sampleUpdates.push({
            location: rawLocation,
            before: {
              city: person.snapshot.city,
              state: person.snapshot.state,
              country: person.snapshot.country
            },
            after: {
              city: parsed.city,
              state: parsed.state,
              country: parsed.country
            }
          });
        }
      } else {
        stats.noChange++;
      }
    } catch (error) {
      stats.errors++;
      console.error(`✗ Failed to parse location for ${person._id}: ${rawLocation}`);
      console.error(`  Error: ${error.message}`);
    }

    if ((stats.updated + stats.noChange) % 1000 === 0) {
      console.log(`Progress: ${stats.updated + stats.noChange}/${peopleNeedingReparse.length}...`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('RE-PARSE SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total people analyzed: ${stats.total}`);
  console.log(`Will be updated: ${stats.updated}`);
  console.log(`No change needed: ${stats.noChange}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('\nUpdates by location type:');
  Object.entries(stats.byLocationType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('Sample updates (first 10):\n');
    sampleUpdates.forEach((sample, i) => {
      console.log(`${i + 1}. "${sample.location}"`);
      console.log(`   Before: city="${sample.before.city}", state=${sample.before.state}, country=${sample.before.country}`);
      console.log(`   After:  city="${sample.after.city}", state=${sample.after.state}, country=${sample.after.country}`);
      console.log('');
    });

    console.log(`✓ Dry run complete. Run without --dry-run to update ${updates.length} people.\n`);
  } else {
    // Execute updates
    console.log(`Executing ${updates.length} updates...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const updateItem of updates) {
      try {
        await Person.updateOne(
          { _id: updateItem.personId },
          updateItem.update
        );
        successCount++;

        if (successCount % 100 === 0) {
          console.log(`  ${successCount}/${updates.length} updated...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to update ${updateItem.personId}: ${error.message}`);
      }
    }

    console.log('\n' + '━'.repeat(70));
    console.log('UPDATE RESULTS:');
    console.log('━'.repeat(70));
    console.log(`✓ Successfully updated: ${successCount} people`);
    console.log(`✓ Locations now properly parsed`);
    if (errorCount > 0) {
      console.log(`✗ Failed: ${errorCount}`);
    }
    console.log('━'.repeat(70) + '\n');
  }
}

async function run() {
  try {
    await connectDB();
    await reparseLocations();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
