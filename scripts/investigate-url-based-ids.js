#!/usr/bin/env node
/**
 * Investigate URL-Based Person IDs
 * Analyzes people using URL-based IDs and checks for available stable identifiers
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function investigateUrlBasedIds() {
  console.log('━'.repeat(70));
  console.log('  INVESTIGATE URL-BASED PERSON IDS');
  console.log('━'.repeat(70) + '\n');

  // Find people with URL-based IDs (contain 'linkedin.com/in/')
  const urlBasedPeople = await Person.find({
    _id: /^(https?:\/\/)?(www\.)?linkedin\.com\/in\//i
  }).lean();

  console.log(`Found ${urlBasedPeople.length} people with URL-based IDs\n`);

  const stats = {
    total: urlBasedPeople.length,
    hasSalesNavId: 0,
    hasNumericId: 0,
    hasBothStable: 0,
    hasNoStable: 0,
    examples: {
      hasSalesNav: [],
      hasNumeric: [],
      hasBoth: [],
      hasNone: []
    }
  };

  // Analyze each person
  for (const person of urlBasedPeople) {
    const aliases = person.aliases || [];

    // Check for Sales Navigator ID
    const salesNavAlias = aliases.find(a =>
      a.type === 'salesNavId' && a.value?.startsWith('ACoA')
    );

    // Check for numeric LinkedIn ID
    const numericAlias = aliases.find(a =>
      a.type === 'numericId' && /^\d{8,}$/.test(a.value)
    );

    if (salesNavAlias && numericAlias) {
      stats.hasBothStable++;
      if (stats.examples.hasBoth.length < 3) {
        stats.examples.hasBoth.push({
          currentId: person._id,
          salesNavId: salesNavAlias.value,
          numericId: numericAlias.value,
          name: person.snapshot?.name
        });
      }
    } else if (salesNavAlias) {
      stats.hasSalesNavId++;
      if (stats.examples.hasSalesNav.length < 3) {
        stats.examples.hasSalesNav.push({
          currentId: person._id,
          salesNavId: salesNavAlias.value,
          name: person.snapshot?.name
        });
      }
    } else if (numericAlias) {
      stats.hasNumericId++;
      if (stats.examples.hasNumeric.length < 3) {
        stats.examples.hasNumeric.push({
          currentId: person._id,
          numericId: numericAlias.value,
          name: person.snapshot?.name
        });
      }
    } else {
      stats.hasNoStable++;
      if (stats.examples.hasNone.length < 3) {
        stats.examples.hasNone.push({
          currentId: person._id,
          name: person.snapshot?.name,
          aliases: aliases.map(a => `${a.type}: ${a.value}`)
        });
      }
    }
  }

  console.log('━'.repeat(70));
  console.log('ANALYSIS SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total URL-based IDs: ${stats.total}`);
  console.log(`  Have Sales Nav ID: ${stats.hasSalesNavId} (${(stats.hasSalesNavId/stats.total*100).toFixed(1)}%)`);
  console.log(`  Have Numeric ID: ${stats.hasNumericId} (${(stats.hasNumericId/stats.total*100).toFixed(1)}%)`);
  console.log(`  Have Both: ${stats.hasBothStable} (${(stats.hasBothStable/stats.total*100).toFixed(1)}%)`);
  console.log(`  Have No Stable ID: ${stats.hasNoStable} (${(stats.hasNoStable/stats.total*100).toFixed(1)}%)`);

  const canMigrate = stats.hasSalesNavId + stats.hasNumericId + stats.hasBothStable;
  console.log(`\nCan be migrated: ${canMigrate} (${(canMigrate/stats.total*100).toFixed(1)}%)`);
  console.log('━'.repeat(70) + '\n');

  // Show examples
  if (stats.examples.hasBoth.length > 0) {
    console.log('Examples with both Sales Nav + Numeric ID:');
    stats.examples.hasBoth.forEach((ex, i) => {
      console.log(`  ${i + 1}. ${ex.name || 'Unknown'}`);
      console.log(`     Current: ${ex.currentId}`);
      console.log(`     Sales Nav: ${ex.salesNavId}`);
      console.log(`     Numeric: ${ex.numericId}`);
    });
    console.log('');
  }

  if (stats.examples.hasSalesNav.length > 0) {
    console.log('Examples with Sales Nav ID only:');
    stats.examples.hasSalesNav.forEach((ex, i) => {
      console.log(`  ${i + 1}. ${ex.name || 'Unknown'}`);
      console.log(`     Current: ${ex.currentId}`);
      console.log(`     Sales Nav: ${ex.salesNavId}`);
    });
    console.log('');
  }

  if (stats.examples.hasNumeric.length > 0) {
    console.log('Examples with Numeric ID only:');
    stats.examples.hasNumeric.forEach((ex, i) => {
      console.log(`  ${i + 1}. ${ex.name || 'Unknown'}`);
      console.log(`     Current: ${ex.currentId}`);
      console.log(`     Numeric: ${ex.numericId}`);
    });
    console.log('');
  }

  if (stats.examples.hasNone.length > 0) {
    console.log('Examples with NO stable identifiers:');
    stats.examples.hasNone.forEach((ex, i) => {
      console.log(`  ${i + 1}. ${ex.name || 'Unknown'}`);
      console.log(`     Current: ${ex.currentId}`);
      console.log(`     Aliases: ${ex.aliases.join(', ') || 'none'}`);
    });
    console.log('');
  }

  console.log('━'.repeat(70));
  console.log('MIGRATION STRATEGY:');
  console.log('━'.repeat(70));
  console.log('Priority order for new person_id:');
  console.log('  1. Sales Navigator ID (most stable)');
  console.log('  2. Numeric LinkedIn ID (stable)');
  console.log('  3. Keep URL-based ID (no stable alternative available)');
  console.log('\nMigration will:');
  console.log('  - Create new person record with stable ID');
  console.log('  - Move all observations to new record');
  console.log('  - Add old URL as alias to new record');
  console.log('  - Delete old URL-based record');
  console.log('━'.repeat(70) + '\n');

  return stats;
}

async function run() {
  try {
    await connectDB();
    await investigateUrlBasedIds();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
