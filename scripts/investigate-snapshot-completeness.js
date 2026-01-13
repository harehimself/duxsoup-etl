#!/usr/bin/env node
/**
 * Investigate Snapshot Completeness
 * Checks what data is missing from person snapshots vs what's available in observations
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

// Define critical snapshot fields to check
const CRITICAL_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'currentTitle',
  'currentCompany',
  'currentCompanyId',
  'location',
  'industry',
  'connections',
  'email',
  'phone',
  'profilePicture',
  'thumbnail'
];

async function checkSnapshotCompleteness() {
  console.log('━'.repeat(70));
  console.log('  SNAPSHOT COMPLETENESS ANALYSIS');
  console.log('━'.repeat(70) + '\n');

  // Check each critical field
  const fieldStats = {};

  for (const field of CRITICAL_FIELDS) {
    const missing = await Person.countDocuments({
      $or: [
        { [`snapshot.${field}`]: { $exists: false } },
        { [`snapshot.${field}`]: '' },
        { [`snapshot.${field}`]: null }
      ]
    });

    const total = await Person.countDocuments();
    const percentage = ((missing / total) * 100).toFixed(1);

    fieldStats[field] = {
      missing,
      total,
      percentage: parseFloat(percentage)
    };
  }

  // Sort by percentage missing (worst first)
  const sortedFields = Object.entries(fieldStats)
    .sort((a, b) => b[1].percentage - a[1].percentage);

  console.log('MISSING FIELD ANALYSIS:');
  console.log('─'.repeat(70));
  console.log(`${'Field'.padEnd(25)} ${'Missing'.padStart(10)} ${'Total'.padStart(10)} ${'%'.padStart(8)}`);
  console.log('─'.repeat(70));

  sortedFields.forEach(([field, stats]) => {
    const severity = stats.percentage > 10 ? '🔴' : stats.percentage > 5 ? '🟡' : '🟢';
    console.log(
      `${severity} ${field.padEnd(22)} ${stats.missing.toString().padStart(10)} ${stats.total.toString().padStart(10)} ${stats.percentage.toString().padStart(7)}%`
    );
  });

  console.log('─'.repeat(70) + '\n');

  // Now sample people created in last 7 days with missing data
  const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentPeopleWithIssues = await Person.find({
    createdAt: { $gte: recentDate },
    $or: [
      { 'snapshot.fullName': { $in: [null, ''] } },
      { 'snapshot.currentTitle': { $in: [null, ''] } },
      { 'snapshot.currentCompany': { $in: [null, ''] } }
    ]
  }).limit(5).lean();

  console.log('RECENT PEOPLE WITH MISSING DATA (Last 7 days, sampling 5):');
  console.log('─'.repeat(70));

  for (let i = 0; i < recentPeopleWithIssues.length; i++) {
    const person = recentPeopleWithIssues[i];
    console.log(`\n${i + 1}. Person: ${person._id}`);
    console.log(`   Created: ${person.createdAt.toISOString().split('T')[0]}`);
    console.log(`   Has ${person.observations?.visits?.length || 0} visits, ${person.observations?.scans?.length || 0} scans`);

    console.log(`\n   Snapshot Status:`);
    console.log(`   ├─ fullName: ${person.snapshot?.fullName || '❌ MISSING'}`);
    console.log(`   ├─ firstName: ${person.snapshot?.firstName || '❌ MISSING'}`);
    console.log(`   ├─ lastName: ${person.snapshot?.lastName || '❌ MISSING'}`);
    console.log(`   ├─ currentTitle: ${person.snapshot?.currentTitle || '❌ MISSING'}`);
    console.log(`   ├─ currentCompany: ${person.snapshot?.currentCompany || '❌ MISSING'}`);
    console.log(`   ├─ currentCompanyId: ${person.snapshot?.currentCompanyId || '❌ MISSING'}`);
    console.log(`   ├─ location: ${person.snapshot?.location || '❌ MISSING'}`);
    console.log(`   ├─ industry: ${person.snapshot?.industry || '❌ MISSING'}`);
    console.log(`   └─ connections: ${person.snapshot?.connections || '❌ MISSING'}`);

    // Check what's available in observations
    if (person.observations?.visits?.length > 0) {
      const visit = await Visit.findById(person.observations.visits[0]).lean();
      if (visit) {
        console.log(`\n   Available in Visit:`);
        console.log(`   ├─ Name: ${visit['First Name']} ${visit['Last Name']}`);
        console.log(`   ├─ Title: ${visit.Title || 'none'}`);
        console.log(`   ├─ Company: ${visit.Company || 'none'}`);
        console.log(`   ├─ Location: ${visit.Location || 'none'}`);
        console.log(`   ├─ Industry: ${visit.Industry || 'none'}`);
        console.log(`   ├─ Connections: ${visit.Connections || 'none'}`);
        console.log(`   ├─ Email: ${visit.Email || 'none'}`);
        console.log(`   └─ Phone: ${visit.Phone || 'none'}`);
      }
    }

    if (person.observations?.scans?.length > 0) {
      const scan = await Scan.findById(person.observations.scans[0]).lean();
      if (scan) {
        console.log(`\n   Available in Scan:`);
        console.log(`   ├─ Name: ${scan['First Name']} ${scan['Last Name']}`);
        console.log(`   ├─ Title: ${scan.Title || 'none'}`);
        console.log(`   ├─ Company: ${scan.Company || 'none'}`);
        console.log(`   ├─ Location: ${scan.Location || 'none'}`);
        console.log(`   ├─ Industry: ${scan.Industry || 'none'}`);
        console.log(`   └─ Connections: ${scan.Connections || 'none'}`);
      }
    }

    console.log();
  }

  console.log('─'.repeat(70) + '\n');

  // Check if this is a recent problem or ongoing
  console.log('TEMPORAL ANALYSIS:');
  console.log('─'.repeat(70));

  const ageGroups = [
    { label: 'Last 24h', days: 1 },
    { label: 'Last 7d', days: 7 },
    { label: 'Last 30d', days: 30 },
    { label: 'Older', days: 9999 }
  ];

  for (const group of ageGroups) {
    const startDate = new Date(Date.now() - group.days * 24 * 60 * 60 * 1000);
    const endDate = group.days === 9999 ? new Date('2020-01-01') : new Date(Date.now() - (group.days === 1 ? 0 : ageGroups[ageGroups.indexOf(group) - 1].days) * 24 * 60 * 60 * 1000);

    const query = group.days === 9999
      ? { createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
      : { createdAt: { $gte: startDate, $lt: endDate } };

    const total = await Person.countDocuments(query);

    if (total === 0) continue;

    const missingNames = await Person.countDocuments({
      ...query,
      $or: [
        { 'snapshot.fullName': { $exists: false } },
        { 'snapshot.fullName': '' },
        { 'snapshot.fullName': null }
      ]
    });

    const missingTitles = await Person.countDocuments({
      ...query,
      $or: [
        { 'snapshot.currentTitle': { $exists: false } },
        { 'snapshot.currentTitle': '' },
        { 'snapshot.currentTitle': null }
      ]
    });

    const namePercentage = ((missingNames / total) * 100).toFixed(1);
    const titlePercentage = ((missingTitles / total) * 100).toFixed(1);

    console.log(`\n${group.label}:`);
    console.log(`  Total people: ${total}`);
    console.log(`  Missing names: ${missingNames} (${namePercentage}%)`);
    console.log(`  Missing titles: ${missingTitles} (${titlePercentage}%)`);
  }

  console.log('\n' + '─'.repeat(70) + '\n');
}

async function run() {
  try {
    await connectDB();
    await checkSnapshotCompleteness();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
