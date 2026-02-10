#!/usr/bin/env node

/**
 * Resurrect Dead Letters
 *
 * Resets permanently_failed dead letters back to pending when the underlying
 * error has been fixed in code. This allows the hourly replay scheduler to
 * retry them with the corrected logic.
 *
 * Example: dead letters that failed with "Cast to string" errors before the
 * coerceToString() fix can now succeed on replay.
 *
 * Usage:
 *   node scripts/resurrectDeadLetters.js                # Dry-run (default)
 *   node scripts/resurrectDeadLetters.js --commit       # Execute updates
 *   node scripts/resurrectDeadLetters.js --limit=50     # Limit to 50 records
 *   node scripts/resurrectDeadLetters.js --pattern="Cast to string"  # Custom pattern
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const logger = require('../src/utils/logger');

/**
 * Error patterns for bugs that have been fixed in code.
 * Dead letters matching these patterns can be retried.
 */
const FIXED_ERROR_PATTERNS = [
  /Cast to string failed/i,
  /Cast to String failed/i,
];

/**
 * Check if a dead letter's error matches a now-fixed pattern.
 */
function isFixedError(errorMessage) {
  if (!errorMessage) return false;
  return FIXED_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage));
}

function parseArgs() {
  const args = {
    dryRun: true,
    limit: null,
    pattern: null,
  };

  process.argv.slice(2).forEach(arg => {
    const [key, ...rest] = arg.replace('--', '').split('=');
    const value = rest.join('=');
    if (key === 'commit') args.dryRun = false;
    else if (key === 'dry-run') args.dryRun = true;
    else if (key === 'limit') args.limit = parseInt(value, 10);
    else if (key === 'pattern') args.pattern = value;
  });

  return args;
}

/**
 * Resurrect permanently_failed dead letters that match fixable error patterns.
 *
 * @param {Object} options
 * @param {boolean} options.dryRun - Preview only (default true)
 * @param {number|null} options.limit - Max records to process
 * @param {string|null} options.pattern - Custom error pattern to match (overrides defaults)
 * @param {boolean} options.managedConnection - Skip connect/disconnect if true
 * @returns {Object} stats
 */
async function resurrectDeadLetters(options = {}) {
  const { dryRun = true, limit = null, pattern = null, managedConnection = false } = options;

  const matchFn = pattern
    ? (msg) => msg && new RegExp(pattern, 'i').test(msg)
    : isFixedError;

  console.log('\n========================================');
  console.log('RESURRECT DEAD LETTERS');
  console.log('========================================\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'EXECUTE (writing to DB)'}`);
  console.log(`Pattern: ${pattern || 'default (Cast to string)'}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log('');

  if (!managedConnection) {
    await database.connect();
  }

  // Find permanently_failed dead letters
  const query = { status: 'permanently_failed' };
  const deadLetters = limit
    ? await DeadLetter.find(query).sort({ createdAt: 1 }).limit(limit)
    : await DeadLetter.find(query).sort({ createdAt: 1 });

  const stats = {
    total: deadLetters.length,
    resurrected: 0,
    skipped: 0,
    errorBreakdown: {},
  };

  console.log(`Found ${stats.total} permanently_failed dead letters\n`);

  for (const dl of deadLetters) {
    const errorMsg = dl.error?.message || dl.last_replay_error || '';
    const isMatch = matchFn(errorMsg);

    if (isMatch) {
      const shortError = errorMsg.substring(0, 80);
      stats.errorBreakdown[shortError] = (stats.errorBreakdown[shortError] || 0) + 1;

      if (!dryRun) {
        await DeadLetter.findByIdAndUpdate(dl._id, {
          status: 'pending',
          replay_attempts: 0,
          next_replay_at: null,
          last_replay_error: `Resurrected: was permanently_failed with: ${shortError}`,
        });
      }

      stats.resurrected++;
      logger.info('Resurrecting dead letter', {
        id: dl._id,
        observation_id: dl.observation_id,
        error: shortError,
        previousAttempts: dl.replay_attempts,
        dryRun,
      });
    } else {
      stats.skipped++;
    }
  }

  // Report
  console.log('\n========================================');
  console.log('RESURRECT REPORT');
  console.log('========================================\n');
  console.log(`  Total examined: ${stats.total}`);
  console.log(`  Resurrected (fixable): ${stats.resurrected}`);
  console.log(`  Skipped (not matching): ${stats.skipped}`);

  if (Object.keys(stats.errorBreakdown).length > 0) {
    console.log('\n  Error patterns resurrected:');
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

  resurrectDeadLetters(args)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Resurrect failed:', error);
      process.exit(1);
    });
}

module.exports = { resurrectDeadLetters, isFixedError };
