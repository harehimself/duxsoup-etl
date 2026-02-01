#!/usr/bin/env node

/**
 * Rollback a person merge operation.
 *
 * Restores loser documents and reverts the winner to its pre-merge state
 * using the snapshots stored in the Merge audit record.
 *
 * Usage:
 *   node scripts/rollback-merge.js <merge_id> --dry-run
 *   node scripts/rollback-merge.js <merge_id> --execute
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Merge = require('../src/models/merge');
const Person = require('../src/models/person');
const logger = require('../src/utils/logger');

const args = process.argv.slice(2);
const mergeId = args.find(a => !a.startsWith('--'));
const isExecute = args.includes('--execute');
const isDryRun = !isExecute;

async function run() {
  if (!mergeId) {
    console.error('Usage: node scripts/rollback-merge.js <merge_id> [--execute|--dry-run]');
    console.error('\nTo list recent merges:');
    console.error('  node scripts/rollback-merge.js --list');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI or MONGO_URI must be set');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');

  if (mergeId === '--list') {
    const merges = await Merge.find({ rolledBack: { $ne: true } })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    if (merges.length === 0) {
      console.log('No active merges found.');
    } else {
      console.log('Recent merges (most recent first):\n');
      for (const m of merges) {
        const hasSnapshots = m.loserSnapshots && m.loserSnapshots.length > 0;
        const rollbackable = hasSnapshots ? 'rollbackable' : 'NO SNAPSHOTS';
        console.log(`  ${m._id}  ${m.timestamp.toISOString()}`);
        console.log(`    winner: ${m.winner_id} | losers: ${m.loser_ids.join(', ')} | ${m.reason} [${rollbackable}]`);
      }
    }

    await mongoose.disconnect();
    return;
  }

  const merge = await Merge.findById(mergeId);

  if (!merge) {
    console.error(`Merge record ${mergeId} not found`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (merge.rolledBack) {
    console.error(`Merge ${mergeId} was already rolled back at ${merge.rolledBackAt}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!merge.loserSnapshots || merge.loserSnapshots.length === 0) {
    console.error(`Merge ${mergeId} has no loser snapshots — cannot rollback.`);
    console.error('This merge was recorded before rollback support was added.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('Merge details:');
  console.log(`  ID:       ${merge._id}`);
  console.log(`  Winner:   ${merge.winner_id}`);
  console.log(`  Losers:   ${merge.loser_ids.join(', ')}`);
  console.log(`  Reason:   ${merge.reason}`);
  console.log(`  Date:     ${merge.timestamp.toISOString()}`);
  console.log(`  Snapshots: ${merge.loserSnapshots.length} loser(s), winner: ${merge.winnerSnapshotBefore ? 'yes' : 'no'}`);
  console.log(`  Mode:     ${isDryRun ? 'DRY RUN' : 'EXECUTE'}\n`);

  if (isDryRun) {
    console.log('Would perform the following actions:');
    console.log(`  1. Restore ${merge.loserSnapshots.length} loser document(s)`);
    if (merge.winnerSnapshotBefore) {
      console.log('  2. Revert winner to pre-merge state');
    }
    console.log('  3. Mark merge record as rolled back');
    console.log('\nRun with --execute to perform the rollback.');
    await mongoose.disconnect();
    return;
  }

  // Execute rollback
  console.log('Executing rollback...\n');

  // Step 1: Restore loser documents
  for (const loserDoc of merge.loserSnapshots) {
    try {
      // Remove Mongoose internal fields
      const { __v, ...docData } = loserDoc;
      await Person.create(docData);
      console.log(`  Restored loser: ${loserDoc._id}`);
    } catch (error) {
      if (error.code === 11000) {
        console.warn(`  Loser ${loserDoc._id} already exists — skipping restore`);
      } else {
        console.error(`  Failed to restore loser ${loserDoc._id}: ${error.message}`);
      }
    }
  }

  // Step 2: Revert winner to pre-merge state
  if (merge.winnerSnapshotBefore) {
    try {
      const { __v, _id, ...winnerData } = merge.winnerSnapshotBefore;
      await Person.findByIdAndUpdate(merge.winner_id, {
        $set: {
          aliases: winnerData.aliases,
          snapshot: winnerData.snapshot,
          observations: winnerData.observations,
          derived: winnerData.derived,
        },
      });
      console.log(`  Reverted winner: ${merge.winner_id}`);
    } catch (error) {
      console.error(`  Failed to revert winner: ${error.message}`);
    }
  }

  // Step 3: Mark merge as rolled back
  merge.rolledBack = true;
  merge.rolledBackAt = new Date();
  await merge.save();

  console.log(`\nRollback complete for merge ${mergeId}`);

  await mongoose.disconnect();
}

run().catch(error => {
  console.error('Rollback failed:', error.message);
  process.exit(1);
});
