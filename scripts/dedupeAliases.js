#!/usr/bin/env node

/**
 * Alias Deduplication Script
 *
 * Removes duplicate aliases from people records (by type+value).
 *
 * Usage:
 *   node scripts/dedupeAliases.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N people (default: 1000)
 *   --batch-size=N       Process N people per batch (default: 100)
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');
const logger = require('../src/utils/logger');

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 1000,
    batchSize: 100,
  };

  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'dry-run') args.dryRun = true;
    else if (key === 'commit') {
      args.dryRun = false;
      args.commit = true;
    } else if (key === 'limit') args.limit = parseInt(value, 10);
    else if (key === 'batch-size') args.batchSize = parseInt(value, 10);
  });

  return args;
}

function dedupeAliases(aliases = []) {
  const seen = new Set();
  const unique = [];

  aliases.forEach(alias => {
    if (!alias || !alias.type || !alias.value) return;
    const key = `${alias.type}:${alias.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(alias);
  });

  return unique;
}

async function runDedupe(args) {
  console.log('🧹 Starting alias dedupe...');
  console.log('Options:', args);
  console.log('');

  if (args.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Use --commit to execute updates\n');
  }

  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    const people = await Person.find({})
      .limit(args.limit)
      .select('_id aliases')
      .lean();

    for (let i = 0; i < people.length; i += args.batchSize) {
      const batch = people.slice(i, i + args.batchSize);
      const updates = [];

      batch.forEach(person => {
        stats.processed += 1;
        const uniqueAliases = dedupeAliases(person.aliases);

        if (uniqueAliases.length === (person.aliases || []).length) {
          stats.skipped += 1;
          return;
        }

        if (args.dryRun) {
          logger.info('Would dedupe aliases', {
            person_id: person._id,
            before: person.aliases.length,
            after: uniqueAliases.length,
          });
          stats.updated += 1;
          return;
        }

        updates.push({
          updateOne: {
            filter: { _id: person._id },
            update: { $set: { aliases: uniqueAliases } },
          },
        });
      });

      if (!args.dryRun && updates.length > 0) {
        try {
          await Person.bulkWrite(updates, { ordered: false });
          stats.updated += updates.length;
        } catch (error) {
          stats.failed += updates.length;
          logger.error('Bulk alias dedupe failed', { error: error.message });
        }
      }
    }

    console.log('\n✅ Alias dedupe complete');
    console.log('Stats:', stats);
  } catch (error) {
    logger.error('Alias dedupe failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

const args = parseArgs();

runDedupe(args)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
