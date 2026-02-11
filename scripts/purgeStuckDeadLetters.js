#!/usr/bin/env node

/**
 * Purge Stuck Dead Letters
 *
 * Marks dead letters as permanently_failed when the error is a non-transient
 * validation failure (CastError, ValidationError, invalid _id format).
 * These records will never succeed on replay and waste retry cycles.
 *
 * Usage:
 *   node scripts/purgeStuckDeadLetters.js                # Dry-run (default)
 *   node scripts/purgeStuckDeadLetters.js --commit       # Execute updates
 *   node scripts/purgeStuckDeadLetters.js --limit=50     # Limit to 50 records
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const logger = require('../src/utils/logger');
const { isPermanentError } = require('../src/utils/errorClassifier');

function parseArgs() {
  const args = {
    dryRun: true,
    limit: null,
  };

  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'commit') args.dryRun = false;
    else if (key === 'dry-run') args.dryRun = true;
    else if (key === 'limit') args.limit = parseInt(value, 10);
  });

  return args;
}

/**
 * Find and purge stuck dead letters.
 *
 * @param {Object} options
 * @param {boolean} options.dryRun - Preview only (default true)
 * @param {number|null} options.limit - Max records to process
 * @param {boolean} options.managedConnection - Skip connect/disconnect if true
 * @returns {Object} stats
 */
async function purgeStuckDeadLetters(options = {}) {
  const { dryRun = true, limit = null, managedConnection = false } = options;

  console.log('\n========================================');
  console.log('PURGE STUCK DEAD LETTERS');
  console.log('========================================\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'EXECUTE (writing to DB)'}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log('');

  if (!managedConnection) {
    await database.connect();
  }

  // Find all non-terminal dead letters (pending or failed_again)
  const query = { status: { $in: ['pending', 'failed_again'] } };
  const deadLetters = limit
    ? await DeadLetter.find(query).sort({ createdAt: 1 }).limit(limit)
    : await DeadLetter.find(query).sort({ createdAt: 1 });

  const stats = {
    total: deadLetters.length,
    purged: 0,
    skipped: 0,
    errorBreakdown: {},
  };

  console.log(`Found ${stats.total} non-terminal dead letters\n`);

  for (const dl of deadLetters) {
    const errorMsg = dl.error?.message || dl.last_replay_error || '';
    const isPermanent = isPermanentError(errorMsg);

    if (isPermanent) {
      // Track error pattern for reporting
      const shortError = errorMsg.substring(0, 80);
      stats.errorBreakdown[shortError] = (stats.errorBreakdown[shortError] || 0) + 1;

      if (!dryRun) {
        await DeadLetter.findByIdAndUpdate(dl._id, {
          status: 'permanently_failed',
          last_replay_error: `Purged: ${errorMsg}`,
          next_replay_at: null,
          errorClass: 'permanent',
        });
      }

      stats.purged++;
      logger.info('Purging stuck dead letter', {
        id: dl._id,
        observation_id: dl.observation_id,
        error: shortError,
        attempts: dl.replay_attempts,
        dryRun,
      });
    } else {
      stats.skipped++;
    }
  }

  // Report
  console.log('\n========================================');
  console.log('PURGE REPORT');
  console.log('========================================\n');
  console.log(`  Total examined: ${stats.total}`);
  console.log(`  Purged (permanent failures): ${stats.purged}`);
  console.log(`  Skipped (transient/retryable): ${stats.skipped}`);

  if (Object.keys(stats.errorBreakdown).length > 0) {
    console.log('\n  Error patterns purged:');
    Object.entries(stats.errorBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([error, count]) => {
        console.log(`    [${count}x] ${error}`);
      });
  }

  console.log(`\n  ${dryRun ? 'DRY-RUN: No changes made. Use --commit to execute.' : 'Done.'}`);
  console.log('\n========================================\n');

  if (!managedConnection) {
    await database.disconnect();
  }

  return stats;
}

// CLI execution
if (require.main === module) {
  const args = parseArgs();

  purgeStuckDeadLetters(args)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Purge failed:', error);
      process.exit(1);
    });
}

module.exports = { purgeStuckDeadLetters, isPermanentError };
