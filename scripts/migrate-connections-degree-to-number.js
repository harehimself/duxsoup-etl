#!/usr/bin/env node
/**
 * Migrate Connections and Degree to Number Types
 * Converts string values to proper numeric types with graceful error handling
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

/**
 * Parse connections string to number
 * Handles: "500", "1234", "500+" (strips +)
 */
function parseConnections(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;

  const str = String(value).trim();
  if (str === '') return null;

  // Remove "+" suffix if present
  const cleaned = str.replace(/\+$/, '');

  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num < 0) {
    return { error: `Invalid connections value: "${value}"` };
  }

  return num;
}

/**
 * Parse degree string to number
 * Handles: "1", "2", "3", "1st", "2nd", "3rd"
 */
function parseDegree(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;

  const str = String(value).trim().toLowerCase();
  if (str === '') return null;

  // Handle "1st", "2nd", "3rd" format
  const ordinalMatch = str.match(/^(\d+)(st|nd|rd|th)?$/);
  if (ordinalMatch) {
    const num = parseInt(ordinalMatch[1], 10);
    if (num >= 1 && num <= 3) {
      return num;
    }
    return { error: `Degree out of range (1-3): "${value}"` };
  }

  // Handle plain numbers
  const num = parseInt(str, 10);
  if (!isNaN(num) && num >= 1 && num <= 3) {
    return num;
  }

  return { error: `Invalid degree value: "${value}"` };
}

async function migrateConnectionsDegree() {
  console.log('━'.repeat(70));
  console.log(`  MIGRATE CONNECTIONS & DEGREE TO NUMBERS ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  // Find all people with string-type connections or degree
  const peopleToMigrate = await Person.find({
    $or: [
      { 'snapshot.connections': { $type: 'string' } },
      { 'snapshot.degree': { $type: 'string' } }
    ]
  }, {
    _id: 1,
    'snapshot.connections': 1,
    'snapshot.degree': 1,
    'snapshot.name': 1
  }).lean();

  console.log(`Found ${peopleToMigrate.length} people with string-type connections/degree\n`);

  if (peopleToMigrate.length === 0) {
    console.log('✓ No migration needed - all values are already numeric!\n');
    return;
  }

  const stats = {
    total: peopleToMigrate.length,
    connectionsConverted: 0,
    degreeConverted: 0,
    connectionsSkipped: 0,
    degreeSkipped: 0,
    connectionsErrors: 0,
    degreeErrors: 0,
    errors: []
  };

  console.log('Processing conversions...\n');

  for (const person of peopleToMigrate) {
    const updates = {};
    let hasUpdates = false;

    // Convert connections
    if (typeof person.snapshot?.connections === 'string') {
      const result = parseConnections(person.snapshot.connections);

      if (result && typeof result === 'object' && result.error) {
        stats.connectionsErrors++;
        stats.errors.push({
          personId: person._id,
          field: 'connections',
          value: person.snapshot.connections,
          error: result.error
        });
      } else if (result !== null) {
        updates['snapshot.connections'] = result;
        stats.connectionsConverted++;
        hasUpdates = true;
      } else {
        // null means clear the field
        updates['snapshot.connections'] = null;
        stats.connectionsSkipped++;
        hasUpdates = true;
      }
    }

    // Convert degree
    if (typeof person.snapshot?.degree === 'string') {
      const result = parseDegree(person.snapshot.degree);

      if (result && typeof result === 'object' && result.error) {
        stats.degreeErrors++;
        stats.errors.push({
          personId: person._id,
          field: 'degree',
          value: person.snapshot.degree,
          error: result.error
        });
      } else if (result !== null) {
        updates['snapshot.degree'] = result;
        stats.degreeConverted++;
        hasUpdates = true;
      } else {
        // null means clear the field
        updates['snapshot.degree'] = null;
        stats.degreeSkipped++;
        hasUpdates = true;
      }
    }

    // Apply updates
    if (hasUpdates && !isDryRun) {
      try {
        await Person.updateOne({ _id: person._id }, { $set: updates });
      } catch (error) {
        stats.errors.push({
          personId: person._id,
          field: 'update',
          error: error.message
        });
      }
    }

    const processed = stats.connectionsConverted + stats.degreeConverted +
                      stats.connectionsSkipped + stats.degreeSkipped;

    if (processed % 1000 === 0 && processed > 0) {
      console.log(`  Progress: ${processed} fields processed...`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('MIGRATION SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`People processed: ${stats.total}`);
  console.log('');
  console.log('Connections:');
  console.log(`  ✓ Converted to number: ${stats.connectionsConverted}`);
  console.log(`  - Cleared (empty/null): ${stats.connectionsSkipped}`);
  console.log(`  ✗ Errors: ${stats.connectionsErrors}`);
  console.log('');
  console.log('Degree:');
  console.log(`  ✓ Converted to number: ${stats.degreeConverted}`);
  console.log(`  - Cleared (empty/null): ${stats.degreeSkipped}`);
  console.log(`  ✗ Errors: ${stats.degreeErrors}`);
  console.log('━'.repeat(70) + '\n');

  if (stats.errors.length > 0) {
    console.log('Conversion errors (first 10):');
    stats.errors.slice(0, 10).forEach(err => {
      console.log(`  ${err.personId} / ${err.field}: ${err.error}`);
      if (err.value) console.log(`    Original value: "${err.value}"`);
    });
    console.log('');

    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more errors\n`);
    }
  }

  if (isDryRun) {
    console.log(`✓ Dry run complete. Run without --dry-run to apply changes.\n`);
    console.log('Sample conversions:');
    console.log('  Connections: "500" → 500');
    console.log('  Connections: "1234" → 1234');
    console.log('  Connections: "500+" → 500');
    console.log('  Degree: "1" → 1');
    console.log('  Degree: "2nd" → 2');
    console.log('');
  } else {
    const total = stats.connectionsConverted + stats.degreeConverted;
    console.log(`✓ Successfully migrated ${total} fields to numeric type\n`);

    if (stats.connectionsErrors > 0 || stats.degreeErrors > 0) {
      console.log(`⚠ ${stats.connectionsErrors + stats.degreeErrors} values could not be converted`);
      console.log('  These fields remain as-is and may need manual review\n');
    }
  }
}

async function run() {
  try {
    await connectDB();
    await migrateConnectionsDegree();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
