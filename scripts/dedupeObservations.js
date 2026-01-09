#!/usr/bin/env node

/**
 * Safely deduplicate Scans and Visits collections
 *
 * Strategy:
 * 1. Analyze: Count records without event_key
 * 2. Backfill: Compute event_key for legacy records
 * 3. Identify: Find duplicate event_keys
 * 4. Backup & Remove: Archive duplicates, then delete
 *
 * Usage:
 *   node scripts/dedupeObservations.js --collection scans --dry-run
 *   node scripts/dedupeObservations.js --collection visits --dry-run
 *   node scripts/dedupeObservations.js --collection scans --execute
 *   node scripts/dedupeObservations.js --collection visits --execute
 */

const mongoose = require("mongoose");
const crypto = require("crypto");
require("dotenv").config();

const Visit = require("../src/models/visit");
const Scan = require("../src/models/scan");

// Color output for CLI
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Compute event_key from observation document
 * Matches logic from src/utils/eventKey.js
 */
function computeEventKey(doc) {
  // Extract fields needed for event_key
  const userid = doc.userid || doc.rawData?.userid || "no-user";
  const type = doc.rawData?.type || (doc.VisitTime ? "visit" : "scan");
  const time = doc.time || doc.VisitTime || doc.ScanTime || doc.createdAt;
  const id = doc.id;

  if (!id) {
    return null; // Cannot compute event_key without id
  }

  const components = [userid, type, time, id];
  const keyString = components.join("|");

  return crypto.createHash("sha1").update(keyString).digest("hex");
}

/**
 * Phase 1: Analyze collection for missing event_keys and potential duplicates
 */
