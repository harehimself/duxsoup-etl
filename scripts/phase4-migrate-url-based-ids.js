/**
 * Phase 4: Migrate URL-based Person _id to Stable IDs
 *
 * This script migrates people with URL-based _id values (linkedin.com/in/...)
 * to stable IDs (Sales Navigator ID or Numeric ID).
 *
 * Process:
 * 1. Find all URL-based people
 * 2. Re-extract stable IDs from their observations
 * 3. Check for conflicts (stable ID already exists)
 * 4. Migrate (CREATE new + DELETE old) or Merge (combine duplicates)
 *
 * Usage:
 *   node scripts/phase4-migrate-url-based-ids.js --dry-run          # Analyze only
 *   node scripts/phase4-migrate-url-based-ids.js --limit 50         # Migrate first 50
 *   node scripts/phase4-migrate-url-based-ids.js                    # Migrate all 750
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const Change = require('../src/models/change');
const DeadLetter = require('../src/models/deadLetter');
const {
  extractSalesNavIdFromUrl,
  normalizeToCanonicalCase,
  extractNumericId,
} = require('../src/utils/salesNavIdExtractor');

// Canonical ID generation (from identityResolver.js)
const CANONICAL_ID_NAMESPACE =
  process.env.CANONICAL_ID_NAMESPACE || '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buffer) {
  const hex = buffer.toString('hex');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}

function computeCanonicalId(canonicalKey, namespace = CANONICAL_ID_NAMESPACE) {
  if (!canonicalKey) {
    return null;
  }

  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = Buffer.from(canonicalKey, 'utf8');
  const hash = crypto
    .createHash('sha256')
    .update(Buffer.concat([namespaceBytes, nameBytes]))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  return bytesToUuid(hash.slice(0, 16));
}

// Parse command-line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

// Statistics tracking
const stats = {
  analyzed: 0,
  canMigrate: 0,
  needMerge: 0,
  mustKeepUrl: 0,
  migrated: 0,
  merged: 0,
  failed: 0,
  errors: [],
};

/**
 * Extract stable IDs from a person's observations
 */
async function extractStableIdsFromObservations(person) {
  const result = {
    salesNavId: null,
    numericId: null,
    username: null,
  };

  // Fetch all scan observations
  if (person.observations?.scans?.length > 0) {
    const scans = await Scan.find({
      _id: { $in: person.observations.scans },
    }).select('id Profile SalesProfile');

    for (const scan of scans) {
      // Extract Sales Nav ID from Profile URL
      if (scan.Profile) {
        const salesNavId = extractSalesNavIdFromUrl(scan.Profile);
        if (salesNavId) {
          result.salesNavId = normalizeToCanonicalCase(salesNavId);
          break; // Found Sales Nav ID, this is best
        }
      }

      // Extract Sales Nav ID from SalesProfile URL
      if (scan.SalesProfile) {
        const salesNavId = extractSalesNavIdFromUrl(scan.SalesProfile);
        if (salesNavId) {
          result.salesNavId = normalizeToCanonicalCase(salesNavId);
          break;
        }
      }

      // Extract numeric ID from id field
      if (scan.id && !result.numericId) {
        const numericId = extractNumericId(scan.id);
        if (numericId) {
          result.numericId = numericId;
        }
      }

      // Extract username from id field (fallback)
      if (scan.id && scan.id.startsWith('pid.') && !result.username) {
        result.username = scan.id.substring(4); // Remove "pid." prefix
      }
    }
  }

  // Fetch all visit observations
  if (person.observations?.visits?.length > 0) {
    const visits = await Visit.find({
      _id: { $in: person.observations.visits },
    }).select('id Profile SalesProfile');

    for (const visit of visits) {
      // Extract Sales Nav ID from Profile URL
      if (visit.Profile) {
        const salesNavId = extractSalesNavIdFromUrl(visit.Profile);
        if (salesNavId) {
          result.salesNavId = normalizeToCanonicalCase(salesNavId);
          break;
        }
      }

      // Extract Sales Nav ID from SalesProfile URL
      if (visit.SalesProfile) {
        const salesNavId = extractSalesNavIdFromUrl(visit.SalesProfile);
        if (salesNavId) {
          result.salesNavId = normalizeToCanonicalCase(salesNavId);
          break;
        }
      }

      // Extract numeric ID from id field
      if (visit.id && !result.numericId) {
        const numericId = extractNumericId(visit.id);
        if (numericId) {
          result.numericId = numericId;
        }
      }

      // Extract username from id field (fallback)
      if (visit.id && visit.id.startsWith('pid.') && !result.username) {
        result.username = visit.id.substring(4);
      }
    }
  }

  return result;
}

/**
 * Categorize migration action for a person
 */
