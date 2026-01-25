#!/usr/bin/env node

/**
 * Canonical ID Verification Script
 *
 * Verifies that all people records have a valid canonical_id.
 * Reports on:
 * - Total people count
 * - People with valid canonical_id
 * - People missing canonical_id
 * - Identifier types used
 * - Potential issues
 *
 * Usage:
 *   node scripts/verifyCanonicalId.js [--verbose] [--show-missing]
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');
const logger = require('../src/utils/logger');

function parseArgs() {
  const args = {
    verbose: false,
    showMissing: false,
  };

  process.argv.slice(2).forEach(arg => {
    if (arg === '--verbose') args.verbose = true;
    if (arg === '--show-missing') args.showMissing = true;
  });

  return args;
}

async function verifyCanonicalIds(args) {
  console.log('🔍 Verifying canonical_id for all people records...\n');

  const stats = {
    total: 0,
    withCanonicalId: 0,
    missingCanonicalId: 0,
    invalidCanonicalId: 0,
    duplicateCanonicalId: 0,
    identifierTypes: {},
    missingRecords: [],
  };

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Get total count
    stats.total = await Person.countDocuments();
    console.log(`Total people records: ${stats.total}\n`);

    // Check for people WITH canonical_id
    const withCanonicalId = await Person.countDocuments({
      canonical_id: { $exists: true, $ne: null, $ne: '' },
    });
    stats.withCanonicalId = withCanonicalId;

    // Check for people MISSING canonical_id
    const missingQuery = {
      $or: [
        { canonical_id: { $exists: false } },
        { canonical_id: null },
        { canonical_id: '' },
      ],
    };

    stats.missingCanonicalId = await Person.countDocuments(missingQuery);

    // Detailed analysis of missing records
    if (stats.missingCanonicalId > 0) {
      const missingPeople = await Person.find(missingQuery)
        .select('_id aliases snapshot.fullName meta.lastObservedAt')
        .limit(100)
        .lean();

      missingPeople.forEach(person => {
        const identifierTypes = person.aliases?.map(a => a.type) || [];
        const primaryType = identifierTypes[0] || 'none';

        if (!stats.identifierTypes[primaryType]) {
          stats.identifierTypes[primaryType] = 0;
        }
        stats.identifierTypes[primaryType] += 1;

        if (args.showMissing) {
          stats.missingRecords.push({
            _id: person._id,
            name: person.snapshot?.fullName || 'Unknown',
            aliases: person.aliases?.length || 0,
            aliasTypes: identifierTypes,
            lastObserved: person.meta?.lastObservedAt,
          });
        }
      });
    }

    // Check for invalid canonical_id format (should be UUID)
    const invalidCanonicalId = await Person.countDocuments({
      canonical_id: { $exists: true, $ne: null, $ne: '' },
      $expr: {
        $not: {
          $regexMatch: {
            input: '$canonical_id',
            regex: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          },
        },
      },
    });
    stats.invalidCanonicalId = invalidCanonicalId;

    // Check for duplicate canonical_ids (should be unique)
    const duplicates = await Person.aggregate([
      { $match: { canonical_id: { $exists: true, $ne: null, $ne: '' } } },
      { $group: { _id: '$canonical_id', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    stats.duplicateCanonicalId = duplicates.length;

    // Print results
    console.log('═══════════════════════════════════════════════════════');
    console.log('                  VERIFICATION RESULTS                  ');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log(`✓ People with canonical_id:    ${stats.withCanonicalId.toLocaleString()}`);
    console.log(`✗ People missing canonical_id: ${stats.missingCanonicalId.toLocaleString()}`);
    console.log(`⚠ Invalid canonical_id format: ${stats.invalidCanonicalId.toLocaleString()}`);
    console.log(`⚠ Duplicate canonical_ids:     ${stats.duplicateCanonicalId.toLocaleString()}\n`);

    // Show percentage
    const percentage = ((stats.withCanonicalId / stats.total) * 100).toFixed(2);
    console.log(`Coverage: ${percentage}% of records have canonical_id\n`);

    // Show identifier type distribution for missing records
    if (stats.missingCanonicalId > 0) {
      console.log('Missing records by identifier type:');
      Object.entries(stats.identifierTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
      });
      console.log('');
    }

    // Show missing records if requested
    if (args.showMissing && stats.missingRecords.length > 0) {
      console.log('\nMissing canonical_id records (first 100):');
      console.log('═══════════════════════════════════════════════════════\n');
      stats.missingRecords.forEach((record, i) => {
        console.log(`${i + 1}. ${record._id}`);
        console.log(`   Name: ${record.name}`);
        console.log(`   Aliases: ${record.aliases} (types: ${record.aliasTypes.join(', ')})`);
        console.log(`   Last observed: ${record.lastObserved || 'Never'}\n`);
      });
    }

    // Show duplicate canonical_ids if found
    if (stats.duplicateCanonicalId > 0) {
      console.log('\n⚠️  WARNING: Duplicate canonical_ids found!');
      console.log('This indicates a data integrity issue.\n');
      console.log('Duplicates:');
      duplicates.slice(0, 10).forEach((dup, i) => {
        console.log(`  ${i + 1}. ${dup._id} (${dup.count} records)`);
      });
      console.log('');
    }

    // Final recommendations
    console.log('═══════════════════════════════════════════════════════');
    console.log('                   RECOMMENDATIONS                      ');
    console.log('═══════════════════════════════════════════════════════\n');

    if (stats.missingCanonicalId > 0) {
      console.log('⚠️  Action required: Run backfill script to populate missing canonical_ids');
      console.log('   Command: node scripts/backfillCanonicalId.js --commit\n');
    } else {
      console.log('✅ All records have canonical_id - no action needed\n');
    }

    if (stats.invalidCanonicalId > 0) {
      console.log('⚠️  Warning: Some canonical_ids have invalid format (not UUID)');
      console.log('   Manual investigation required\n');
    }

    if (stats.duplicateCanonicalId > 0) {
      console.log('🚨 CRITICAL: Duplicate canonical_ids violate uniqueness constraint');
      console.log('   This should not happen - investigate immediately\n');
    }

    if (args.verbose) {
      console.log('\nVerbose stats:', JSON.stringify(stats, null, 2));
    }

    return stats;
  } catch (error) {
    logger.error('Canonical ID verification failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

const args = parseArgs();

verifyCanonicalIds(args)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  });
