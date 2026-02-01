/**
 * Phase 4: Migrate URL-based Person _ids to Stable IDs
 *
 * Process:
 * 1. Re-extract stable identifiers from scan/visit observations
 * 2. Add extracted identifiers as aliases
 * 3. Migrate people with stable IDs (salesNavId > numericId > linkedInUsername)
 * 4. Handle duplicates by merging
 * 5. Create audit records
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const Change = require('../src/models/change');
const DeadLetter = require('../src/models/deadLetter');
const {
  extractSalesNavIdFromUrl,
  extractNumericId,
  normalizeToCanonicalCase,
} = require('../src/utils/salesNavIdExtractor');

// Migration statistics
const stats = {
  totalProcessed: 0,
  salesNavIdExtracted: 0,
  numericIdExtracted: 0,
  linkedInUsernameExtracted: 0,
  noStableIdFound: 0,
  migrated: 0,
  merged: 0,
  failed: 0,
  keptUrlBased: 0,
  migrations: [], // Sample migrations
};

/**
 * Extract stable identifiers from an observation
 */
function extractStableIdentifiers(observation) {
  const identifiers = {
    salesNavId: null,
    numericId: null,
    linkedInUsername: null,
  };

  // Extract Sales Nav ID from URLs
  const urlFields = ['Profile', 'SalesProfile', 'RecruiterProfile'];
  for (const field of urlFields) {
    if (observation[field]) {
      const salesNavId = extractSalesNavIdFromUrl(observation[field]);
      if (salesNavId) {
        identifiers.salesNavId = normalizeToCanonicalCase(salesNavId);
        break;
      }
    }
  }

  // Extract from miniProfileUrn in Profile URL
  if (!identifiers.salesNavId && observation.Profile) {
    const miniProfileMatch = observation.Profile.match(
      /miniProfileUrn=urn%3Ali%3Afs_miniProfile%3A([A-Za-z0-9_-]+)/
    );
    if (miniProfileMatch) {
      const urn = decodeURIComponent(miniProfileMatch[1]);
      const salesNavId = extractSalesNavIdFromUrl(urn);
      if (salesNavId) {
        identifiers.salesNavId = normalizeToCanonicalCase(salesNavId);
      }
    }
  }

  // Extract numeric ID from id field
  if (observation.id) {
    const numericId = extractNumericId(observation.id);
    if (numericId) {
      identifiers.numericId = numericId;
    }

    // Also check for eid.ACoAAA format (entity IDs)
    if (observation.id.startsWith('eid.')) {
      const eidPart = observation.id.substring(4);
      const salesNavId = extractSalesNavIdFromUrl(eidPart);
      if (salesNavId && !identifiers.salesNavId) {
        identifiers.salesNavId = normalizeToCanonicalCase(salesNavId);
      }
    }
  }

  // Extract LinkedIn username from Profile URL
  if (observation.Profile) {
    const usernameMatch = observation.Profile.match(/linkedin\.com\/in\/([^/?]+)/i);
    if (usernameMatch) {
      identifiers.linkedInUsername = usernameMatch[1];
    }
  }

  return identifiers;
}

/**
 * Add stable identifiers as aliases to person document
 */
function addAliasIfMissing(person, type, value) {
  if (!value) return false;

  const exists = person.aliases.some(
    (alias) => alias.type === type && alias.value === value
  );

  if (!exists) {
    person.aliases.push({
      type,
      value,
      addedAt: new Date(),
    });
    return true;
  }

  return false;
}

/**
 * Determine the best stable ID to use for migration
 */
function determineBestStableId(person) {
  // Priority: salesNavId > numericId > linkedInUsername
  for (const alias of person.aliases) {
    if (alias.type === 'salesNavId') {
      return { type: 'salesNavId', value: alias.value };
    }
  }

  for (const alias of person.aliases) {
    if (alias.type === 'numericId') {
      return { type: 'numericId', value: alias.value };
    }
  }

  for (const alias of person.aliases) {
    if (alias.type === 'linkedInUsername') {
      return { type: 'linkedInUsername', value: alias.value };
    }
  }

  return null;
}

/**
 * Merge two person records (duplicate resolution)
 */
