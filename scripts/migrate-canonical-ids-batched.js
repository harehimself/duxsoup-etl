#!/usr/bin/env node

/**
 * Migrate Canonical IDs (Memory-Efficient Batched Version)
 *
 * This version processes records in batches to avoid memory issues
 * on environments with limited RAM (like Render free tier).
 *
 * Usage:
 *   node scripts/migrate-canonical-ids-batched.js              # Dry run
 *   node scripts/migrate-canonical-ids-batched.js --execute    # Apply changes
 *   node scripts/migrate-canonical-ids-batched.js --batch-size=500  # Custom batch size
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
 * Process a single batch of people
 */
async function processBatch(people, dryRun) {
  const updates = [];

  // Analyze batch
  for (const person of people) {
    stats.analyzed++;

    const bestAlias = findBestAlias(person);

    if (!bestAlias) {
      stats.skipped++;
      continue;
    }

    const expectedCanonicalKey = buildCanonicalKey(bestAlias.type, bestAlias.value);
    const expectedCanonicalId = computeCanonicalId(expectedCanonicalKey);

    if (person.canonical_id !== expectedCanonicalId) {
      stats.mismatched++;
      updates.push({
        person_id: person._id,
        old_canonical_id: person.canonical_id,
        new_canonical_id: expectedCanonicalId,
        best_alias_type: bestAlias.type,
        best_alias_value: bestAlias.value,
      });
    }
  }

  // Apply updates
  if (updates.length > 0 && !dryRun) {
    for (const update of updates) {
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

        // Progress indicator every 100 updates
        if (stats.updated % 100 === 0) {
          console.log(`  Progress: ${stats.updated} updated...`);
        }
      } catch (error) {
        logger.error('Failed to update person', {
          person_id: update.person_id,
          error: error.message,
        });
        stats.failed++;
      }
    }
  }

  return updates.length;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 500;

  try {
    console.log('Connecting to database...');
    await database.connect();

    console.log(`Processing in batches of ${batchSize}...`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

    // Count total records
    const totalCount = await Person.countDocuments();
    stats.total = totalCount;
    console.log(`Total people in database: ${totalCount}`);
    console.log('');

    // Process in batches using cursor
    let skip = 0;
    let batchNum = 0;

    while (skip < totalCount) {
      batchNum++;
      console.log(`Processing batch ${batchNum} (records ${skip + 1} - ${Math.min(skip + batchSize, totalCount)})...`);

      // Fetch batch with lean() to reduce memory usage
      const batch = await Person.find({})
        .select('_id canonical_id aliases')
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (batch.length === 0) {
        break;
      }

      const updatesInBatch = await processBatch(batch, dryRun);

      if (updatesInBatch > 0) {
        console.log(`  Found ${updatesInBatch} mismatches in this batch`);
      }

      skip += batchSize;

      // Free memory
      if (global.gc) {
        global.gc();
      }
    }

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

    console.log('========================================');

    if (dryRun && stats.mismatched > 0) {
      console.log(`\n✅ Dry run complete. Found ${stats.mismatched} records to update.`);
      console.log('Run with --execute to apply changes.\n');
    } else if (!dryRun && stats.updated > 0) {
      console.log(`\n✅ Migration complete. ${stats.updated} records updated.\n`);
    } else {
      console.log('\n✅ No records needed migration.\n');
    }

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

module.exports = { processBatch, findBestAlias };
