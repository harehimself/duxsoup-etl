#!/usr/bin/env node
/**
 * Find Migratable URL-Based People
 * Check if any orphaned visits/scans with stable IDs match URL-based people
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const { resolvePersonIdentity } = require('../src/utils/identityResolver');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function findMigratableUrlPeople() {
  console.log('━'.repeat(70));
  console.log('  FIND MIGRATABLE URL-BASED PEOPLE');
  console.log('━'.repeat(70) + '\n');

  // Strategy: Check if there are any NEW visits (with Sales Nav data)
  // that reference the same profile URL as URL-based people

  const urlPeople = await Person.find({
    _id: /^linkedin\.com\/in\//
  }, {
    _id: 1,
    aliases: 1,
    'snapshot.name': 1
  }).lean();

  console.log(`Found ${urlPeople.length} URL-based people\n`);
  console.log('Checking for newer observations with stable identifiers...\n');

  const stats = {
    checked: 0,
    hasStableIdInVisit: 0,
    examples: []
  };

  // Check each URL person's visits for stable IDs
  for (const person of urlPeople) {
    stats.checked++;

    // Get profile URL (normalized)
    const profileUrl = person._id.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();

    // Find ALL visits that match this profile URL
    const visits = await Visit.find({
      $or: [
        { Profile: new RegExp(profileUrl, 'i') },
        { profile: new RegExp(profileUrl, 'i') }
      ]
    }).lean();

    // Check if any visit has stable identifiers
    for (const visit of visits) {
      const identity = resolvePersonIdentity(visit);

      // Check if this visit has a stable ID (Sales Nav or numeric)
      const hasSalesNav = identity.person_id?.startsWith('ACoA');
      const hasNumeric = /^\d{8,}$/.test(identity.person_id);

      if (hasSalesNav || hasNumeric) {
        stats.hasStableIdInVisit++;

        if (stats.examples.length < 10) {
          stats.examples.push({
            currentId: person._id,
            name: person.snapshot?.name,
            stableId: identity.person_id,
            idType: hasSalesNav ? 'Sales Nav ID' : 'Numeric ID',
            visitId: visit._id,
            visitProfile: visit.Profile,
            visitSalesProfile: visit.SalesProfile || visit['Sales Profile']
          });
        }

        break; // Found one, move to next person
      }
    }

    if (stats.checked % 100 === 0) {
      console.log(`  Checked ${stats.checked}/${urlPeople.length}...`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('MIGRATION ANALYSIS:');
  console.log('━'.repeat(70));
  console.log(`Total URL-based people: ${stats.checked}`);
  console.log(`Can be migrated (have stable ID in observations): ${stats.hasStableIdInVisit}`);
  console.log(`Cannot be migrated: ${stats.checked - stats.hasStableIdInVisit} (${((stats.checked - stats.hasStableIdInVisit)/stats.checked*100).toFixed(1)}%)`);
  console.log('━'.repeat(70) + '\n');

  if (stats.examples.length > 0) {
    console.log('Migratable people (sample):\n');
    stats.examples.forEach((ex, i) => {
      console.log(`${i + 1}. ${ex.name || 'Unknown'}`);
      console.log(`   Current ID: ${ex.currentId}`);
      console.log(`   New ID: ${ex.stableId} (${ex.idType})`);
      console.log(`   From visit: ${ex.visitId}`);
      console.log(`   Sales Profile: ${ex.visitSalesProfile || 'none'}`);
      console.log('');
    });
  }

  console.log('━'.repeat(70));
  console.log('RECOMMENDATION:');
  console.log('━'.repeat(70));

  if (stats.hasStableIdInVisit > 0) {
    console.log(`✓ ${stats.hasStableIdInVisit} people can be migrated to stable IDs`);
    console.log('  These people have newer observations with Sales Nav or numeric IDs');
    console.log('  Migration process:');
    console.log('    1. Create new person record with stable ID');
    console.log('    2. Move all observations to new record');
    console.log('    3. Add old URL as alias');
    console.log('    4. Delete old URL-based record');
  } else {
    console.log('✗ No URL-based people can be migrated');
    console.log('  All 778 people only have basic scan data without stable identifiers');
    console.log('  URL-based IDs are acceptable for these edge cases');
  }

  const cannotMigrate = stats.checked - stats.hasStableIdInVisit;
  if (cannotMigrate > 0) {
    console.log(`\n⚠ ${cannotMigrate} people cannot be migrated`);
    console.log('  These are scan-only profiles with no Sales Navigator data');
    console.log('  URL-based IDs are the only identifiers available');
    console.log('  This is expected and acceptable per the architecture');
  }

  console.log('━'.repeat(70) + '\n');

  return {
    total: stats.checked,
    migratable: stats.hasStableIdInVisit,
    examples: stats.examples
  };
}

async function run() {
  try {
    await connectDB();
    const result = await findMigratableUrlPeople();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
