#!/usr/bin/env node

/**
 * Investigate SalesNavId Conflicts
 *
 * This script investigates why we're seeing canonical_id mismatches
 * even when BOTH the existing and incoming identifiers are salesNavId.
 *
 * Possible causes:
 * 1. Same person has multiple different salesNavIds (data quality issue)
 * 2. Case sensitivity issues with salesNavId comparison
 * 3. salesNavId normalization issues
 *
 * Usage:
 *   node scripts/investigate-salesnavid-conflicts.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Person = require('../src/models/person');
const { computeCanonicalId, buildCanonicalKey } = require('../src/utils/identityResolver');
const { normalizeToCanonicalCase } = require('../src/utils/salesNavIdExtractor');

const stats = {
  total: 0,
  withMultipleSalesNavIds: 0,
  withCaseMismatch: 0,
  withCanonicalIdConflict: 0,
};

const conflicts = [];

/**
 * Analyze a person for salesNavId conflicts
 */
function analyzePerson(person) {
  stats.total++;

  // Find all salesNavId aliases
  const salesNavIdAliases = person.aliases.filter(a => a.type === 'salesNavId');

  if (salesNavIdAliases.length === 0) {
    return; // No salesNavId to check
  }

  if (salesNavIdAliases.length > 1) {
    stats.withMultipleSalesNavIds++;

    // Check if they're the same ID with different cases
    const normalized = salesNavIdAliases.map(a => normalizeToCanonicalCase(a.value));
    const uniqueNormalized = new Set(normalized);

    if (uniqueNormalized.size === 1) {
      stats.withCaseMismatch++;
      conflicts.push({
        person_id: person._id,
        type: 'CASE_MISMATCH',
        salesNavIds: salesNavIdAliases.map(a => a.value),
        normalizedCount: uniqueNormalized.size,
        message: 'Multiple salesNavId aliases with different cases, but same normalized value',
      });
    } else {
      conflicts.push({
        person_id: person._id,
        type: 'MULTIPLE_DISTINCT_IDS',
        salesNavIds: salesNavIdAliases.map(a => a.value),
        normalizedCount: uniqueNormalized.size,
        message: `Person has ${uniqueNormalized.size} DIFFERENT salesNavIds`,
      });
    }
  }

  // Check if canonical_id matches any of the salesNavIds
  if (salesNavIdAliases.length > 0) {
    const canonicalIdMatches = salesNavIdAliases.some(alias => {
      const testKey = buildCanonicalKey('salesNavId', alias.value);
      const testCanonicalId = computeCanonicalId(testKey);
      return testCanonicalId === person.canonical_id;
    });

    if (!canonicalIdMatches) {
      stats.withCanonicalIdConflict++;

      // Try to figure out what the canonical_id IS based on
      let canonicalIdSource = 'UNKNOWN';
      for (const alias of person.aliases) {
        const testKey = buildCanonicalKey(alias.type, alias.value);
        const testCanonicalId = computeCanonicalId(testKey);
        if (testCanonicalId === person.canonical_id) {
          canonicalIdSource = `${alias.type}:${alias.value}`;
          break;
        }
      }

      conflicts.push({
        person_id: person._id,
        type: 'CANONICAL_ID_MISMATCH',
        salesNavIds: salesNavIdAliases.map(a => a.value),
        canonical_id: person.canonical_id,
        canonical_id_source: canonicalIdSource,
        message: 'Person has salesNavId but canonical_id is based on different identifier',
      });
    }
  }
}

/**
 * Generate report
 */
function generateReport() {
  console.log('\n========================================');
  console.log('SALESNAVID CONFLICT INVESTIGATION');
  console.log('========================================\n');

  console.log('Summary:');
  console.log(`  Total people analyzed: ${stats.total}`);
  console.log(`  People with multiple salesNavIds: ${stats.withMultipleSalesNavIds}`);
  console.log(`  └─ Case mismatch only: ${stats.withCaseMismatch}`);
  console.log(`  └─ Truly different IDs: ${stats.withMultipleSalesNavIds - stats.withCaseMismatch}`);
  console.log(`  People with canonical_id conflicts: ${stats.withCanonicalIdConflict}\n`);

  if (conflicts.length > 0) {
    console.log(`Found ${conflicts.length} conflicts. Showing first 10:\n`);
    console.log('────────────────────────────────────────\n');

    conflicts.slice(0, 10).forEach((conflict, idx) => {
      console.log(`${idx + 1}. ${conflict.type}`);
      console.log(`   Person: ${conflict.person_id}`);
      console.log(`   Message: ${conflict.message}`);

      if (conflict.salesNavIds) {
        console.log(`   SalesNavIds (${conflict.salesNavIds.length}):`);
        conflict.salesNavIds.forEach(id => console.log(`     - ${id}`));
      }

      if (conflict.canonical_id_source) {
        console.log(`   Canonical ID source: ${conflict.canonical_id_source}`);
      }

      console.log('');
    });

    if (conflicts.length > 10) {
      console.log(`... and ${conflicts.length - 10} more\n`);
    }
  }

  console.log('\n========================================');
  console.log('BREAKDOWN BY CONFLICT TYPE');
  console.log('========================================\n');

  const breakdown = {};
  conflicts.forEach(c => {
    breakdown[c.type] = (breakdown[c.type] || 0) + 1;
  });

  Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  console.log('\n========================================');
  console.log('RECOMMENDATIONS');
  console.log('========================================\n');

  if (stats.withMultipleSalesNavIds > 0) {
    console.log('⚠️  People with multiple salesNavIds detected\n');

    if (stats.withCaseMismatch > 0) {
      console.log(`Case Mismatches (${stats.withCaseMismatch}):`);
      console.log('  - Same ID, different cases (e.g., "ACwAAA..." vs "acwaaa...")');
      console.log('  - Solution: Normalize salesNavIds before storing as aliases');
      console.log('  - Use normalizeToCanonicalCase() from salesNavIdExtractor\n');
    }

    const trulyDifferent = stats.withMultipleSalesNavIds - stats.withCaseMismatch;
    if (trulyDifferent > 0) {
      console.log(`Truly Different IDs (${trulyDifferent}):`);
      console.log('  - Same person has multiple DIFFERENT salesNavIds');
      console.log('  - This is a DATA QUALITY issue with DuxSoup or LinkedIn');
      console.log('  - May need to merge these people or investigate source data\n');
    }
  }

  if (stats.withCanonicalIdConflict > 0) {
    console.log(`⚠️  Canonical ID Conflicts (${stats.withCanonicalIdConflict}):`);
    console.log('  - Person has salesNavId but canonical_id based on different identifier');
    console.log('  - Solution: Run migration script to update canonical_ids');
    console.log('  - Command: node scripts/migrate-canonical-ids.js --execute\n');
  }

  if (conflicts.length === 0) {
    console.log('✅ No conflicts detected!\n');
  }
}

async function main() {
  try {
    console.log('Connecting to database...');
    await database.connect();

    console.log('Fetching all people...');
    const people = await Person.find({});

    console.log(`Analyzing ${people.length} people for salesNavId conflicts...\n`);

    for (const person of people) {
      analyzePerson(person);
    }

    generateReport();

    await database.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { analyzePerson };
