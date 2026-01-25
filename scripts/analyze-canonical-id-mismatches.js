#!/usr/bin/env node

/**
 * Analyze Canonical ID Mismatches
 *
 * This script identifies person records where the canonical_id is based on a
 * lower-priority identifier (e.g., username) when a higher-priority identifier
 * (e.g., Sales Nav ID) is available in their aliases.
 *
 * The issue occurs when:
 * 1. First observation lacks Sales Nav ID → person created with username-based canonical_id
 * 2. Later observation includes Sales Nav ID → added as alias, but canonical_id not updated
 *
 * Result: canonical_id doesn't reflect the most stable identifier available
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
 * Higher number = higher priority
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
    console.log('Top 10 Mismatches (showing first 10):');
    console.log('────────────────────────────────────────\n');

    mismatches.slice(0, 10).forEach((mismatch, idx) => {
      console.log(`${idx + 1}. Person: ${mismatch.person_id}`);
      console.log(`   Best alias: ${mismatch.best_alias_type} = ${mismatch.best_alias_value}`);
      console.log(`   Has Sales Nav ID: ${mismatch.has_sales_nav_id ? 'YES' : 'NO'}${mismatch.has_sales_nav_id ? ` (${mismatch.sales_nav_id})` : ''}`);
      console.log(`   Current canonical_id: ${mismatch.current_canonical_id}`);
      console.log(`   Expected canonical_id: ${mismatch.expected_canonical_id}`);
      console.log('');
    });

    if (mismatches.length > 10) {
      console.log(`... and ${mismatches.length - 10} more\n`);
    }
  }

  console.log('Breakdown by best alias type for MISMATCHED records:');
  const breakdown = {};
  mismatches.forEach(m => {
    breakdown[m.best_alias_type] = (breakdown[m.best_alias_type] || 0) + 1;
  });

  Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count} (${((count / stats.mismatched) * 100).toFixed(1)}%)`);
    });

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
    console.log('  Create a migration script to update canonical_ids to match best available identifier.');
    console.log('  Consider updating identityResolverService.js to update canonical_id when better ID found.\n');
  } else {
    console.log('✅ All canonical IDs match the best available identifier. No action needed.\n');
  }
}

async function main() {
  try {
    console.log('Connecting to database...');
    await database.connect();

    console.log('Fetching all people...');
    const people = await Person.find({});
    stats.total = people.length;

    console.log(`Analyzing ${people.length} people...\n`);

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

module.exports = { analyzePerson, findBestAlias };