async function categorizeMigration(person, stableIds) {
  // Determine new stable _id (priority: salesNavId > numericId)
  const newId = stableIds.salesNavId || stableIds.numericId;

  if (!newId) {
    return {
      action: 'KEEP_URL',
      reason: 'No stable ID found',
      newId: null,
      conflict: false,
    };
  }

  // Check if new ID already exists (exact _id match)
  const existingById = await Person.findById(newId).select('_id snapshot.firstName snapshot.lastName canonical_id');

  if (existingById) {
    return {
      action: 'MERGE',
      reason: `Person with _id=${newId} already exists`,
      newId,
      conflict: true,
      existingPerson: existingById,
    };
  }

  // Check if canonical_id already exists (same person, different _id)
  if (person.canonical_id) {
    const existingByCanonicalId = await Person.findOne({
      canonical_id: person.canonical_id,
      _id: { $ne: person._id },
    }).select('_id snapshot.firstName snapshot.lastName canonical_id');

    if (existingByCanonicalId) {
      return {
        action: 'MERGE',
        reason: `Person with canonical_id=${person.canonical_id} already exists as _id=${existingByCanonicalId._id}`,
        newId: existingByCanonicalId._id,
        conflict: true,
        existingPerson: existingByCanonicalId,
      };
    }
  }

  return {
    action: 'MIGRATE',
    reason: 'Can migrate to stable ID',
    newId,
    conflict: false,
  };
}

/**
 * Add stable IDs to person's aliases array
 */
async function addStableIdAliases(person, stableIds) {
  const updates = [];

  // Add salesNavId alias
  if (stableIds.salesNavId) {
    const hasAlias = person.aliases?.some(
      (a) => a.type === 'salesNavId' && a.value === stableIds.salesNavId
    );
    if (!hasAlias) {
      updates.push({
        type: 'salesNavId',
        value: stableIds.salesNavId,
        addedAt: new Date(),
      });
    }
  }

  // Add numericId alias
  if (stableIds.numericId) {
    const hasAlias = person.aliases?.some(
      (a) => a.type === 'numericId' && a.value === stableIds.numericId
    );
    if (!hasAlias) {
      updates.push({
        type: 'numericId',
        value: stableIds.numericId,
        addedAt: new Date(),
      });
    }
  }

  // Add username alias
  if (stableIds.username) {
    const hasAlias = person.aliases?.some(
      (a) => a.type === 'username' && a.value === stableIds.username
    );
    if (!hasAlias) {
      updates.push({
        type: 'username',
        value: stableIds.username,
        addedAt: new Date(),
      });
    }
  }

  if (updates.length > 0 && !isDryRun) {
    await Person.updateOne(
      { _id: person._id },
      { $push: { aliases: { $each: updates } } }
    );
  }

  return updates.length;
}

/**
 * Migrate person to new stable _id
 */
