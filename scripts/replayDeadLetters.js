/**
 * Dead Letter Replay Script
 *
 * Replays failed observation-to-person conversions from the dead_letters collection.
 * Resolves validation errors that occurred during initial processing.
 *
 * Usage:
 *   node scripts/replayDeadLetters.js --dry-run          # Preview only
 *   node scripts/replayDeadLetters.js --limit 100        # Test with 100 records
 *   node scripts/replayDeadLetters.js --execute          # Run full replay
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const database = require('../src/utils/database');
const DeadLetter = require('../src/models/deadLetter');
const Scan = require('../src/models/scan');
const Visit = require('../src/models/visit');
const { upsertFromObservation } = require('../src/controllers/personController');
const { upsertCompanyFromObservation } = require('../src/controllers/companyController');
const { upsertLocationFromObservation } = require('../src/controllers/locationController');
const logger = require('../src/utils/logger');

// Statistics
const stats = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  companySucceeded: 0,
  companyFailed: 0,
  locationSucceeded: 0,
  locationFailed: 0,
  errors: {},
  startTime: null,
  endTime: null,
};

/**
 * Replay a single dead letter
 */
async function replayDeadLetter(deadLetter, dryRun = true) {
  try {
    // Get the original observation (scan or visit)
    const Model = deadLetter.sourceType === 'scan' ? Scan : Visit;
    const observation = await Model.findById(deadLetter.observation_id);

    if (!observation) {
      logger.warn('Observation not found for dead letter', {
        dead_letter_id: deadLetter._id,
        observation_id: deadLetter.observation_id,
        sourceType: deadLetter.sourceType,
      });
      stats.skipped++;
      return { success: false, reason: 'observation_not_found' };
    }

    // Try to create/update person from observation
    if (!dryRun) {
      const person = await upsertFromObservation(observation, deadLetter.sourceType);

      if (person) {
        // Success - mark dead letter as replayed using static method
        await DeadLetter.markReplayed(deadLetter.observation_id);

        stats.succeeded++;
        logger.info('Successfully replayed dead letter', {
          dead_letter_id: deadLetter._id,
          person_id: person._id,
          sourceType: deadLetter.sourceType,
        });

        // Best-effort company upsert
        try {
          await upsertCompanyFromObservation(observation, deadLetter.sourceType);
          stats.companySucceeded++;
        } catch (companyErr) {
          stats.companyFailed++;
          logger.warn('Company upsert failed during replay (non-blocking)', {
            dead_letter_id: deadLetter._id,
            error: companyErr.message,
          });
        }

        // Best-effort location upsert
        try {
          await upsertLocationFromObservation(observation, deadLetter.sourceType);
          stats.locationSucceeded++;
        } catch (locationErr) {
          stats.locationFailed++;
          logger.warn('Location upsert failed during replay (non-blocking)', {
            dead_letter_id: deadLetter._id,
            error: locationErr.message,
          });
        }

        return { success: true, person_id: person._id };
      } else {
        stats.failed++;
        return { success: false, reason: 'upsert_returned_null' };
      }
    } else {
      // Dry run - just validate that observation exists (person + company + location would be attempted)
      stats.succeeded++;
      return { success: true, dry_run: true };
    }
  } catch (error) {
    stats.failed++;

    // Track error types
    const errorKey = error.message.substring(0, 100);
    stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;

    if (!dryRun) {
      // Update dead letter with new error using static method (handles backoff + permanent failure)
      await DeadLetter.markReplayFailed(deadLetter.observation_id, error);
    }

    logger.error('Failed to replay dead letter', {
      dead_letter_id: deadLetter._id,
      observation_id: deadLetter.observation_id,
      error: error.message,
    });

    return { success: false, reason: 'error', error: error.message };
  }
}

/**
 * Generate report
 */
function generateReport() {
  const duration = stats.endTime - stats.startTime;
  const durationSec = Math.round(duration / 1000);

  console.log('\n========================================');
  console.log('DEAD LETTER REPLAY REPORT');
  console.log('========================================\n');

  console.log('Person Upserts:');
  console.log(`  Total dead letters: ${stats.total}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Succeeded: ${stats.succeeded}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Success rate: ${stats.processed > 0 ? Math.round((stats.succeeded / stats.processed) * 100) : 0}%`);
  console.log(`  Duration: ${durationSec}s\n`);

  console.log('Company Upserts (best-effort):');
  console.log(`  Succeeded: ${stats.companySucceeded}`);
  console.log(`  Failed: ${stats.companyFailed}\n`);

  console.log('Location Upserts (best-effort):');
  console.log(`  Succeeded: ${stats.locationSucceeded}`);
  console.log(`  Failed: ${stats.locationFailed}\n`);

  if (Object.keys(stats.errors).length > 0) {
    console.log('Error Types:');
    Object.entries(stats.errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([error, count]) => {
        console.log(`  [${count}x] ${error}`);
      });
    console.log('');
  }

  console.log('========================================\n');
}

/**
 * Main replay function
 */
async function replayDeadLetters(options = {}) {
  const { dryRun = true, limit = null, status = null, managedConnection = false } = options;

  stats.startTime = new Date();

  console.log('\n========================================');
  console.log('DEAD LETTER REPLAY');
  console.log('========================================\n');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'EXECUTE (writing to DB)'}`);
  console.log(`Status filter: ${status || 'eligible (backoff-aware)'}`);
  console.log(`Limit: ${limit || 'none'}\n`);

  // Connect to database only if not using managed connection (i.e., CLI mode)
  if (!managedConnection) {
    await database.connect();
  }

  // Get dead letters
  let deadLetters;
  if (status) {
    // Explicit status filter (CLI --status path)
    const query = { status };
    deadLetters = limit
      ? await DeadLetter.find(query).limit(limit)
      : await DeadLetter.find(query);
  } else {
    // Scheduler path: backoff-aware eligibility query
    deadLetters = await DeadLetter.findEligibleForReplay(limit || 100);
  }

  stats.total = deadLetters.length;

  console.log(`Found ${stats.total} dead letters to replay\n`);

  if (stats.total === 0) {
    console.log('No dead letters to replay. Exiting.\n');
    // Only disconnect if we connected (CLI mode)
    if (!managedConnection) {
      await database.disconnect();
    }
    return stats;
  }

  // Process dead letters
  for (const deadLetter of deadLetters) {
    await replayDeadLetter(deadLetter, dryRun);
    stats.processed++;

    // Progress update every 50 records
    if (stats.processed % 50 === 0) {
      logger.info('Replay progress', {
        processed: stats.processed,
        succeeded: stats.succeeded,
        failed: stats.failed,
        skipped: stats.skipped,
      });
    }
  }

  stats.endTime = new Date();
  generateReport();

  // Only disconnect if we connected (CLI mode)
  if (!managedConnection) {
    await database.disconnect();
  }

  return stats;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: !args.includes('--execute'),
    limit: null,
    status: null,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--status' && args[i + 1]) {
      options.status = args[i + 1];
    }
  }

  replayDeadLetters(options)
    .then(() => {
      console.log('Replay completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Replay failed:', error);
      process.exit(1);
    });
}

module.exports = { replayDeadLetters, replayDeadLetter };