async function analyzeCollection(Model, collectionName) {
  log(`\n=== Phase 1: Analyzing ${collectionName} collection ===`, "bright");

  const total = await Model.countDocuments();
  const withEventKey = await Model.countDocuments({ event_key: { $ne: null } });
  const withoutEventKey = total - withEventKey;

  log(`Total records: ${total}`, "cyan");
  log(`With event_key: ${withEventKey}`, "green");
  log(`Without event_key (legacy): ${withoutEventKey}`, "yellow");

  // Sample legacy records
  if (withoutEventKey > 0) {
    log("\nSample legacy record (missing event_key):", "yellow");
    const sample = await Model.findOne({ event_key: null }).lean();
    if (sample) {
      console.log({
        _id: sample._id,
        id: sample.id,
        userid: sample.userid || sample.rawData?.userid,
        time: sample.time || sample.VisitTime || sample.ScanTime,
        createdAt: sample.createdAt,
        has_event_key: !!sample.event_key,
      });
    }
  }

  // Check for records with duplicate event_keys (shouldn't happen with unique index, but check anyway)
  const duplicateEventKeys = await Model.aggregate([
    { $match: { event_key: { $ne: null } } },
    {
      $group: {
        _id: "$event_key",
        count: { $sum: 1 },
        docs: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicateEventKeys.length > 0) {
    log(
      `\nFound ${duplicateEventKeys.length} duplicate event_keys (should be prevented by unique index!)`,
      "red",
    );
    console.log(duplicateEventKeys.slice(0, 3));
  } else {
    log(
      "\nNo duplicate event_keys found (unique index working correctly)",
      "green",
    );
  }

  return {
    total,
    withEventKey,
    withoutEventKey,
    duplicateEventKeys: duplicateEventKeys.length,
  };
}

/**
 * Phase 2: Backfill event_key for legacy records
 */
async function backfillEventKeys(Model, collectionName, dryRun = true) {
  log(
    `\n=== Phase 2: Backfilling event_keys for ${collectionName} ===`,
    "bright",
  );

  const legacyRecords = await Model.find({ event_key: null }).lean();

  if (legacyRecords.length === 0) {
    log("No legacy records to backfill", "green");
    return { backfilled: 0, skipped: 0 };
  }

  log(`Found ${legacyRecords.length} legacy records to backfill`, "yellow");

  let backfilled = 0;
  let skipped = 0;
  const errors = [];

  for (const doc of legacyRecords) {
    const eventKey = computeEventKey(doc);

    if (!eventKey) {
      skipped++;
      log(`Skipping ${doc._id}: Missing required fields for event_key`, "red");
      continue;
    }

    if (dryRun) {
      log(`[DRY RUN] Would set event_key for ${doc._id}: ${eventKey}`, "blue");
      backfilled++;
    } else {
      try {
        // Check if event_key already exists (would violate unique constraint)
        const existing = await Model.findOne({ event_key: eventKey }).lean();

        if (existing && existing._id.toString() !== doc._id.toString()) {
          log(
            `Duplicate detected! event_key=${eventKey} already exists in ${existing._id}`,
            "red",
          );
          errors.push({
            duplicate_of: existing._id,
            current: doc._id,
            event_key: eventKey,
          });
          skipped++;
          continue;
        }

        // Update the document with computed event_key
        await Model.updateOne(
          { _id: doc._id },
          { $set: { event_key: eventKey } },
        );
        backfilled++;

        if (backfilled % 100 === 0) {
          log(`Backfilled ${backfilled} records...`, "cyan");
        }
      } catch (error) {
        skipped++;
        log(`Error backfilling ${doc._id}: ${error.message}`, "red");
        errors.push({
          _id: doc._id,
          error: error.message,
          event_key: eventKey,
        });
      }
    }
  }

  log(`\nBackfill complete:`, "bright");
  log(`  Backfilled: ${backfilled}`, "green");
  log(`  Skipped: ${skipped}`, "yellow");

  if (errors.length > 0) {
    log(
      `\n  Errors (duplicates detected during backfill): ${errors.length}`,
      "red",
    );
    console.log("First 5 errors:");
    console.log(JSON.stringify(errors.slice(0, 5), null, 2));
  }

  return { backfilled, skipped, errors };
}

/**
 * Phase 3: Identify duplicates after backfill
 *
 * This identifies records that have the same event_key but different _id
 * (shouldn't exist with unique index, but may appear during backfill)
 */
async function identifyDuplicates(Model, collectionName) {
  log(
    `\n=== Phase 3: Identifying duplicates in ${collectionName} ===`,
    "bright",
  );

  // Find all event_keys that appear more than once
  const duplicateGroups = await Model.aggregate([
    { $match: { event_key: { $ne: null } } },
    {
      $group: {
        _id: "$event_key",
        count: { $sum: 1 },
        docs: { $push: { _id: "$_id", createdAt: "$createdAt", id: "$id" } },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (duplicateGroups.length === 0) {
    log("No duplicates found!", "green");
    return { groups: [], totalDuplicates: 0 };
  }

  const totalDuplicates = duplicateGroups.reduce(
    (sum, group) => sum + (group.count - 1),
    0,
  );

  log(`Found ${duplicateGroups.length} duplicate event_key groups`, "yellow");
  log(`Total duplicate records to remove: ${totalDuplicates}`, "yellow");

  // Show sample duplicates
  log("\nSample duplicate groups (showing first 3):", "yellow");
  for (const group of duplicateGroups.slice(0, 3)) {
    console.log({
      event_key: group._id,
      count: group.count,
      docs: group.docs,
    });
  }

  return { groups: duplicateGroups, totalDuplicates };
}

/**
 * Phase 4: Remove duplicates (keeping oldest by createdAt)
 *
 * Strategy: For each duplicate group, keep the oldest record and remove the rest
 */
async function removeDuplicates(
  Model,
  collectionName,
  duplicateGroups,
  dryRun = true,
) {
  log(
    `\n=== Phase 4: Removing duplicates from ${collectionName} ===`,
    "bright",
  );

  if (duplicateGroups.length === 0) {
    log("No duplicates to remove", "green");
    return { removed: 0, kept: 0 };
  }

  let removed = 0;
  let kept = 0;
  const backupCollection = `${collectionName}_duplicates_backup`;

  if (!dryRun) {
    log(`Backing up duplicates to collection: ${backupCollection}`, "cyan");
  }

  for (const group of duplicateGroups) {
    // Sort by createdAt (oldest first)
    const sorted = group.docs.sort((a, b) => {
      const dateA = a.createdAt || new Date(0);
      const dateB = b.createdAt || new Date(0);
      return dateA - dateB;
    });

    const toKeep = sorted[0]; // Keep oldest
    const toRemove = sorted.slice(1); // Remove rest

    kept++;

    for (const duplicate of toRemove) {
      if (dryRun) {
        log(
          `[DRY RUN] Would remove duplicate ${duplicate._id} (keeping ${toKeep._id})`,
          "blue",
        );
      } else {
        // Backup duplicate before removing
        const doc = await Model.findById(duplicate._id).lean();
        if (doc) {
          await mongoose.connection.db.collection(backupCollection).insertOne({
            ...doc,
            _backup_reason: "duplicate_event_key",
            _backup_date: new Date(),
            _kept_record_id: toKeep._id,
          });
        }

        // Remove duplicate
        await Model.deleteOne({ _id: duplicate._id });
        removed++;

        if (removed % 100 === 0) {
          log(`Removed ${removed} duplicates...`, "cyan");
        }
      }
    }
  }

  log(`\nRemoval complete:`, "bright");
  log(`  Records kept (oldest): ${kept}`, "green");
  log(`  Duplicates removed: ${removed}`, "yellow");

  if (!dryRun) {
    log(`  Backup location: ${backupCollection}`, "cyan");
  }

  return { removed, kept };
}

/**
 * Main execution flow
 */
async function main() {
  const args = process.argv.slice(2);
  const collectionArg = args.find((arg) => arg.startsWith("--collection="));
  const collection = collectionArg ? collectionArg.split("=")[1] : null;
  const dryRun = !args.includes("--execute");

  if (!collection || !["scans", "visits"].includes(collection)) {
    log("Error: Must specify --collection=scans or --collection=visits", "red");
    log("\nUsage:", "yellow");
    log(
      "  node scripts/dedupeObservations.js --collection=scans --dry-run",
      "cyan",
    );
    log(
      "  node scripts/dedupeObservations.js --collection=visits --dry-run",
      "cyan",
    );
    log(
      "  node scripts/dedupeObservations.js --collection=scans --execute",
      "cyan",
    );
    log(
      "  node scripts/dedupeObservations.js --collection=visits --execute",
      "cyan",
    );
    process.exit(1);
  }

  const Model = collection === "scans" ? Scan : Visit;
  const collectionName = collection;

  log(`\n${"=".repeat(60)}`, "bright");
  log(`DuxSoup ETL - Observation Deduplication Script`, "bright");
  log(`${"=".repeat(60)}`, "bright");
  log(`Collection: ${collectionName}`, "cyan");
  log(`Mode: ${dryRun ? "DRY RUN" : "EXECUTE"}`, dryRun ? "yellow" : "red");
  log(`${"=".repeat(60)}\n`, "bright");

  if (dryRun) {
    log("Running in DRY RUN mode - no changes will be made", "yellow");
    log("Use --execute to actually perform deduplication\n", "yellow");
  } else {
    log("WARNING: Running in EXECUTE mode - changes will be made!", "red");
    log("Duplicates will be backed up before removal\n", "red");
  }

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    log("Connected to MongoDB\n", "green");

    // Phase 1: Analyze
    const analysis = await analyzeCollection(Model, collectionName);

    // Phase 2: Backfill event_keys
    const backfillResults = await backfillEventKeys(
      Model,
      collectionName,
      dryRun,
    );

    // Phase 3: Identify duplicates
    const { groups: duplicateGroups, totalDuplicates } =
      await identifyDuplicates(Model, collectionName);

    // Phase 4: Remove duplicates
    const removalResults = await removeDuplicates(
      Model,
      collectionName,
      duplicateGroups,
      dryRun,
    );

    // Summary
    log(`\n${"=".repeat(60)}`, "bright");
    log("SUMMARY", "bright");
    log(`${"=".repeat(60)}`, "bright");
    log(`Collection: ${collectionName}`, "cyan");
    log(`Total records: ${analysis.total}`, "cyan");
    log(`Legacy records backfilled: ${backfillResults.backfilled}`, "green");
    log(`Duplicate groups found: ${duplicateGroups.length}`, "yellow");
    log(`Total duplicates removed: ${removalResults.removed}`, "yellow");
    log(`${"=".repeat(60)}\n`, "bright");

    if (dryRun) {
      log("This was a DRY RUN - no changes were made", "yellow");
      log("Run with --execute to actually perform deduplication", "yellow");
    } else {
      log("Deduplication complete!", "green");
      log(`Backup collection: ${collectionName}_duplicates_backup`, "cyan");
    }
  } catch (error) {
    log(`\nError: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log("\nDisconnected from MongoDB", "green");
  }
}

// Run script
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  computeEventKey,
  analyzeCollection,
  backfillEventKeys,
  identifyDuplicates,
  removeDuplicates,
};
