#!/usr/bin/env node
/**
 * Migrate URL-Based IDs to Stable IDs
 * For people with URL-based IDs who have observations containing stable identifiers,
 * migrate them to use Sales Nav ID or numeric ID as their person_id
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const { resolvePersonIdentity } = require('../src/utils/identityMatcher');
const identityResolverService = require('../src/services/identityResolverService');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function findMigratablePeople() {
  const urlPeople = await Person.find({
    _id: /^linkedin\.com\/in\//
  }, {
    _id: 1,
    aliases: 1,
    snapshot: 1,
    observations: 1
  }).lean();

  const migratable = [];

  for (const person of urlPeople) {
    const profileUrl = person._id.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();

    // Find visits with stable IDs for this profile
    const visits = await Visit.find({
      $or: [
        { Profile: new RegExp(profileUrl, 'i') },
        { profile: new RegExp(profileUrl, 'i') }
      ]
    }).lean();

    for (const visit of visits) {
      const identity = resolvePersonIdentity(visit);

      // Check for stable ID (Sales Nav or numeric)
      const hasSalesNav = identity.person_id?.startsWith('ACoA');
      const hasNumeric = /^\d{8,}$/.test(identity.person_id);

      if (hasSalesNav || hasNumeric) {
        migratable.push({
          oldId: person._id,
          newId: identity.person_id,
          person: person,
          sampleVisit: visit
        });
        break;
      }
    }
  }

  return migratable;
}

async function migratePeople() {
  console.log('━'.repeat(70));
  console.log(`  MIGRATE URL-BASED IDS TO STABLE IDS ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  console.log('Finding migratable people...\n');
  const migratable = await findMigratablePeople();

  console.log(`Found ${migratable.length} people that can be migrated\n`);

  if (migratable.length === 0) {
    console.log('✓ No people need migration!\n');
    return;
  }

  const stats = {
    total: migratable.length,
    migrated: 0,
    merged: 0,
    errors: 0,
    errorDetails: []
  };

  console.log('━'.repeat(70));
  console.log('MIGRATION PLAN:');
  console.log('━'.repeat(70));
  console.log('For each person:');
  console.log('  1. Check if new ID already exists (duplicate detection)');
  console.log('  2. If exists: Merge observations and aliases');
  console.log('  3. If not: Rename person _id to stable ID');
  console.log('  4. Add old URL as alias to merged/renamed record');
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('Sample migrations (first 10):\n');
    migratable.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. ${item.person.snapshot?.name || 'Unknown'}`);
      console.log(`   ${item.oldId} → ${item.newId}`);
    });
    console.log('');
  } else {
    console.log('Processing migrations...\n');

    for (const item of migratable) {
      try {
        // Check if new ID already exists
        const existingPerson = await Person.findById(item.newId);

        if (existingPerson) {
          // MERGE: Move observations and aliases to existing person
          stats.merged++;

          const oldPerson = await Person.findById(item.oldId);
          if (!oldPerson) {
            stats.errors++;
            continue;
          }

          // Add old URL as alias to existing person
          await Person.updateOne(
            { _id: item.newId },
            {
              $addToSet: {
                'aliases': {
                  type: 'publicUrl',
                  value: item.oldId,
                  addedAt: new Date()
                }
              }
            }
          );

          // Move observations to existing person (capped to MAX_OBSERVATION_REFS)
          const { MAX_OBSERVATION_REFS } = require('../src/constants/limits');
          if (oldPerson.observations?.visits?.length > 0) {
            await Person.updateOne(
              { _id: item.newId },
              {
                $push: {
                  'observations.visits': {
                    $each: oldPerson.observations.visits,
                    $slice: -MAX_OBSERVATION_REFS
                  }
                }
              }
            );
          }

          if (oldPerson.observations?.scans?.length > 0) {
            await Person.updateOne(
              { _id: item.newId },
              {
                $push: {
                  'observations.scans': {
                    $each: oldPerson.observations.scans,
                    $slice: -MAX_OBSERVATION_REFS
                  }
                }
              }
            );
          }

          // Delete old person record
          await Person.deleteOne({ _id: item.oldId });

          if (stats.merged % 5 === 0) {
            console.log(`  Progress: ${stats.merged + stats.migrated}/${stats.total} (${stats.merged} merged, ${stats.migrated} migrated)...`);
          }

        } else {
          // MIGRATE/MERGE: Change the _id of the person record or merge with canonical duplicate
          const oldPerson = await Person.findById(item.oldId);
          if (!oldPerson) {
            stats.errors++;
            continue;
          }

          // TRUE MIGRATION: Rename person _id to stable ID
          // Strategy: Delete old person first, then create with new _id
          // This allows reusing the same canonical_id
          stats.migrated++;

          // Prepare new person data with stable ID
          const oldPersonData = oldPerson.toObject();
          const newPersonData = {
            ...oldPersonData,
            _id: item.newId
          };

          // Add old URL as alias
          if (!newPersonData.aliases) newPersonData.aliases = [];
          newPersonData.aliases.push({
            type: 'publicUrl',
            value: item.oldId,
            addedAt: new Date()
          });

          // IMPORTANT: Delete old person FIRST to free up canonical_id
          await Person.deleteOne({ _id: item.oldId });

          // Then create new person with stable ID (reuses canonical_id)
          await Person.create(newPersonData);

          if (stats.migrated % 5 === 0) {
            console.log(`  Progress: ${stats.merged + stats.migrated}/${stats.total} (${stats.merged} merged, ${stats.migrated} migrated)...`);
          }
        }

      } catch (error) {
        stats.errors++;
        stats.errorDetails.push({
          person: item.oldId,
          error: error.message
        });

        if (stats.errors <= 5) {
          console.error(`✗ Error migrating ${item.oldId}: ${error.message}`);
        }
      }
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('MIGRATION SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total migratable: ${stats.total}`);

  if (!isDryRun) {
    console.log(`Successfully migrated: ${stats.migrated}`);
    console.log(`Merged with existing: ${stats.merged}`);
    console.log(`Total processed: ${stats.migrated + stats.merged}`);
    console.log(`Errors: ${stats.errors}`);

    if (stats.errorDetails.length > 0) {
      console.log('\nError details:');
      stats.errorDetails.forEach(err => {
        console.log(`  ${err.person}: ${err.error}`);
      });
    }
  }

  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log(`✓ Dry run complete. Run without --dry-run to migrate ${stats.total} people.\n`);
  } else {
    console.log(`✓ Successfully processed ${stats.migrated + stats.merged} people\n`);
    console.log(`  Migrated to new stable IDs: ${stats.migrated}`);
    console.log(`  Merged with existing people: ${stats.merged}\n`);

    if (stats.errors > 0) {
      console.log(`⚠ ${stats.errors} migrations failed - these may need manual review\n`);
    }
  }
}

async function run() {
  try {
    await connectDB();
    await migratePeople();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
