#!/usr/bin/env node

/**
 * Comprehensive Orphaned Observations Analysis
 *
 * Analyzes the relationship between:
 * - Orphaned visits/scans (not linked to any person)
 * - Dead letter queue entries
 * - Missing person records
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const DeadLetter = require('../src/models/deadLetter');

async function analyzeOrphanedObservations() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('COMPREHENSIVE ORPHANED OBSERVATIONS ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Get total counts
  console.log('1. TOTAL COUNTS');
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  const totalPeople = await Person.countDocuments();
  const totalVisits = await Visit.countDocuments();
  const totalScans = await Scan.countDocuments();
  const totalDeadLetters = await DeadLetter.countDocuments();

  console.log(`People:       ${totalPeople.toLocaleString()}`);
  console.log(`Visits:       ${totalVisits.toLocaleString()}`);
  console.log(`Scans:        ${totalScans.toLocaleString()}`);
  console.log(`Dead Letters: ${totalDeadLetters.toLocaleString()}`);
  console.log('');

  // 2. Find orphaned observations
  console.log('2. ORPHANED OBSERVATIONS (not referenced by any person)');
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  const referencedVisitIds = new Set();
  const referencedScanIds = new Set();

  const people = await Person.find({}, { 'observations.visits': 1, 'observations.scans': 1 }).lean();

  people.forEach(person => {
    person.observations?.visits?.filter(id => id).forEach(id => referencedVisitIds.add(id.toString()));
    person.observations?.scans?.filter(id => id).forEach(id => referencedScanIds.add(id.toString()));
  });

  const allVisitIds = await Visit.find({}, { _id: 1 }).lean();
  const allScanIds = await Scan.find({}, { _id: 1 }).lean();

  const orphanedVisitIds = allVisitIds
    .filter(v => !referencedVisitIds.has(v._id.toString()))
    .map(v => v._id);

  const orphanedScanIds = allScanIds
    .filter(s => !referencedScanIds.has(s._id.toString()))
    .map(s => s._id);

  console.log(`Referenced visits: ${referencedVisitIds.size.toLocaleString()}`);
  console.log(`Orphaned visits:   ${orphanedVisitIds.length.toLocaleString()}`);
  console.log(`Referenced scans:  ${referencedScanIds.size.toLocaleString()}`);
  console.log(`Orphaned scans:    ${orphanedScanIds.length.toLocaleString()}`);
  console.log('');

  // 3. Check dead letter queue for orphaned observations
  console.log('3. DEAD LETTER QUEUE ANALYSIS');
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  const orphanedInDeadLetters = {
    visits: 0,
    scans: 0
  };

  for (const visitId of orphanedVisitIds) {
    const inDeadLetter = await DeadLetter.findOne({ observation_id: visitId });
    if (inDeadLetter) orphanedInDeadLetters.visits++;
  }

  for (const scanId of orphanedScanIds) {
    const inDeadLetter = await DeadLetter.findOne({ observation_id: scanId });
    if (inDeadLetter) orphanedInDeadLetters.scans++;
  }

  console.log('Orphaned observations also in dead letter queue:');
  console.log(`  Visits: ${orphanedInDeadLetters.visits}/${orphanedVisitIds.length}`);
  console.log(`  Scans:  ${orphanedInDeadLetters.scans}/${orphanedScanIds.length}`);
  console.log('');

  // 4. Dead letter status breakdown
  console.log('4. DEAD LETTER STATUS BREAKDOWN');
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  const deadLettersByStatus = await DeadLetter.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  deadLettersByStatus.forEach(item => {
    console.log(`  ${item._id || 'unknown'}: ${item.count.toLocaleString()}`);
  });
  console.log('');

  // 5. Sample orphaned observations not in dead letters
  console.log('5. SAMPLE ORPHANED OBSERVATIONS (not in dead letter queue)');
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  const orphanedNotInDeadLetters = [];

  for (const visitId of orphanedVisitIds.slice(0, 10)) {
    const inDeadLetter = await DeadLetter.findOne({ observation_id: visitId });
    if (!inDeadLetter) {
      const visit = await Visit.findById(visitId).lean();
      if (visit) {
        orphanedNotInDeadLetters.push({
          type: 'visit',
          id: visitId,
          profile: visit.Profile,
          salesNavId: visit.SalesNavId,
          createdAt: visit.createdAt
        });
      }
    }
  }

  for (const scanId of orphanedScanIds.slice(0, 10)) {
    const inDeadLetter = await DeadLetter.findOne({ observation_id: scanId });
    if (!inDeadLetter) {
      const scan = await Scan.findById(scanId).lean();
      if (scan) {
        orphanedNotInDeadLetters.push({
          type: 'scan',
          id: scanId,
          profile: scan.Profile,
          salesNavId: scan.SalesNavId,
          createdAt: scan.createdAt
        });
      }
    }
  }

  if (orphanedNotInDeadLetters.length > 0) {
    console.log(`Found ${orphanedNotInDeadLetters.length} orphaned observations not in dead letters:\n`);
    orphanedNotInDeadLetters.slice(0, 5).forEach((obs, i) => {
      console.log(`${i + 1}. ${obs.type.toUpperCase()} ${obs.id}`);
      console.log(`   Profile: ${obs.profile || 'N/A'}`);
      console.log(`   Sales Nav ID: ${obs.salesNavId || 'N/A'}`);
      console.log(`   Created: ${obs.createdAt || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('All orphaned observations are in the dead letter queue.\n');
  }

  // 6. Recommendations
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RECOMMENDATIONS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const orphanedNotInDL = orphanedVisitIds.length + orphanedScanIds.length -
                          orphanedInDeadLetters.visits - orphanedInDeadLetters.scans;

  if (orphanedNotInDL > 0) {
    console.log(`⚠️  ${orphanedNotInDL} orphaned observations NOT in dead letter queue`);
    console.log('   → These should be linked to person records or moved to dead letters\n');
    console.log('   Run: node scripts/link-orphaned-observations.js');
    console.log('');
  }

  if (totalDeadLetters > 0) {
    console.log(`📋 ${totalDeadLetters.toLocaleString()} dead letters in queue`);
    console.log('   → Review and replay failed observations\n');
    console.log('   Run: node scripts/replay-dead-letters.js');
    console.log('');
  }

  if (orphanedNotInDL === 0 && totalDeadLetters === 0) {
    console.log('✓ No action needed - all observations are properly linked or in dead letters\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
}

analyzeOrphanedObservations().catch(console.error);
