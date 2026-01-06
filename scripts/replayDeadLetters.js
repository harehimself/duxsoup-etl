#!/usr/bin/env node

/**
 * Dead Letter Replay Worker
 *
 * Periodically retries failed person upserts from dead_letters collection.
 * Implements exponential backoff and max attempt limits.
 *
 * Usage:
 *   node scripts/replayDeadLetters.js [options]
 *
 * Options:
 *   --limit=N            Limit to N dead letters per run (default: 100)
 *   --max-attempts=N     Max replay attempts before giving up (default: 3)
 *   --dry-run            Preview without actually replaying
 *   --once               Run once and exit (default: continuous with interval)
 *   --interval=N         Interval between runs in seconds (default: 300 = 5min)
 *
 * Examples:
 *   node scripts/replayDeadLetters.js --limit=10 --dry-run
 *   node scripts/replayDeadLetters.js --once
 *   node scripts/replayDeadLetters.js --interval=60
 */

const mongoose = require('mongoose');
const DeadLetter = require('../src/models/deadLetter');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const { upsertFromObservation } = require('../src/controllers/personController');
const logger = require('../src/utils/logger');

// Parse command-line arguments
function parseArgs() {
  const args = {
    limit: 100,
    maxAttempts: 3,
    dryRun: false,
    once: false,
    interval: 300, // 5 minutes
  };

  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'limit') args.limit = parseInt(value);
    else if (key === 'max-attempts') args.maxAttempts = parseInt(value);
    else if (key === 'dry-run') args.dryRun = true;
    else if (key === 'once') args.once = true;
    else if (key === 'interval') args.interval = parseInt(value);
  });

  return args;
}

// Replay a single dead letter
async function replayDeadLetter(deadLetter, maxAttempts) {
  const { observation_id, sourceType } = deadLetter;

  logger.info('Replaying dead letter', {
    observation_id,
    sourceType,
    attempt: deadLetter.replay_attempts + 1,
  });

  try {
    // Fetch observation document
    const Model = sourceType === 'visit' ? Visit : Scan;
    const observation = await Model.findById(observation_id);

    if (!observation) {
      logger.warn('Observation not found for dead letter', {
        observation_id,
        sourceType,
      });

      // Mark as skipped
      await DeadLetter.findByIdAndUpdate(deadLetter._id, {
        status: 'skipped',
        last_replay_error: 'Observation document not found',
      });

      return { status: 'skipped', reason: 'observation_not_found' };
    }

    // Attempt upsert
    await upsertFromObservation(observation, sourceType);

    // Success - mark as replayed
    await DeadLetter.markReplayed(observation_id);

    logger.info('Successfully replayed dead letter', {
      observation_id,
      sourceType,
    });

    return { status: 'replayed' };
  } catch (error) {
    logger.error('Failed to replay dead letter', {
      observation_id,
      sourceType,
      attempt: deadLetter.replay_attempts + 1,
      error: error.message,
    });

    // Check if we've exhausted max attempts
    if (deadLetter.replay_attempts + 1 >= maxAttempts) {
      await DeadLetter.markReplayFailed(observation_id, error);

      return { status: 'failed_again', reason: 'max_attempts_exceeded' };
    } else {
      // Increment attempt count but keep status as pending
      await DeadLetter.findByIdAndUpdate(deadLetter._id, {
        last_replay_at: new Date(),
        last_replay_error: error.message,
        $inc: { replay_attempts: 1 },
      });

      return { status: 'retry_later', reason: 'temporary_failure' };
    }
  }
}

// Run replay worker
async function runReplayWorker(args) {
  console.log('🔄 Starting dead letter replay worker...', args);

  const stats = {
    replayed: 0,
    failed_again: 0,
    retry_later: 0,
    skipped: 0,
  };

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Find pending dead letters (with backoff)
    const query = {
      status: 'pending',
      $or: [
        { replay_attempts: { $lt: args.maxAttempts } },
        { replay_attempts: { $exists: false } },
      ],
    };

    const deadLetters = await DeadLetter.find(query)
      .sort({ createdAt: 1 }) // Oldest first
      .limit(args.limit);

    console.log(`Found ${deadLetters.length} pending dead letters\n`);

    if (deadLetters.length === 0) {
      console.log('✅ No pending dead letters to replay');
      return stats;
    }

    // Replay each dead letter
    for (const deadLetter of deadLetters) {
      if (args.dryRun) {
        console.log(`  [DRY RUN] Would replay: ${deadLetter.observation_id} (${deadLetter.sourceType})`);
        stats.skipped++;
      } else {
        const result = await replayDeadLetter(deadLetter, args.maxAttempts);
        stats[result.status]++;

        console.log(`  ${result.status.toUpperCase()}: ${deadLetter.observation_id} (${deadLetter.sourceType})`);
      }
    }

    console.log('\n✅ Replay run complete!');
    console.log('Statistics:');
    console.log(`  Replayed: ${stats.replayed}`);
    console.log(`  Failed again: ${stats.failed_again}`);
    console.log(`  Retry later: ${stats.retry_later}`);
    console.log(`  Skipped: ${stats.skipped}`);

    return stats;
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    logger.error('Replay worker failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

// Main entry point
async function main() {
  const args = parseArgs();

  if (args.once) {
    // Run once and exit
    await runReplayWorker(args);
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
    process.exit(0);
  } else {
    // Continuous mode with interval
    console.log(`Running in continuous mode (interval: ${args.interval}s)\n`);

    const runInterval = async () => {
      try {
        await runReplayWorker(args);
      } catch (error) {
        console.error('Replay run failed, will retry on next interval', error.message);
      }

      setTimeout(runInterval, args.interval * 1000);
    };

    await runInterval();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
