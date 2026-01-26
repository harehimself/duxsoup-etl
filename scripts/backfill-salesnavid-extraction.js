/**
 * Backfill Script: Extract salesNavId from URL Aliases
 *
 * This script fixes existing Person records by:
 * 1. Extracting salesNavIds from URL aliases (salesUrl, recruiterUrl, profileUrl)
 * 2. Normalizing salesNavIds to canonical case
 * 3. Updating canonical_ids using new priority logic
 * 4. Identifying potential duplicates for manual review
 *
 * Run with:
 *   node scripts/backfill-salesnavid-extraction.js [--dry-run] [--limit=100]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const {
  extractSalesNavIdFromUrl,
  normalizeToCanonicalCase,
  extractNumericId,
} = require('../src/utils/salesNavIdExtractor');
const { computeCanonicalId, buildCanonicalKey } = require('../src/utils/identityResolver');
const logger = require('../src/utils/logger');

// Parse command line args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// Statistics
const stats = {
  processed: 0,
  salesNavIdExtracted: 0,
  salesNavIdNormalized: 0,
  numericIdExtracted: 0,
  canonicalIdUpdated: 0,
  potentialDuplicates: 0,
  errors: 0,
};

/**
 * Main backfill process
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill: Extract salesNavId from URL Aliases');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE (will update DB)'}`);
  console.log(`Limit: ${limit ? limit + ' records' : 'All records'}`);
  console.log('');

  // Connect to database
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB\n');

  // Find people without salesNavId alias but with URL aliases
  const query = {
    $and: [
      // Must have at least one URL alias
      {
        $or: [
          { 'aliases.type': 'salesUrl' },
          { 'aliases.type': 'recruiterUrl' },
          { 'aliases.type': 'profileUrl' },
          { 'aliases.type': 'publicUrl' },
        ],
      },
    ],
  };

  const total = await Person.countDocuments(query);
  console.log(`Found ${total} people with URL aliases to process\n`);

  // Process in batches
  const batchSize = 100;
  let processed = 0;
  const maxToProcess = limit || total;

  while (processed < maxToProcess) {
    const batch = await Person.find(query)
      .skip(processed)
      .limit(Math.min(batchSize, maxToProcess - processed))
      .lean();

    if (batch.length === 0) break;

    for (const person of batch) {
      await processPerson(person);
      stats.processed++;
    }

    processed += batch.length;
    console.log(`Progress: ${processed}/${maxToProcess} (${Math.round((processed / maxToProcess) * 100)}%)`);
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Backfill Complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Processed:              ${stats.processed}`);
  console.log(`salesNavId extracted:   ${stats.salesNavIdExtracted}`);
  console.log(`salesNavId normalized:  ${stats.salesNavIdNormalized}`);
  console.log(`numericId extracted:    ${stats.numericIdExtracted}`);
  console.log(`canonical_id updated:   ${stats.canonicalIdUpdated}`);
  console.log(`Potential duplicates:   ${stats.potentialDuplicates}`);
  console.log(`Errors:                 ${stats.errors}`);
  console.log('');

  if (isDryRun) {
    console.log('ℹ️  DRY RUN - No changes were made to the database');
  } else {
    console.log('✓ Database updated successfully');
  }

  await mongoose.disconnect();
}

/**
 * Process a single person record
 */
async function processPerson(personDoc) {
  try {
    const updates = {
      aliasesToAdd: [],
      canonicalIdToUpdate: null,
    };

    // Check if already has salesNavId
    const existingSalesNavId = personDoc.aliases?.find(a => a.type === 'salesNavId')?.value;

    // Extract salesNavId from URL aliases
    const urlAliases = personDoc.aliases?.filter(a =>
      ['salesUrl', 'recruiterUrl', 'profileUrl', 'publicUrl'].includes(a.type)
    ) || [];

    let extractedSalesNavId = null;

    for (const alias of urlAliases) {
      const salesNavId = extractSalesNavIdFromUrl(alias.value);
      if (salesNavId) {
        extractedSalesNavId = salesNavId;
        break;
      }
    }

    // If we extracted a salesNavId
    if (extractedSalesNavId) {
      const canonicalId = normalizeToCanonicalCase(extractedSalesNavId);

      if (!existingSalesNavId) {
        // Add new salesNavId alias
        updates.aliasesToAdd.push({
          type: 'salesNavId',
          value: canonicalId,
          addedAt: new Date(),
        });
        stats.salesNavIdExtracted++;

        console.log(`  [${personDoc._id}] Extracted salesNavId: ${canonicalId}`);
      } else if (existingSalesNavId !== canonicalId) {
        // Normalize existing salesNavId to canonical case
        if (existingSalesNavId.toLowerCase() === canonicalId.toLowerCase()) {
          updates.aliasesToAdd.push({
            type: 'salesNavId',
            value: canonicalId,
            addedAt: new Date(),
          });
          stats.salesNavIdNormalized++;

          console.log(`  [${personDoc._id}] Normalized salesNavId: ${existingSalesNavId} → ${canonicalId}`);
        } else {
          // Different salesNavId - potential duplicate!
          stats.potentialDuplicates++;
          console.warn(`  ⚠️  [${personDoc._id}] CONFLICT: Existing=${existingSalesNavId}, Extracted=${canonicalId}`);
        }
      }

      // Update canonical_id if needed (salesNavId has highest priority)
      const newCanonicalKey = buildCanonicalKey('salesNavId', canonicalId);
      const newCanonicalId = computeCanonicalId(newCanonicalKey);

      if (!personDoc.canonical_id || personDoc.canonical_id !== newCanonicalId) {
        updates.canonicalIdToUpdate = newCanonicalId;
        stats.canonicalIdUpdated++;

        console.log(`  [${personDoc._id}] Update canonical_id: ${personDoc.canonical_id || 'null'} → ${newCanonicalId}`);
      }
    }

    // Extract numericId from duxsoupId if available
    const duxsoupId = personDoc.aliases?.find(a => a.type === 'duxsoupId')?.value;
    const existingNumericId = personDoc.aliases?.find(a => a.type === 'numericId')?.value;

    if (duxsoupId && !existingNumericId) {
      const numericId = extractNumericId(duxsoupId);
      if (numericId) {
        updates.aliasesToAdd.push({
          type: 'numericId',
          value: numericId,
          addedAt: new Date(),
        });
        stats.numericIdExtracted++;

        console.log(`  [${personDoc._id}] Extracted numericId: ${numericId}`);
      }
    }

    // Apply updates
    if (!isDryRun && (updates.aliasesToAdd.length > 0 || updates.canonicalIdToUpdate)) {
      const updateOps = {};

      if (updates.aliasesToAdd.length > 0) {
        updateOps.$addToSet = {
          aliases: { $each: updates.aliasesToAdd },
        };
      }

      if (updates.canonicalIdToUpdate) {
        updateOps.$set = {
          canonical_id: updates.canonicalIdToUpdate,
        };
      }

      await Person.updateOne({ _id: personDoc._id }, updateOps);
    }
  } catch (error) {
    stats.errors++;
    console.error(`  ✗ [${personDoc._id}] Error:`, error.message);
  }
}

// Run the script
main()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
