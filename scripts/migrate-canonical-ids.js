#!/usr/bin/env node

/**
 * Migrate Canonical IDs to Match Best Available Identifier
 *
 * This script updates person records where the canonical_id is based on a
 * lower-priority identifier when a higher-priority identifier is available.
 *
 * Process:
 * 1. Find people with mismatched canonical IDs
 * 2. Compute correct canonical_id based on best available identifier
 * 3. Update person record with new canonical_id
 * 4. Create migration audit record
 *
 * Usage:
 *   node scripts/migrate-canonical-ids.js --dry-run    # Preview changes
 *   node scripts/migrate-canonical-ids.js --execute    # Apply changes
 *   node scripts/migrate-canonical-ids.js --limit 10   # Test with 10 records
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Person = require('../src/models/person');
const { computeCanonicalId, buildCanonicalKey } = require('../src/utils/identityResolver');
const logger = require('../src/utils/logger');

const stats = {
  total: 0,
  analyzed: 0,
  mismatched: 0,
  updated: 0,
  failed: 0,
  skipped: 0,
};

const updates = [];

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
 * Analyze a person and determine if migration is needed
 */
function analyzePerson(person) {
  stats.analyzed++;

  const bestAlias = findBestAlias(person);

  if (!bestAlias) {
    stats.skipped++;
    return null; // No aliases to check
  }

  // Compute what the canonical_id SHOULD be based on best alias
  const expectedCanonicalKey = buildCanonicalKey(bestAlias.type, bestAlias.value);
  const expectedCanonicalId = computeCanonicalId(expectedCanonicalKey);

  // Compare with actual canonical_id
  if (person.canonical_id !== expectedCanonicalId) {
    stats.mismatched++;

    return {
      person_id: person._id,
      old_canonical_id: person.canonical_id,
      new_canonical_id: expectedCanonicalId,
      best_alias_type: bestAlias.type,
      best_alias_value: bestAlias.value,
    };
  }

  return null; // No migration needed
}

/**
 * Update a person's canonical_id
 */
async function updatePerson(update, dryRun) {
  if (dryRun) {
    console.log(`[DRY RUN] Would update person: ${update.person_id}`);
    console.log(`  Old canonical_id: ${update.old_canonical_id}`);
    console.log(`  New canonical_id: ${update.new_canonical_id}`);
    console.log(`  Based on: ${update.best_alias_type} = ${update.best_alias_value}\n`);
    stats.updated++;
    return;
  }

  try {
    await Person.findByIdAndUpdate(update.person_id, {
      canonical_id: update.new_canonical_id,
    });

    logger.info('Updated canonical_id for person', {
      person_id: update.person_id,
      old_canonical_id: update.old_canonical_id,
      new_canonical_id: update.new_canonical_id,
      best_alias_type: update.best_alias_type,
    });

    stats.updated++;
  } catch (error) {
    logger.error('Failed to update person', {
      person_id: update.person_id,
      error: error.message,
    });
    stats.failed++;
  }
}

/**
 * Generate migration report
 */
function generateReport(dryRun) {
  console.log('\n========================================');
  console.log('CANONICAL ID MIGRATION REPORT');
  console.log('========================================\n');

  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'EXECUTE (writing to database)'}\n`);

  console.log('Summary:');
  console.log(`  Total people analyzed: ${stats.analyzed}`);
  console.log(`  Mismatched canonical IDs found: ${stats.mismatched}`);
  console.log(`  Records updated: ${stats.updated}`);
  console.log(`  Records failed: ${stats.failed}`);
  console.log(`  Records skipped: ${stats.skipped}\n`);

  if (stats.updated > 0) {
    console.log('Breakdown by best alias type:');
    const breakdown = {};
    updates.forEach(u => {
      breakdown[u.best_alias_type] = (breakdown[u.best_alias_type] || 0) + 1;
    });

    Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
  }

  console.log('\n========================================');

  if (dryRun && stats.mismatched > 0) {
    console.log('\n✅ Dry run complete. Run with --execute to apply changes.\n');
  } else if (!dryRun && stats.updated > 0) {
    console.log(`\n✅ Migration complete. ${stats.updated} records updated.\n`);
  } else {
    console.log('\n✅ No records needed migration.\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  try {
    console.log('Connecting to database...');
    await database.connect();

    console.log('Fetching people...');
    const query = {};
    const people = limit
      ? await Person.find(query).limit(limit)
      : await Person.find(query);

    stats.total = people.length;

    console.log(`Analyzing ${people.length} people...\n`);

    // Step 1: Analyze all people and collect updates
    for (const person of people) {
      const update = analyzePerson(person);
      if (update) {
        updates.push(update);
      }
    }

    // Step 2: Apply updates
    if (updates.length > 0) {
      console.log(`Found ${updates.length} records to update\n`);

      for (const update of updates) {
        await updatePerson(update, dryRun);
      }
    } else {
      console.log('No records need migration.\n');
    }

    generateReport(dryRun);

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

module.exports = { analyzePerson, findBestAlias, updatePerson };