async function mergePeople(sourcePerson, targetPerson) {
  // Merge aliases
  for (const alias of sourcePerson.aliases) {
    addAliasIfMissing(targetPerson, alias.type, alias.value);
  }

  // Merge observations
  if (sourcePerson.observations?.visits) {
    targetPerson.observations.visits = [
      ...(targetPerson.observations.visits || []),
      ...sourcePerson.observations.visits,
    ];
  }
  if (sourcePerson.observations?.scans) {
    targetPerson.observations.scans = [
      ...(targetPerson.observations.scans || []),
      ...sourcePerson.observations.scans,
    ];
  }

  // Update observation counts
  targetPerson.observationsCount =
    (targetPerson.observations.visits?.length || 0) +
    (targetPerson.observations.scans?.length || 0);

  // Update lastObservedAt if source is newer
  if (
    sourcePerson.lastObservedAt &&
    (!targetPerson.lastObservedAt ||
      sourcePerson.lastObservedAt > targetPerson.lastObservedAt)
  ) {
    targetPerson.lastObservedAt = sourcePerson.lastObservedAt;
  }

  // Save merged target
  await targetPerson.save();

  // Delete source person
  await Person.deleteOne({ _id: sourcePerson._id });
}

/**
 * Migrate a person from URL-based ID to stable ID
 */
async function migratePerson(person, newId, identifierType) {
  const oldId = person._id;

  // Check if new ID already exists
  const existingPerson = await Person.findById(newId);
  if (existingPerson) {
    // This is a duplicate - merge
    console.log(
      `  - Duplicate found: ${oldId} -> ${newId} (merging with existing)`
    );
    await mergePeople(person, existingPerson);
    stats.merged++;
    return { action: 'merged', oldId, newId, identifierType };
  }

  // Create new person document with stable ID
  const newPerson = new Person({
    _id: newId,
    canonical_id: person.canonical_id,
    aliases: [
      ...person.aliases,
      {
        type: 'profileUrl',
        value: oldId,
        addedAt: new Date(),
      },
    ],
    // Copy all other fields
    firstName: person.firstName,
    lastName: person.lastName,
    fullName: person.fullName,
    currentTitle: person.currentTitle,
    currentCompany: person.currentCompany,
    currentCompanyId: person.currentCompanyId,
    location: person.location,
    email: person.email,
    phone: person.phone,
    profilePicture: person.profilePicture,
    roles: person.roles,
    education: person.education,
    skills: person.skills,
    _meta: person._meta,
    observations: person.observations,
    lastObservedAt: person.lastObservedAt,
    observationsCount: person.observationsCount,
  });

  await newPerson.save();

  // Update references in changes collection
  await Change.updateMany(
    { person_id: oldId },
    { $set: { person_id: newId } }
  );

  // Update references in deadLetters collection
  await DeadLetter.updateMany(
    { 'payload.person_id': oldId },
    { $set: { 'payload.person_id': newId } }
  );

  // Delete old person
  await Person.deleteOne({ _id: oldId });

  stats.migrated++;
  console.log(`  ✓ Migrated: ${oldId} -> ${newId} (${identifierType})`);

  return { action: 'migrated', oldId, newId, identifierType };
}

/**
 * Process a batch of URL-based people
 */
