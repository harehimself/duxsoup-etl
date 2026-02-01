#!/usr/bin/env node

/**
 * Migrate URL-Based Person _id Values to Stable IDs
 *
 * People whose _id is a profile URL (e.g., "linkedin.com/in/mike-hare") are fragile.
 * This script migrates them to stable IDs (salesNavId > numericId > linkedInUsername)
 * where a stable alias is available.
 *
 * Usage:
 *   node scripts/migrate-url-people-to-stable-id.js --dry-run       # Preview changes (default)
 *   node scripts/migrate-url-people-to-stable-id.js --execute        # Run migration
 *   node scripts/migrate-url-people-to-stable-id.js --execute --limit 100  # Batch of 100
 *
 * Steps per person:
 *   1. Find best stable alias: salesNavId > numericId > linkedInUsername
 *   2. Check no existing person has the target _id
 *   3. Create new Person document with stable _id, copy ALL fields
 *   4. Update Change records that reference the old person_id
 *   5. Update DeadLetter records that reference the old person_id
 *   6. Delete old document
 *   7. Log: { old_id, new_id, alias_type_used }
 *
 * Note: Visit and Scan models do NOT have person_id fields.
 * Persons reference observations via observations.visits/scans arrays,
 * which are copied to the new document.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Change = require('../src/models/change');
const DeadLetter = require('../src/models/deadLetter');
const logger = require('../src/utils/logger');

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isDryRun = !isExecute;

const limitArg = args.find(arg => arg.startsWith('--limit'));
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 && args[limitIdx + 1]
  ? parseInt(args[limitIdx + 1], 10)
  : null;

// Priority order for stable alias selection
const STABLE_ALIAS_PRIORITY = ['salesNavId', 'numericId', 'linkedInUsername'];

function findBestStableAlias(person) {
  const aliases = person.aliases || [];
  for (const type of STABLE_ALIAS_PRIORITY) {
    const alias = aliases.find(a => a.type === type && a.value);
    if (alias) {
      return alias;
    }
  }
  return null;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI or MONGO_URI is not set');
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
  });

  console.log('Connected to MongoDB\n');
  console.log('━'.repeat(70));
  console.log(`  MIGRATE URL-BASED PERSON IDs TO STABLE IDs ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  // Step 1: Find all URL-based people
  const urlPeople = await Person.find({ _id: /^linkedin\.com/ }).lean();
  console.log(`Found ${urlPeople.length} people with URL-based _id\n`);

  if (urlPeople.length === 0) {
    console.log('No URL-based people found. Nothing to migrate.\n');
    await mongoose.disconnect();
    return;
  }

  const stats = {
    total: urlPeople.length,
    canMigrate: 0,
    noStableAlias: 0,
    targetExists: 0,
    migrated: 0,
    changesUpdated: 0,
    deadLettersUpdated: 0,
    errors: 0,
  };

  const migrations = [];

  // Step 2: Analyze each URL-based person
  const toProcess = limit ? urlPeople.slice(0, limit) : urlPeople;
  console.log(`Processing ${toProcess.length} people${limit ? ` (limited to ${limit})` : ''}...\n`);

  for (const person of toProcess) {
    try {
      const stableAlias = findBestStableAlias(person);

      if (!stableAlias) {
        stats.noStableAlias++;
        if (stats.noStableAlias <= 5) {
          console.log(`  ⚠ ${person._id} — no stable alias found`);
        }
        continue;
      }

      const newId = stableAlias.value;

      // Check if a person already exists with the target _id
      const existing = await Person.findById(newId).lean();
      if (existing) {
        stats.targetExists++;
        if (stats.targetExists <= 5) {
          console.log(`  ⚠ ${person._id} → ${newId} — target _id already exists (would need merge)`);
        }
        continue;
      }

      stats.canMigrate++;
      migrations.push({
        old_id: person._id,
        new_id: newId,
        alias_type_used: stableAlias.type,
        person,
      });
    } catch (error) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`  ✗ Error analyzing ${person._id}: ${error.message}`);
      }
    }
  }

  // Summary before execution
  console.log('\n' + '━'.repeat(70));
  console.log('ANALYSIS SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total URL-based people:   ${stats.total}`);
  console.log(`Can migrate:              ${stats.canMigrate}`);
  console.log(`No stable alias:          ${stats.noStableAlias}`);
  console.log(`Target _id already exists: ${stats.targetExists}`);
  console.log(`Errors during analysis:   ${stats.errors}`);
  console.log('━'.repeat(70) + '\n');

  // Show sample migrations
  if (migrations.length > 0) {
    console.log('Sample migrations (first 10):');
    migrations.slice(0, 10).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.old_id} → ${m.new_id} (via ${m.alias_type_used})`);
    });
    console.log('');
  }

  if (isDryRun) {
    console.log(`✓ Dry run complete. Run with --execute to migrate ${migrations.length} people.\n`);
    await mongoose.disconnect();
    return;
  }

  // Step 3: Execute migrations
  console.log(`Executing ${migrations.length} migrations...\n`);

  for (const migration of migrations) {
    try {
      const { old_id, new_id, alias_type_used, person } = migration;

      // Build the new document data (copy everything except _id)
      const newPersonData = {
        _id: new_id,
        canonical_id: person.canonical_id,
        aliases: person.aliases || [],
        snapshot: person.snapshot || {},
        observations: person.observations || { visits: [], scans: [] },
        meta: person.meta || {},
        derived: person.derived || {},
        mergedInto: person.mergedInto,
        mergedAt: person.mergedAt,
        createdAt: person.createdAt,
        updatedAt: person.updatedAt,
      };

      // Create new person document
      await Person.create(newPersonData);

      // Update Change records
      const changeResult = await Change.updateMany(
        { person_id: old_id },
        { $set: { person_id: new_id } }
      );
      stats.changesUpdated += changeResult.modifiedCount || 0;

      // Update DeadLetter records
      const deadLetterResult = await DeadLetter.updateMany(
        { 'identity_hints.person_id': old_id },
        { $set: { 'identity_hints.person_id': new_id } }
      );
      stats.deadLettersUpdated += deadLetterResult.modifiedCount || 0;

      // Delete old document
      await Person.deleteOne({ _id: old_id });

      stats.migrated++;

      if (stats.migrated % 50 === 0) {
        console.log(`  Progress: ${stats.migrated}/${migrations.length} migrated...`);
      }

      logger.info('Migrated URL-based person to stable ID', {
        old_id,
        new_id,
        alias_type_used,
      });
    } catch (error) {
      stats.errors++;
      console.error(`  ✗ Failed to migrate ${migration.old_id}: ${error.message}`);
      logger.error('Migration failed', {
        old_id: migration.old_id,
        new_id: migration.new_id,
        error: error.message,
      });

      // Clean up: if the new document was created but old not deleted, remove new
      try {
        await Person.deleteOne({ _id: migration.new_id });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Final summary
  console.log('\n' + '━'.repeat(70));
  console.log('MIGRATION RESULTS:');
  console.log('━'.repeat(70));
  console.log(`Successfully migrated:    ${stats.migrated}`);
  console.log(`Change records updated:   ${stats.changesUpdated}`);
  console.log(`Dead letters updated:     ${stats.deadLettersUpdated}`);
  console.log(`Errors:                   ${stats.errors}`);
  console.log('━'.repeat(70) + '\n');

  // Post-migration validation
  const remainingUrlPeople = await Person.countDocuments({ _id: /^linkedin\.com/ });
  console.log(`Remaining URL-based people: ${remainingUrlPeople}`);
  console.log('');

  if (remainingUrlPeople > 0) {
    console.log('⚠ Some URL-based people remain. These may:');
    console.log('  - Have no stable alias (only URL identifier)');
    console.log('  - Have a target _id that already exists (needs merge first)');
    console.log('');
  }

  await mongoose.disconnect();
}

run().catch(error => {
  console.error('Migration failed:', error.message);
  logger.error('URL migration script failed', { error: error.message });
  process.exit(1);
});
