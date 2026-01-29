#!/usr/bin/env node

/**
 * Analyze Canonical ID Mismatches (Memory-Efficient Batched Version)
 *
 * This script identifies person records where the canonical_id is based on a
 * lower-priority identifier when a higher-priority identifier is available.
 *
 * Processes in batches to avoid memory issues on limited RAM environments.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Person = require('../src/models/person');
const { computeCanonicalId, buildCanonicalKey } = require('../src/utils/identityResolver');

const stats = {
  total: 0,
  withSalesNavId: 0,
  withUsername: 0,
  mismatched: 0,
  correct: 0,
  analyzed: 0,
};

const mismatches = [];

/**
 * Determine the priority of an identifier type
 */
function getIdentifierPriority(type) {
  const priorities = {
    salesNavId: 5,
    linkedInUsername: 4,
    profileUrl: 3,
    publicUrl: 2,
    recruiterUrl: 2,
    duxsoupId: 1,
  };
  return priorities[type] || 0;
}

/**
 * Find the highest-priority alias for a person
 */
function findBestAlias(person) {
  let best = null;
  let bestPriority = -1;

  for (const alias of person.aliases) {
    const priority = getIdentifierPriority(alias.type);
    if (priority > bestPriority) {
      bestPriority = priority;
      best = alias;
    }
  }

  return best;
}

/**
 * Analyze a single person record
 */
function analyzePerson(person) {
  stats.analyzed++;

  // Find Sales Nav ID alias (highest priority)
  const salesNavAlias = person.aliases.find(a => a.type === 'salesNavId');
  const usernameAlias = person.aliases.find(a => a.type === 'linkedInUsername');

  if (salesNavAlias) {
    stats.withSalesNavId++;
  }

  if (usernameAlias) {
    stats.withUsername++;
  }

  // Find the best (highest priority) alias
  const bestAlias = findBestAlias(person);

  if (!bestAlias) {
    return; // No aliases to check
  }

  // Compute what the canonical_id SHOULD be based on best alias
  const expectedCanonicalKey = buildCanonicalKey(bestAlias.type, bestAlias.value);
  const expectedCanonicalId = computeCanonicalId(expectedCanonicalKey);

  // Compare with actual canonical_id
  if (person.canonical_id !== expectedCanonicalId) {
    stats.mismatched++;

    // Only keep first 20 examples to avoid memory issues
    if (mismatches.length < 20) {
      mismatches.push({
        person_id: person._id,
        current_canonical_id: person.canonical_id,
        expected_canonical_id: expectedCanonicalId,
        best_alias_type: bestAlias.type,
        best_alias_value: bestAlias.value,
        has_sales_nav_id: !!salesNavAlias,
        sales_nav_id: salesNavAlias?.value,
        has_username: !!usernameAlias,
        username: usernameAlias?.value,
        alias_count: person.aliases.length,
      });
    }
  } else {
    stats.correct++;
  }
}

/**
 * Generate analysis report
 */
function generateReport() {
  console.log('\n========================================');
  console.log('CANONICAL ID MISMATCH ANALYSIS');
  console.log('========================================\n');

  console.log('Summary:');
  console.log(`  Total people analyzed: ${stats.analyzed}`);
  console.log(`  People with Sales Nav ID: ${stats.withSalesNavId} (${((stats.withSalesNavId / stats.analyzed) * 100).toFixed(1)}%)`);
  console.log(`  People with username: ${stats.withUsername} (${((stats.withUsername / stats.analyzed) * 100).toFixed(1)}%)`);
  console.log(`  Correct canonical IDs: ${stats.correct} (${((stats.correct / stats.analyzed) * 100).toFixed(1)}%)`);
  console.log(`  Mismatched canonical IDs: ${stats.mismatched} (${((stats.mismatched / stats.analyzed) * 100).toFixed(1)}%)\n`);

  if (mismatches.length > 0) {
    console.log(`Top ${Math.min(mismatches.length, 10)} Mismatches (showing first ${Math.min(mismatches.length, 10)} of ${stats.mismatched}):`);
    console.log('────────────────────────────────────────\n');

    mismatches.slice(0, 10).forEach((mismatch, idx) => {
      console.log(`${idx + 1}. Person: ${mismatch.person_id}`);
      console.log(`   Best alias: ${mismatch.best_alias_type} = ${mismatch.best_alias_value}`);
      console.log(`   Has Sales Nav ID: ${mismatch.has_sales_nav_id ? 'YES' : 'NO'}${mismatch.has_sales_nav_id ? ` (${mismatch.sales_nav_id})` : ''}`);
      console.log(`   Current canonical_id: ${mismatch.current_canonical_id}`);
      console.log(`   Expected canonical_id: ${mismatch.expected_canonical_id}`);
      console.log('');
    });

    if (stats.mismatched > 10) {
      console.log(`... and ${stats.mismatched - 10} more\n`);
    }
  }

  console.log('\n========================================');
  console.log('RECOMMENDATION');
  console.log('========================================\n');

  if (stats.mismatched > 0) {
    const pct = ((stats.mismatched / stats.analyzed) * 100).toFixed(1);
    console.log(`⚠️  ${stats.mismatched} people (${pct}%) have canonical IDs that don't match their best identifier.`);
    console.log('');
    console.log('This happens when:');
    console.log('  1. First observation lacks Sales Nav ID');
    console.log('  2. Person created with username/URL-based canonical_id');
    console.log('  3. Later observation includes Sales Nav ID (added as alias)');
    console.log('  4. Canonical ID never updated to reflect better identifier\n');
    console.log('Impact:');
    console.log('  - Canonical IDs based on LESS STABLE identifiers (usernames, URLs)');
    console.log('  - Searching by "correct" canonical_id won\'t find these people');
    console.log('  - Identity resolution warnings in logs\n');
    console.log('Recommendation:');
    console.log('  Run migration script to update canonical_ids:');
    console.log('  node scripts/migrate-canonical-ids-batched.js --execute\n');
  } else {
    console.log('✅ All canonical IDs match the best available identifier. No action needed.\n');
  }
}

async function main() {
  const batchSize = 500;

  try {
    console.log('Connecting to database...');
    await database.connect();

    console.log(`Processing in batches of ${batchSize}...\n`);

    // Count total records
    const totalCount = await Person.countDocuments();
    stats.total = totalCount;
    console.log(`Total people in database: ${totalCount}`);
    console.log('');

    // Process in batches
    let skip = 0;
    let batchNum = 0;

    while (skip < totalCount) {
      batchNum++;
      process.stdout.write(`Processing batch ${batchNum} (${skip + 1} - ${Math.min(skip + batchSize, totalCount)})... `);

      const batch = await Person.find({})
        .select('_id canonical_id aliases')
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (batch.length === 0) {
        break;
      }

      for (const person of batch) {
        analyzePerson(person);
      }

      console.log('✓');

      skip += batchSize;

      // Free memory
      if (global.gc) {
        global.gc();
      }
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

module.exports = { analyzePerson, findBestAlias };
