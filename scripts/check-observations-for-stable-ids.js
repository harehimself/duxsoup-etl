#!/usr/bin/env node
/**
 * Check Observations for Stable IDs
 * For people with URL-based IDs, check their observations for stable identifiers
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function checkObservationsForStableIds() {
  console.log('━'.repeat(70));
  console.log('  CHECK OBSERVATIONS FOR STABLE IDENTIFIERS');
  console.log('━'.repeat(70) + '\n');

  // Find people with URL-based IDs
  const urlBasedPeople = await Person.find({
    _id: /^(https?:\/\/)?(www\.)?linkedin\.com\/in\//i
  }, {
    _id: 1,
    'snapshot.name': 1,
    'observations.visits': 1,
    'observations.scans': 1
  }).limit(100).lean();

  console.log(`Checking first 100 URL-based people for stable IDs in observations...\n`);

  const stats = {
    checked: 0,
    hasSalesNavInObs: 0,
    hasNumericInObs: 0,
    hasBothInObs: 0,
    hasNeitherInObs: 0,
    examples: []
  };

  for (const person of urlBasedPeople) {
    stats.checked++;

    // Get first visit or scan for this person
    let observation = null;
    let obsType = null;

    if (person.observations?.visits?.length > 0) {
      observation = await Visit.findById(person.observations.visits[0]).lean();
      obsType = 'visit';
    } else if (person.observations?.scans?.length > 0) {
      observation = await Scan.findById(person.observations.scans[0]).lean();
      obsType = 'scan';
    }

    if (!observation) {
      continue;
    }

    // Check for stable identifiers in the observation
    const salesNavId = observation.SalesProfile?.match(/ACoA[A-Za-z0-9_-]{12}/)?.[0] ||
                       observation['Sales Profile']?.match(/ACoA[A-Za-z0-9_-]{12}/)?.[0];

    const numericId = observation.id?.match(/^\d{8,}$/)?.[0] ||
                      observation.Id?.match(/^\d{8,}$/)?.[0];

    if (salesNavId && numericId) {
      stats.hasBothInObs++;
      if (stats.examples.length < 5) {
        stats.examples.push({
          currentId: person._id,
          name: person.snapshot?.name,
          salesNavId,
          numericId,
          obsType,
          obsData: {
            Profile: observation.Profile,
            SalesProfile: observation.SalesProfile || observation['Sales Profile'],
            id: observation.id || observation.Id
          }
        });
      }
    } else if (salesNavId) {
      stats.hasSalesNavInObs++;
      if (stats.examples.length < 5) {
        stats.examples.push({
          currentId: person._id,
          name: person.snapshot?.name,
          salesNavId,
          obsType,
          obsData: {
            Profile: observation.Profile,
            SalesProfile: observation.SalesProfile || observation['Sales Profile'],
            id: observation.id || observation.Id
          }
        });
      }
    } else if (numericId) {
      stats.hasNumericInObs++;
      if (stats.examples.length < 5) {
        stats.examples.push({
          currentId: person._id,
          name: person.snapshot?.name,
          numericId,
          obsType,
          obsData: {
            Profile: observation.Profile,
            id: observation.id || observation.Id
          }
        });
      }
    } else {
      stats.hasNeitherInObs++;
    }

    if (stats.checked % 20 === 0) {
      console.log(`  Checked ${stats.checked}/${urlBasedPeople.length}...`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('OBSERVATION ANALYSIS:');
  console.log('━'.repeat(70));
  console.log(`People checked: ${stats.checked}`);
  console.log(`  Have Sales Nav in observations: ${stats.hasSalesNavInObs} (${(stats.hasSalesNavInObs/stats.checked*100).toFixed(1)}%)`);
  console.log(`  Have Numeric in observations: ${stats.hasNumericInObs} (${(stats.hasNumericInObs/stats.checked*100).toFixed(1)}%)`);
  console.log(`  Have Both in observations: ${stats.hasBothInObs} (${(stats.hasBothInObs/stats.checked*100).toFixed(1)}%)`);
  console.log(`  Have Neither in observations: ${stats.hasNeitherInObs} (${(stats.hasNeitherInObs/stats.checked*100).toFixed(1)}%)`);

  const hasStableIds = stats.hasSalesNavInObs + stats.hasNumericInObs + stats.hasBothInObs;
  console.log(`\nObservations with stable IDs: ${hasStableIds} (${(hasStableIds/stats.checked*100).toFixed(1)}%)`);
  console.log('━'.repeat(70) + '\n');

  if (stats.examples.length > 0) {
    console.log('Sample observations with stable identifiers:\n');
    stats.examples.forEach((ex, i) => {
      console.log(`${i + 1}. ${ex.name || 'Unknown'} (${ex.obsType})`);
      console.log(`   Current person_id: ${ex.currentId}`);
      if (ex.salesNavId) console.log(`   Sales Nav ID: ${ex.salesNavId}`);
      if (ex.numericId) console.log(`   Numeric ID: ${ex.numericId}`);
      console.log(`   Raw data:`, JSON.stringify(ex.obsData, null, 2));
      console.log('');
    });
  }

  console.log('━'.repeat(70));
  console.log('CONCLUSION:');
  console.log('━'.repeat(70));
  if (hasStableIds > 0) {
    console.log('✓ Stable identifiers ARE available in observations!');
    console.log('  Migration can proceed by re-extracting identities from observations');
    console.log('  and creating new person records with stable IDs.');
  } else {
    console.log('✗ No stable identifiers found in observations');
    console.log('  URL-based IDs cannot be migrated - they are the only identifiers available');
  }
  console.log('━'.repeat(70) + '\n');
}

async function run() {
  try {
    await connectDB();
    await checkObservationsForStableIds();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
