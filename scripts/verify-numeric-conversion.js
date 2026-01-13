#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function verify() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('━'.repeat(70));
  console.log('  VERIFY NUMERIC CONVERSION');
  console.log('━'.repeat(70) + '\n');

  // Sample people with connections/degree
  const samples = await Person.find({
    $or: [
      { 'snapshot.connections': { $exists: true, $ne: null } },
      { 'snapshot.degree': { $exists: true, $ne: null } }
    ]
  }, {
    'snapshot.connections': 1,
    'snapshot.degree': 1,
    'snapshot.name': 1
  }).limit(10).lean();

  console.log('Sample records after migration:\n');
  samples.forEach((p, i) => {
    console.log(`${i + 1}. ${p.snapshot?.name || 'Unknown'}`);
    console.log(`   connections: ${p.snapshot?.connections} (type: ${typeof p.snapshot?.connections})`);
    console.log(`   degree: ${p.snapshot?.degree} (type: ${typeof p.snapshot?.degree})`);
  });

  // Check for any remaining strings
  const remainingStrings = await Person.countDocuments({
    $or: [
      { 'snapshot.connections': { $type: 'string' } },
      { 'snapshot.degree': { $type: 'string' } }
    ]
  });

  console.log('\n' + '━'.repeat(70));
  console.log('VERIFICATION RESULTS:');
  console.log('━'.repeat(70));

  if (remainingStrings === 0) {
    console.log('✓ All connections and degree fields are now numeric!');
  } else {
    console.log(`⚠ Found ${remainingStrings} people with string-type values remaining`);
  }

  // Stats on numeric values
  const stats = await Person.aggregate([
    {
      $match: {
        $or: [
          { 'snapshot.connections': { $type: 'number' } },
          { 'snapshot.degree': { $type: 'number' } }
        ]
      }
    },
    {
      $group: {
        _id: null,
        totalWithConnections: {
          $sum: { $cond: [{ $ne: ['$snapshot.connections', null] }, 1, 0] }
        },
        totalWithDegree: {
          $sum: { $cond: [{ $ne: ['$snapshot.degree', null] }, 1, 0] }
        },
        avgConnections: { $avg: '$snapshot.connections' },
        minConnections: { $min: '$snapshot.connections' },
        maxConnections: { $max: '$snapshot.connections' },
        degree1: {
          $sum: { $cond: [{ $eq: ['$snapshot.degree', 1] }, 1, 0] }
        },
        degree2: {
          $sum: { $cond: [{ $eq: ['$snapshot.degree', 2] }, 1, 0] }
        },
        degree3: {
          $sum: { $cond: [{ $eq: ['$snapshot.degree', 3] }, 1, 0] }
        }
      }
    }
  ]);

  if (stats.length > 0) {
    const s = stats[0];
    console.log('\nNumeric field statistics:');
    console.log(`  People with connections: ${s.totalWithConnections}`);
    console.log(`  Average connections: ${Math.round(s.avgConnections)}`);
    console.log(`  Min connections: ${s.minConnections}`);
    console.log(`  Max connections: ${s.maxConnections}`);
    console.log(`\n  People with degree: ${s.totalWithDegree}`);
    console.log(`    1st degree: ${s.degree1}`);
    console.log(`    2nd degree: ${s.degree2}`);
    console.log(`    3rd degree: ${s.degree3}`);
  }

  console.log('━'.repeat(70) + '\n');

  await mongoose.disconnect();
}

verify().catch(console.error);