async function migratePerson(person, newId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Generate new canonical_id based on stable ID
    const canonicalKey = `salesNavId:${newId}`;
    const newCanonicalId = computeCanonicalId(canonicalKey);

    // 1. Create new person document with stable _id and new canonical_id
    const newPerson = new Person({
      _id: newId,
      person_id: newId,
      canonical_id: newCanonicalId,
      aliases: person.aliases,
      snapshot: person.snapshot,
      observations: person.observations,
      meta: person.meta,
      derived: person.derived,
      createdAt: person.createdAt,
      updatedAt: new Date(),
    });

    await newPerson.save({ session });

    // 2. Update Change references
    await Change.updateMany(
      { person_id: person._id },
      { $set: { person_id: newId } },
      { session }
    );

    // 3. Update DeadLetter references
    await DeadLetter.updateMany(
      { 'payload.person_id': person._id },
      { $set: { 'payload.person_id': newId } },
      { session }
    );

    // 4. Delete old URL-based person
    await Person.deleteOne({ _id: person._id }, { session });

    await session.commitTransaction();
    return { success: true, newPerson };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Merge URL-based person with existing stable-ID person
 */
async function mergePerson(urlPerson, stableIdPerson) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Merge aliases
    const mergedAliases = [...stableIdPerson.aliases];
    for (const alias of urlPerson.aliases) {
      const exists = mergedAliases.some(
        (a) => a.type === alias.type && a.value === alias.value
      );
      if (!exists) {
        mergedAliases.push(alias);
      }
    }

    // 2. Merge observations
    const mergedObservations = {
      visits: [
        ...(stableIdPerson.observations?.visits || []),
        ...(urlPerson.observations?.visits || []),
      ],
      scans: [
        ...(stableIdPerson.observations?.scans || []),
        ...(urlPerson.observations?.scans || []),
      ],
    };

    // 3. Merge snapshot (prefer non-empty values)
    const mergedSnapshot = { ...stableIdPerson.snapshot };
    for (const [key, value] of Object.entries(urlPerson.snapshot || {})) {
      if (value && !mergedSnapshot[key]) {
        mergedSnapshot[key] = value;
      }
    }

    // 4. Update stable-ID person
    await Person.updateOne(
      { _id: stableIdPerson._id },
      {
        $set: {
          aliases: mergedAliases,
          observations: mergedObservations,
          snapshot: mergedSnapshot,
          updatedAt: new Date(),
        },
      },
      { session }
    );

    // 5. Update Change references
    await Change.updateMany(
      { person_id: urlPerson._id },
      { $set: { person_id: stableIdPerson._id } },
      { session }
    );

    // 6. Update DeadLetter references
    await DeadLetter.updateMany(
      { 'payload.person_id': urlPerson._id },
      { $set: { 'payload.person_id': stableIdPerson._id } },
      { session }
    );

    // 7. Delete URL-based person
    await Person.deleteOne({ _id: urlPerson._id }, { session });

    await session.commitTransaction();
    return { success: true };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Process a single URL-based person
 */
async function processPerson(person, index) {
  stats.analyzed++;

  // Extract stable IDs from observations
  const stableIds = await extractStableIdsFromObservations(person);

  // Categorize migration action
  const migration = await categorizeMigration(person, stableIds);

  // Add to aliases (even in dry-run, we log what would be added)
  const aliasesAdded = await addStableIdAliases(person, stableIds);

  // Track statistics
  if (migration.action === 'MIGRATE') {
    stats.canMigrate++;
  } else if (migration.action === 'MERGE') {
    stats.needMerge++;
  } else if (migration.action === 'KEEP_URL') {
    stats.mustKeepUrl++;
  }

  // Return analysis result
  return {
    index,
    currentId: person._id,
    stableIds,
    migration,
    aliasesAdded,
    snapshot: {
      firstName: person.snapshot?.firstName,
      lastName: person.snapshot?.lastName,
    },
  };
}

/**
 * Execute migration for a person
 */
async function executeMigration(person, stableIds, migration) {
  try {
    if (migration.action === 'MIGRATE') {
      await migratePerson(person, migration.newId);
      stats.migrated++;
    } else if (migration.action === 'MERGE') {
      const stableIdPerson = await Person.findById(migration.newId);
      await mergePerson(person, stableIdPerson);
      stats.merged++;
    }
    // KEEP_URL: no action needed
  } catch (error) {
    stats.failed++;
    stats.errors.push({
      personId: person._id,
      error: error.message,
    });
    console.error(`❌ Failed to migrate ${person._id}:`, error.message);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Ensure we connect to the duxsoup database
    const uri = process.env.MONGODB_URI.replace('/?', '/duxsoup?');
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB (database: duxsoup)\n');

    // Find all URL-based people (IDs containing "/" are URL-based)
    const query = { _id: /\// };
    const totalCount = await Person.countDocuments(query);
    const batchSize = limit || totalCount;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`PHASE 4: URL-based Person _id Migration`);
    console.log(`Mode: ${isDryRun ? 'DRY-RUN (analysis only)' : 'EXECUTION'}`);
    console.log(`Total URL-based people: ${totalCount}`);
    console.log(`Processing: ${batchSize} people`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Fetch URL-based people
    const people = await Person.find(query)
      .limit(batchSize)
      .sort({ _id: 1 });

    const results = [];

    // Process each person
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const result = await processPerson(person, i + 1);
      results.push(result);

      // Execute migration if not dry-run
      if (!isDryRun) {
        const stableIds = result.stableIds;
        const migration = result.migration;
        await executeMigration(person, stableIds, migration);
      }

      // Progress indicator
      if ((i + 1) % 10 === 0 || i === people.length - 1) {
        console.log(`Processed: ${i + 1}/${people.length}`);
      }
    }

    // Print detailed results for first 10
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('DETAILED ANALYSIS (First 10 people)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    results.slice(0, 10).forEach((result) => {
      console.log(`${result.index}. ${result.currentId}`);
      console.log(`   Name: ${result.snapshot.firstName} ${result.snapshot.lastName}`);
      console.log(`   Sales Nav ID: ${result.stableIds.salesNavId || '(none)'}`);
      console.log(`   Numeric ID: ${result.stableIds.numericId || '(none)'}`);
      console.log(`   Username: ${result.stableIds.username || '(none)'}`);
      console.log(`   → ${result.migration.newId || result.currentId} (${result.migration.action})`);
      console.log(`   Conflict: ${result.migration.conflict ? 'YES' : 'NO'}`);
      console.log(`   Reason: ${result.migration.reason}`);
      if (result.aliasesAdded > 0) {
        console.log(`   Aliases added: ${result.aliasesAdded}`);
      }
      console.log('');
    });

    // Print summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Total analyzed: ${stats.analyzed}`);
    console.log(`Can migrate to stable ID: ${stats.canMigrate}`);
    console.log(`Need merge with existing: ${stats.needMerge}`);
    console.log(`Must keep URL-based ID: ${stats.mustKeepUrl}`);

    if (!isDryRun) {
      console.log(`\n✅ Successfully migrated: ${stats.migrated}`);
      console.log(`✅ Successfully merged: ${stats.merged}`);
      console.log(`❌ Failed: ${stats.failed}`);

      if (stats.errors.length > 0) {
        console.log('\nErrors:');
        stats.errors.forEach((err) => {
          console.log(`  - ${err.personId}: ${err.error}`);
        });
      }

      const remainingUrlBased = totalCount - stats.migrated - stats.merged;
      console.log(`\n📊 Remaining URL-based people: ${remainingUrlBased}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (isDryRun) {
      console.log('💡 This was a DRY-RUN. No changes were made.');
      console.log('   To execute migration, run without --dry-run flag.\n');
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

main();
