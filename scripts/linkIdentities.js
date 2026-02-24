#!/usr/bin/env node

/**
 * Identity Linking Job
 *
 * Upgrades URL-fallback people to stable IDs (Sales Nav or numeric IDs).
 * Finds people whose primary ID is a public URL but have stable IDs in aliases,
 * then merges them into canonical people with stable IDs.
 *
 * Usage:
 *   node scripts/linkIdentities.js [options]
 *
 * Options:
 *   --dry-run            Preview merges without executing (default)
 *   --commit             Execute the merges (required to make changes)
 *   --limit=N            Limit to N merges (default: 100)
 *   --batch-size=N       Process N people per batch (default: 10)
 *
 * Examples:
 *   node scripts/linkIdentities.js --dry-run
 *   node scripts/linkIdentities.js --dry-run --limit=5
 *   node scripts/linkIdentities.js --commit --limit=10
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');
const IdentityResolverService = require('../src/services/identityResolverService');
const logger = require('../src/utils/logger');

// Parse command-line arguments
function parseArgs() {
  const args = {
    dryRun: true, // Safe default
    commit: false,
    limit: 100,
    batchSize: 10,
    force: false,
  };

  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'dry-run') args.dryRun = true;
    else if (key === 'commit') {
      args.dryRun = false;
      args.commit = true;
    }
    else if (key === 'limit') args.limit = parseInt(value);
    else if (key === 'batch-size') args.batchSize = parseInt(value);
    else if (key === 'force') args.force = true;
  });

  return args;
}

/**
 * Extract best stable identifier from aliases
 * Priority: Sales Nav ID > Numeric ID
 */
function extractStableId(aliases) {
  // Prefer Sales Navigator ID
  const salesNavAlias = aliases.find(a => a.type === 'salesNavId');
  if (salesNavAlias) {
    return { id: salesNavAlias.value, source: 'salesNavId' };
  }

  // Fallback to numeric ID
  const numericAlias = aliases.find(a => a.type === 'numericId');
  if (numericAlias) {
    return { id: numericAlias.value, source: 'numericId' };
  }

  return null;
}

/**
 * Find upgradable people
 * These are people with URL as primary but have stable IDs in aliases
 */
async function findUpgradablePeople(limit) {
  const upgradable = await Person.find({
    // Primary ID is a URL (linkedin.com/in/...)
    _id: { $regex: /^linkedin\.com/ },
    // Has at least one stable ID in aliases
    'aliases.type': { $in: ['salesNavId', 'numericId'] },
  })
    .limit(limit)
    .lean();

  return upgradable;
}

/**
 * Link a single person to their stable ID
 */
async function linkPerson(urlPerson, identityResolver, stats) {
  const stableId = extractStableId(urlPerson.aliases);

  if (!stableId) {
    logger.warn('No stable ID found in aliases', {
      person_id: urlPerson._id,
      aliases: urlPerson.aliases,
    });
    stats.skipped++;
    return null;
  }

  logger.info('Found stable ID for URL-fallback person', {
    url_id: urlPerson._id,
    stable_id: stableId.id,
    source: stableId.source,
  });

  try {
    // Find or create canonical person with stable ID
    const identity = {
      person_id: stableId.id,
      aliases: [{ type: stableId.source, value: stableId.id }],
      source: stableId.source,
    };

    const canonicalPerson = await identityResolver.resolveOrCreate(identity, {
      reason: 'linking_job',
      from_url_fallback: urlPerson._id,
    });

    // Check if merge needed (canonical person is different from URL person)
    if (canonicalPerson._id === urlPerson._id) {
      // Same person, no merge needed (rare edge case)
      logger.info('Person already has stable ID as primary', {
        person_id: canonicalPerson._id,
      });
      stats.alreadyLinked++;
      return null;
    }

    // Merge URL-fallback person into canonical person
    const urlPersonDoc = await Person.findById(urlPerson._id);
    const mergedPerson = await identityResolver.mergePeople(
      canonicalPerson,
      [urlPersonDoc],
      {
        reason: 'linking_job',
        automated: true,
        force: stats._force,
      }
    );

    stats.merged++;
    return {
      from: urlPerson._id,
      to: mergedPerson._id,
      stable_id: stableId.id,
    };
  } catch (error) {
    logger.error('Failed to link person', {
      person_id: urlPerson._id,
      stable_id: stableId.id,
      error: error.message,
    });
    stats.failed++;
    return null;
  }
}

/**
 * Run linking job
 */
async function runLinkingJob(args) {
  console.log('🔗 Starting identity linking job...');
  console.log('Options:', args);
  console.log('');

  if (args.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Use --commit to execute merges\n');
  }

  const stats = {
    found: 0,
    merged: 0,
    alreadyLinked: 0,
    skipped: 0,
    failed: 0,
    _force: args.force,
  };

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log('✓ Connected to MongoDB\n');

    // Find upgradable people
    const upgradablePeople = await findUpgradablePeople(args.limit);
    stats.found = upgradablePeople.length;

    console.log(`Found ${stats.found} upgradable people\n`);

    if (stats.found === 0) {
      console.log('✅ No upgradable people found');
      return stats;
    }

    // Show samples
    console.log('Sample upgradable people:');
    upgradablePeople.slice(0, 3).forEach(person => {
      const stableId = extractStableId(person.aliases);
      console.log(`  ${person._id} → ${stableId?.id} (${stableId?.source})`);
    });
    console.log('');

    if (args.dryRun) {
      console.log('✅ Dry run complete. Use --commit to execute merges.');
      return stats;
    }

    // Execute merges
    console.log('Executing merges...\n');
    const identityResolver = new IdentityResolverService();

    for (let i = 0; i < upgradablePeople.length; i += args.batchSize) {
      const batch = upgradablePeople.slice(i, i + args.batchSize);

      for (const person of batch) {
        const result = await linkPerson(person, identityResolver, stats);

        if (result) {
          console.log(`  ✓ Merged: ${result.from} → ${result.to}`);
        }
      }

      // Progress update
      const processed = Math.min(i + args.batchSize, upgradablePeople.length);
      console.log(`\nProgress: ${processed}/${upgradablePeople.length} people processed\n`);
    }

    console.log('\n✅ Linking job complete!');
    console.log('Statistics:');
    console.log(`  Found: ${stats.found}`);
    console.log(`  Merged: ${stats.merged}`);
    console.log(`  Already linked: ${stats.alreadyLinked}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Failed: ${stats.failed}`);

    return stats;
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    logger.error('Linking job failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Main entry point
async function main() {
  const args = parseArgs();

  try {
    await runLinkingJob(args);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
