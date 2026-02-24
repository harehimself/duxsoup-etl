#!/usr/bin/env node

/**
 * Twitter Handle Normalization Backfill
 *
 * Normalizes existing Twitter handles to bare lowercase usernames.
 * Strips @, extracts from URLs, lowercases.
 *
 * Usage:
 *   node scripts/backfillTwitterNormalization.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N people (default: 1000)
 *   --batch-size=N       Process N people per batch (default: 100)
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const logger = require("../src/utils/logger");
const { normalizeTwitter } = require("../src/utils/twitterNormalizer");

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 1000,
    batchSize: 100,
  };

  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") {
      args.dryRun = false;
      args.commit = true;
    } else if (key === "limit") args.limit = parseInt(value, 10);
    else if (key === "batch-size") args.batchSize = parseInt(value, 10);
  });

  return args;
}

async function backfillTwitterNormalization(args) {
  console.log("🐦 Starting Twitter normalization backfill...");
  console.log("Options:", args);
  console.log("");

  if (args.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
    console.log("   Use --commit to execute updates\n");
  }

  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log("✓ Connected to MongoDB\n");

    const query = {
      "snapshot.twitter": { $nin: [null, ""] },
      mergedInto: { $exists: false },
    };

    const people = await Person.find(query)
      .select("_id snapshot.twitter snapshot._meta.twitter")
      .limit(args.limit)
      .lean();

    console.log(`Found ${people.length} people with Twitter handles\n`);

    for (let i = 0; i < people.length; i += args.batchSize) {
      const batch = people.slice(i, i + args.batchSize);

      for (const person of batch) {
        stats.processed += 1;
        const rawTwitter = person.snapshot?.twitter;

        if (!rawTwitter) {
          stats.skipped += 1;
          continue;
        }

        const normalized = normalizeTwitter(rawTwitter);

        if (!normalized || normalized === rawTwitter) {
          stats.skipped += 1;
          continue;
        }

        if (args.dryRun) {
          logger.info("Would normalize twitter", {
            person_id: person._id,
            from: rawTwitter,
            to: normalized,
          });
          stats.updated += 1;
          continue;
        }

        try {
          await Person.updateOne(
            { _id: person._id },
            {
              $set: {
                "snapshot.twitter": normalized,
                "snapshot._meta.twitter.value": normalized,
              },
            },
          );
          stats.updated += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error("Failed to normalize twitter", {
            person_id: person._id,
            error: error.message,
          });
        }
      }
    }

    console.log("\n✅ Twitter normalization backfill complete");
    console.log("Stats:", stats);
  } catch (error) {
    logger.error("Twitter normalization backfill failed", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await mongoose.disconnect();
  }

  return stats;
}

// Export for testing
module.exports = { backfillTwitterNormalization, parseArgs };

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();
  backfillTwitterNormalization(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
