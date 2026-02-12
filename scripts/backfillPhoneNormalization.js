#!/usr/bin/env node

/**
 * Phone Number Normalization Backfill
 *
 * Normalizes existing phone numbers to E.164 format using libphonenumber-js.
 * Uses person's countryCode as default country when available.
 *
 * Usage:
 *   node scripts/backfillPhoneNormalization.js [options]
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
const { normalizePhone } = require("../src/utils/phoneNormalizer");

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

async function backfillPhoneNormalization(args) {
  console.log("📞 Starting phone normalization backfill...");
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
    await mongoose.connect(mongoUri);
    console.log("✓ Connected to MongoDB\n");

    const query = {
      "snapshot.phone": { $nin: [null, ""] },
      mergedInto: { $exists: false },
    };

    const people = await Person.find(query)
      .select("_id snapshot.phone snapshot.countryCode snapshot._meta.phone")
      .limit(args.limit)
      .lean();

    console.log(`Found ${people.length} people with phone numbers\n`);

    for (let i = 0; i < people.length; i += args.batchSize) {
      const batch = people.slice(i, i + args.batchSize);

      for (const person of batch) {
        stats.processed += 1;
        const rawPhone = person.snapshot?.phone;

        if (!rawPhone) {
          stats.skipped += 1;
          continue;
        }

        // Use person's country code as default country when available
        const defaultCountry = person.snapshot?.countryCode || undefined;
        const normalized = normalizePhone(rawPhone, defaultCountry);

        if (!normalized || normalized === rawPhone) {
          stats.skipped += 1;
          continue;
        }

        if (args.dryRun) {
          logger.info("Would normalize phone", {
            person_id: person._id,
            from: rawPhone,
            to: normalized,
            defaultCountry: defaultCountry || "US (default)",
          });
          stats.updated += 1;
          continue;
        }

        try {
          await Person.updateOne(
            { _id: person._id },
            {
              $set: {
                "snapshot.phone": normalized,
                "snapshot._meta.phone.value": normalized,
              },
            },
          );
          stats.updated += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error("Failed to normalize phone", {
            person_id: person._id,
            error: error.message,
          });
        }
      }
    }

    console.log("\n✅ Phone normalization backfill complete");
    console.log("Stats:", stats);
  } catch (error) {
    logger.error("Phone normalization backfill failed", {
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
module.exports = { backfillPhoneNormalization, parseArgs };

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();
  backfillPhoneNormalization(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
