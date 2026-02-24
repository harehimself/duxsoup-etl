#!/usr/bin/env node

/**
 * Location Canonical ID Backfill
 *
 * Populates canonical_id for locations missing it.
 *
 * Usage:
 *   node scripts/backfillLocationCanonicalId.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N locations (default: 1000)
 *   --batch-size=N       Process N locations per batch (default: 100)
 */

const mongoose = require('mongoose');
const Location = require('../src/models/location');
const logger = require('../src/utils/logger');
const {
  normalizeLocationName,
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

function computeCanonicalForLocation(location) {
  const raw = location.snapshot?.name || location._id;
  const normalized = location.snapshot?.normalized || normalizeLocationName(raw);
  if (!normalized) return null;

  const slug = normalized
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  const canonicalKey = buildCanonicalKey('location', slug);
  const canonicalId = computeCanonicalId(canonicalKey);

  if (!canonicalId) return null;

  return {
    canonical_id: canonicalId,
    canonical_key: canonicalKey,
    normalized,
    slug,
  };
}

async function backfillLocationCanonicalId(args) {
  console.log('📍 Starting location canonical_id backfill...');
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
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log('✓ Connected to MongoDB\n');

    const query = {
      $or: [
        { canonical_id: { $exists: false } },
        { canonical_id: null },
        { canonical_id: '' },
      ],
    };

    const locations = await Location.find(query)
      .limit(args.limit)
      .lean();

    console.log(`Found ${locations.length} locations missing canonical_id\n`);

    for (let i = 0; i < locations.length; i += args.batchSize) {
      const batch = locations.slice(i, i + args.batchSize);

      for (const location of batch) {
        stats.processed += 1;
        const computed = computeCanonicalForLocation(location);

        if (!computed) {
          stats.skipped += 1;
          logger.warn('Skipping location: no canonical key available', {
            location_id: location._id,
          });
          continue;
        }

        if (args.dryRun) {
          logger.info('Would update location canonical_id', {
            location_id: location._id,
            canonical_id: computed.canonical_id,
            canonical_key: computed.canonical_key,
          });
          stats.updated += 1;
          continue;
        }

        try {
          await Location.updateOne(
            { _id: location._id },
            {
              $set: {
                canonical_id: computed.canonical_id,
                'snapshot.normalized': computed.normalized,
              },
            }
          );
          stats.updated += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error('Failed to update location canonical_id', {
            location_id: location._id,
            error: error.message,
          });
        }
      }
    }

    console.log('\n✅ Location canonical_id backfill complete');
    console.log('Stats:', stats);
  } catch (error) {
    logger.error('Location canonical_id backfill failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

const args = parseArgs();

backfillLocationCanonicalId(args)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
