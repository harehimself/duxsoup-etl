#!/usr/bin/env node
/**
 * Investigate Missing Names
 * Find people without names and check if we can recover them from observations
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

async function investigateMissingNames() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  INVESTIGATING MISSING NAMES');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find people without names
  const peopleWithoutNames = await Person.find({
    $or: [
      { 'snapshot.fullName': { $exists: false } },
      { 'snapshot.fullName': '' },
      { 'snapshot.fullName': null }
    ]
  }).limit(10).lean();

  console.log(`Total people without names: ${await Person.countDocuments({
    $or: [
      { 'snapshot.fullName': { $exists: false } },
      { 'snapshot.fullName': '' },
      { 'snapshot.fullName': null }
    ]
  })}\n`);

  console.log('Sampling 10 records:\n');

  let recoverableCount = 0;
  const recoverySources = {
    visit: 0,
    scan: 0,
    metadata: 0,
    none: 0
  };

  for (let i = 0; i < peopleWithoutNames.length; i++) {
    const person = peopleWithoutNames[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PERSON ${i + 1}:`);
    console.log(`_id: ${person._id}`);
    console.log(`canonical_id: ${person.canonical_id}`);
    console.log(`snapshot.fullName: ${person.snapshot?.fullName || 'MISSING'}`);
    console.log(`snapshot.firstName: ${person.snapshot?.firstName || 'none'}`);
    console.log(`snapshot.lastName: ${person.snapshot?.lastName || 'none'}`);

    // Check if name exists in _meta
    if (person.snapshot?._meta?.fullName?.value) {
      console.log(`\n✓ Name found in snapshot._meta: "${person.snapshot._meta.fullName.value}"`);
      recoverableCount++;
      recoverySources.metadata++;
      continue;
    }

    // Check visits
    if (person.observations?.visits?.length > 0) {
      console.log(`\nHas ${person.observations.visits.length} visit(s)`);
      const visitId = person.observations.visits[0];
      const visit = await Visit.findById(visitId).lean();

      if (visit) {
        const firstName = visit['First Name'];
        const lastName = visit['Last Name'];
        const fullName = firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || '';

        console.log(`  Visit data: "${firstName || 'none'}" "${lastName || 'none'}"`);

        if (fullName) {
          console.log(`  ✓ Can recover name from visit: "${fullName}"`);
          recoverableCount++;
          recoverySources.visit++;
          continue;
        }
      } else {
        console.log(`  ⚠ Visit ${visitId} not found (broken reference)`);
      }
    }

    // Check scans
    if (person.observations?.scans?.length > 0) {
      console.log(`\nHas ${person.observations.scans.length} scan(s)`);
      const scanId = person.observations.scans[0];
      const scan = await Scan.findById(scanId).lean();

      if (scan) {
        const firstName = scan['First Name'];
        const lastName = scan['Last Name'];
        const fullName = firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || '';

        console.log(`  Scan data: "${firstName || 'none'}" "${lastName || 'none'}"`);

        if (fullName) {
          console.log(`  ✓ Can recover name from scan: "${fullName}"`);
          recoverableCount++;
          recoverySources.scan++;
          continue;
        }
      } else {
        console.log(`  ⚠ Scan ${scanId} not found (broken reference)`);
      }
    }

    // No observations
    if (!person.observations?.visits?.length && !person.observations?.scans?.length) {
      console.log(`\n✗ No observations to recover from`);
      recoverySources.none++;
    } else {
      console.log(`\n✗ Cannot recover name from available data`);
      recoverySources.none++;
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('SUMMARY:');
  console.log('━'.repeat(60));
  console.log(`Recoverable from observations: ${recoverableCount}/${peopleWithoutNames.length}`);
  console.log(`\nRecovery sources:`);
  console.log(`  - From visits: ${recoverySources.visit}`);
  console.log(`  - From scans: ${recoverySources.scan}`);
  console.log(`  - From metadata: ${recoverySources.metadata}`);
  console.log(`  - Cannot recover: ${recoverySources.none}`);

  // Estimate for all 332 records
  const totalMissing = 332;
  const recoveryRate = recoverableCount / peopleWithoutNames.length;
  const estimatedRecoverable = Math.round(totalMissing * recoveryRate);

  console.log(`\nEstimated recoverable (all 332): ~${estimatedRecoverable} (${(recoveryRate * 100).toFixed(1)}%)`);
  console.log('━'.repeat(60));

  // Check pattern: Are these mostly old records or recent?
  console.log('\n\nAGE ANALYSIS:');
  console.log('━'.repeat(60));

  const ageStats = await Person.aggregate([
    {
      $match: {
        $or: [
          { 'snapshot.fullName': { $exists: false } },
          { 'snapshot.fullName': '' },
          { 'snapshot.fullName': null }
        ]
      }
    },
    {
      $project: {
        age: { $subtract: [new Date(), '$createdAt'] },
        createdAt: 1
      }
    },
    {
      $group: {
        _id: null,
        avgAge: { $avg: '$age' },
        oldestDate: { $min: '$createdAt' },
        newestDate: { $max: '$createdAt' },
        count: { $sum: 1 }
      }
    }
  ]);

  if (ageStats.length > 0) {
    const stats = ageStats[0];
    const avgAgeDays = Math.round(stats.avgAge / (1000 * 60 * 60 * 24));

    console.log(`Total records: ${stats.count}`);
    console.log(`Oldest record: ${stats.oldestDate.toISOString().split('T')[0]}`);
    console.log(`Newest record: ${stats.newestDate.toISOString().split('T')[0]}`);
    console.log(`Average age: ${avgAgeDays} days`);
  }

  console.log('━'.repeat(60) + '\n');
}

async function run() {
  try {
    await connectDB();
    await investigateMissingNames();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
