#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

async function checkConnectionsDegreeData() {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('━'.repeat(70));
  console.log('  ANALYZE CONNECTIONS & DEGREE DATA TYPES');
  console.log('━'.repeat(70) + '\n');

  // Sample people with connections/degree data
  const peopleWithData = await Person.find({
    $or: [
      { 'snapshot.connections': { $exists: true, $ne: null } },
      { 'snapshot.degree': { $exists: true, $ne: null } }
    ]
  }, {
    'snapshot.connections': 1,
    'snapshot.degree': 1,
    'snapshot.name': 1
  }).limit(20).lean();

  console.log('Sample people with connections/degree data:\n');
  peopleWithData.forEach((p, i) => {
    console.log(`${i + 1}. ${p.snapshot?.name || 'Unknown'}`);
    console.log(`   connections: "${p.snapshot?.connections}" (type: ${typeof p.snapshot?.connections})`);
    console.log(`   degree: "${p.snapshot?.degree}" (type: ${typeof p.snapshot?.degree})`);
  });

  // Check what's in the raw observations
  console.log('\n\n━'.repeat(70));
  console.log('Sample data from observations:');
  console.log('━'.repeat(70) + '\n');

  const visits = await Visit.find({
    $or: [
      { Connections: { $exists: true } },
      { connections: { $exists: true } },
      { Degree: { $exists: true } },
      { degree: { $exists: true } }
    ]
  }, {
    Connections: 1,
    connections: 1,
    Degree: 1,
    degree: 1
  }).limit(10).lean();

  console.log('Visits:');
  visits.forEach((v, i) => {
    console.log(`${i + 1}.`);
    console.log(`   Connections: "${v.Connections || v.connections}" (type: ${typeof (v.Connections || v.connections)})`);
    console.log(`   Degree: "${v.Degree || v.degree}" (type: ${typeof (v.Degree || v.degree)})`);
  });

  const scans = await Scan.find({
    $or: [
      { Connections: { $exists: true } },
      { connections: { $exists: true } },
      { Degree: { $exists: true } },
      { degree: { $exists: true } }
    ]
  }, {
    Connections: 1,
    connections: 1,
    Degree: 1,
    degree: 1
  }).limit(10).lean();

  console.log('\nScans:');
  scans.forEach((s, i) => {
    console.log(`${i + 1}.`);
    console.log(`   Connections: "${s.Connections || s.connections}" (type: ${typeof (s.Connections || s.connections)})`);
    console.log(`   Degree: "${s.Degree || s.degree}" (type: ${typeof (s.Degree || s.degree)})`);
  });

  // Analyze patterns
  console.log('\n\n━'.repeat(70));
  console.log('ANALYSIS:');
  console.log('━'.repeat(70) + '\n');

  const allPeople = await Person.find({
    'snapshot.connections': { $exists: true, $ne: null }
  }, {
    'snapshot.connections': 1
  }).lean();

  const connectionPatterns = {};
  allPeople.forEach(p => {
    const conn = p.snapshot?.connections;
    if (conn) {
      connectionPatterns[conn] = (connectionPatterns[conn] || 0) + 1;
    }
  });

  console.log('Connection value patterns (top 20):');
  Object.entries(connectionPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([value, count]) => {
      const isNumeric = /^\d+$/.test(value);
      const hasPlus = value.includes('+');
      console.log(`  "${value}" → ${count} people (numeric: ${isNumeric}, has '+': ${hasPlus})`);
    });

  const allPeopleWithDegree = await Person.find({
    'snapshot.degree': { $exists: true, $ne: null }
  }, {
    'snapshot.degree': 1
  }).lean();

  const degreePatterns = {};
  allPeopleWithDegree.forEach(p => {
    const deg = p.snapshot?.degree;
    if (deg) {
      degreePatterns[deg] = (degreePatterns[deg] || 0) + 1;
    }
  });

  console.log('\nDegree value patterns:');
  Object.entries(degreePatterns)
    .sort((a, b) => b[1] - a[1])
    .forEach(([value, count]) => {
      const isNumeric = /^\d+$/.test(value);
      console.log(`  "${value}" → ${count} people (numeric: ${isNumeric})`);
    });

  console.log('\n━'.repeat(70));
  console.log('RECOMMENDATION:');
  console.log('━'.repeat(70));

  const needsConversion = Object.keys(connectionPatterns).some(v => /^\d+(\+)?$/.test(v));
  if (needsConversion) {
    console.log('\n✓ YES, these fields should be converted to numbers');
    console.log('\nReasons:');
    console.log('  1. Data contains numeric values (e.g., "500", "500+")');
    console.log('  2. Numeric type enables range queries and sorting');
    console.log('  3. Reduces storage overhead');
    console.log('  4. Prevents string comparison issues ("9" > "10")');
    console.log('\nSuggested schema:');
    console.log('  connections: { type: Number }  // Store numeric value');
    console.log('  connectionsDisplay: { type: String }  // Store "500+" format');
    console.log('  degree: { type: Number }  // Store 1, 2, 3');
    console.log('\nMigration needed:');
    console.log('  - Parse "500+" → 500 (connections)');
    console.log('  - Parse "1st" → 1, "2nd" → 2, "3rd" → 3 (degree)');
  } else {
    console.log('\n✗ Data is not numeric, keep as strings');
  }
  console.log('━'.repeat(70) + '\n');

  await mongoose.disconnect();
}

checkConnectionsDegreeData().catch(console.error);