async function processBatch(batchNumber, batchSize) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH ${batchNumber} - Processing ${batchSize} people`);
  console.log('='.repeat(60));

  const people = await Person.find({
    _id: { $regex: '^linkedin\\.com/in/' },
    aliases: {
      $not: {
        $elemMatch: {
          type: { $in: ['salesNavId', 'numericId', 'linkedInUsername'] },
        },
      },
    },
  })
    .limit(batchSize)
    .lean();

  console.log(`Found ${people.length} people to process`);

  const batchResults = [];

  for (const personData of people) {
    stats.totalProcessed++;
    const personId = personData._id;

    console.log(`\n[${stats.totalProcessed}] Processing: ${personId}`);

    // Fetch fresh person document (not lean)
    const person = await Person.findById(personId);
    if (!person) {
      console.log(`  - Person not found (may have been merged)`);
      continue;
    }

    // Fetch all observations
    const scans = await Scan.find({
      _id: { $in: person.observations?.scans || [] },
    });
    const visits = await Visit.find({
      _id: { $in: person.observations?.visits || [] },
    });

    const allObservations = [...scans, ...visits];
    console.log(`  - Found ${allObservations.length} observations`);

    // Extract stable identifiers from observations
    let foundSalesNavId = false;
    let foundNumericId = false;
    let foundUsername = false;

    for (const obs of allObservations) {
      const identifiers = extractStableIdentifiers(obs);

      if (identifiers.salesNavId) {
        if (addAliasIfMissing(person, 'salesNavId', identifiers.salesNavId)) {
          console.log(
            `  - Extracted salesNavId: ${identifiers.salesNavId}`
          );
          foundSalesNavId = true;
          stats.salesNavIdExtracted++;
        }
      }

      if (identifiers.numericId) {
        if (addAliasIfMissing(person, 'numericId', identifiers.numericId)) {
          console.log(`  - Extracted numericId: ${identifiers.numericId}`);
          foundNumericId = true;
          stats.numericIdExtracted++;
        }
      }

      if (identifiers.linkedInUsername) {
        if (
          addAliasIfMissing(
            person,
            'linkedInUsername',
            identifiers.linkedInUsername
          )
        ) {
          console.log(
            `  - Extracted linkedInUsername: ${identifiers.linkedInUsername}`
          );
          foundUsername = true;
          stats.linkedInUsernameExtracted++;
        }
      }
    }

    // Save updated aliases
    await person.save();

    // Determine best stable ID for migration
    const bestId = determineBestStableId(person);

    if (!bestId) {
      console.log(`  - No stable ID found - keeping URL-based ID`);
      stats.noStableIdFound++;
      stats.keptUrlBased++;
      continue;
    }

    // Migrate to stable ID
    try {
      const result = await migratePerson(person, bestId.value, bestId.type);
      batchResults.push(result);

      // Store sample migrations (first 10)
      if (stats.migrations.length < 10) {
        stats.migrations.push({
          ...result,
          observationsCount: allObservations.length,
        });
      }
    } catch (err) {
      console.error(`  ✗ Migration failed: ${err.message}`);
      stats.failed++;
    }
  }

  return batchResults;
}

/**
 * Main migration function
 */
async function runMigration() {
  console.log('\n' + '='.repeat(60));
  console.log('URL-BASED PERSON MIGRATION - PHASE 4');
  console.log('='.repeat(60));

  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is required');
  }

  await mongoose.connect(MONGODB_URI);
  console.log('✓ Connected to MongoDB');

  // Count total URL-based people
  const totalUrlBased = await Person.countDocuments({
    _id: { $regex: '^linkedin\\.com/in/' },
    aliases: {
      $not: {
        $elemMatch: {
          type: { $in: ['salesNavId', 'numericId', 'linkedInUsername'] },
        },
      },
    },
  });

  console.log(`\nTotal URL-based people to migrate: ${totalUrlBased}`);

  // Process in batches
  const batches = [
    { number: 1, size: 50 }, // First batch: 50 people for validation
  ];

  for (const batch of batches) {
    await processBatch(batch.number, batch.size);

    // Show progress
    console.log('\n' + '-'.repeat(60));
    console.log('BATCH COMPLETE - CURRENT STATISTICS');
    console.log('-'.repeat(60));
    console.log(`Processed: ${stats.totalProcessed}`);
    console.log(`  SalesNavId extracted: ${stats.salesNavIdExtracted}`);
    console.log(`  NumericId extracted: ${stats.numericIdExtracted}`);
    console.log(`  Username extracted: ${stats.linkedInUsernameExtracted}`);
    console.log(`  No stable ID: ${stats.noStableIdFound}`);
    console.log(`Migrated: ${stats.migrated}`);
    console.log(`Merged (duplicates): ${stats.merged}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Kept URL-based: ${stats.keptUrlBased}`);
  }

  // Final report
  console.log('\n\n' + '='.repeat(60));
  console.log('URL-BASED PERSON MIGRATION RESULTS');
  console.log('='.repeat(60));
  console.log(`\nStarting URL-based people: ${totalUrlBased}`);
  console.log('\nPhase 1: Re-extraction');
  console.log(`  People with extracted salesNavId: ${stats.salesNavIdExtracted}`);
  console.log(`  People with extracted numericId: ${stats.numericIdExtracted}`);
  console.log(`  People with extracted linkedInUsername: ${stats.linkedInUsernameExtracted}`);
  console.log(`  No stable ID found: ${stats.noStableIdFound}`);
  console.log('\nPhase 2: Migration');
  console.log(`  Successfully migrated: ${stats.migrated}`);
  console.log(`  Merged with existing (duplicates): ${stats.merged}`);
  console.log(`  Failed (conflicts): ${stats.failed}`);
  console.log(`  Kept as URL-based (no stable ID): ${stats.keptUrlBased}`);

  // Final counts
  const finalUrlBased = await Person.countDocuments({
    _id: { $regex: '^linkedin\\.com/in/' },
  });
  const totalPeople = await Person.countDocuments();

  console.log('\nFinal counts:');
  console.log(`  URL-based people remaining: ${finalUrlBased}`);
  console.log(`  Total people: ${totalPeople}`);

  if (stats.migrations.length > 0) {
    console.log(`\nSample migrations (first ${stats.migrations.length}):`);
    for (const migration of stats.migrations) {
      console.log(
        `  - ${migration.oldId} → ${migration.newId} | ${migration.identifierType} | ${migration.observationsCount} observations`
      );
    }
  }

  await mongoose.disconnect();
  console.log('\n✓ Disconnected from MongoDB');
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n✓ Migration completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗ Migration failed:', err);
    process.exit(1);
  });
