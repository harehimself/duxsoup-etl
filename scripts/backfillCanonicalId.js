#!/usr/bin/env node

/**
 * Canonical ID Backfill
 *
 * Populates canonical_id for people missing it using best-available identifiers.
 * Priority: salesNavId alias > numericId alias > publicUrl alias > inferred from _id.
 *
 * Usage:
 *   node scripts/backfillCanonicalId.js [options]
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
const {
  extractPublicProfileUrl,
  buildCanonicalKey,
  computeCanonicalId,
} = require('../src/utils/identityMatcher');

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

function pickPrimaryAlias(aliases = []) {
  const salesNav = aliases.find(a => a.type === 'salesNavId' && a.value);
  if (salesNav) return { type: 'salesNavId', value: salesNav.value };

  const numeric = aliases.find(a => a.type === 'numericId' && a.value);
  if (numeric) return { type: 'numericId', value: numeric.value };

  const publicUrl = aliases.find(a => a.type === 'publicUrl' && a.value);
  if (publicUrl) {
    return {
      type: 'publicUrl',
      value: extractPublicProfileUrl(publicUrl.value) || publicUrl.value,
    };
  }

  return null;
}

function inferPrimaryFromId(personId) {
  if (!personId || typeof personId !== 'string') return null;

  if (/^(ACwAAA|ACoAAA)/.test(personId)) {
    return { type: 'salesNavId', value: personId };
  }

  if (/^\d+$/.test(personId)) {
    return { type: 'numericId', value: personId };
  }

  const normalized = extractPublicProfileUrl(personId);
  if (normalized) {
    return { type: 'publicUrl', value: normalized };
  }

  return null;
}

function computeCanonicalForPerson(person) {
  const primary = pickPrimaryAlias(person.aliases) || inferPrimaryFromId(person._id);
  if (!primary) return null;

  const canonicalKey = buildCanonicalKey(primary.type, primary.value);
  const canonicalId = computeCanonicalId(canonicalKey);

  if (!canonicalId) return null;

  return {
    canonical_id: canonicalId,
    canonical_key: canonicalKey,
    primary_type: primary.type,
    primary_value: primary.value,
  };
}

async function backfillCanonicalId(args) {
  console.log('🧭 Starting canonical_id backfill...');
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

    const query = {
      $or: [
        { canonical_id: { $exists: false } },
        { canonical_id: null },
        { canonical_id: '' },
      ],
    };

    const people = await Person.find(query)
      .limit(args.limit)
      .lean();

    console.log(`Found ${people.length} people missing canonical_id\n`);

    for (let i = 0; i < people.length; i += args.batchSize) {
      const batch = people.slice(i, i + args.batchSize);

      for (const person of batch) {
        stats.processed += 1;
        const computed = computeCanonicalForPerson(person);

        if (!computed) {
          stats.skipped += 1;
          logger.warn('Skipping person: no canonical key available', {
            person_id: person._id,
          });
          continue;
        }

        if (args.dryRun) {
          logger.info('Would update canonical_id', {
            person_id: person._id,
            canonical_id: computed.canonical_id,
            canonical_key: computed.canonical_key,
            primary_type: computed.primary_type,
          });
          stats.updated += 1;
          continue;
        }

        try {
          await Person.updateOne(
            { _id: person._id },
            { $set: { canonical_id: computed.canonical_id } }
          );
          stats.updated += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error('Failed to update canonical_id', {
            person_id: person._id,
            error: error.message,
          });
        }
      }
    }

    console.log('\n✅ Canonical ID backfill complete');
    console.log('Stats:', stats);
  } catch (error) {
    logger.error('Canonical ID backfill failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

const args = parseArgs();

backfillCanonicalId(args)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
