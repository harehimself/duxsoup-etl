#!/usr/bin/env node

/**
 * HTTPS URL Backfill
 *
 * Converts http:// URLs to https:// in Person and Company snapshots.
 * Uses aggregation pipeline updates for efficient bulk processing.
 *
 * Usage:
 *   node scripts/backfillHttpsUrls.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const Company = require("../src/models/company");
const logger = require("../src/utils/logger");

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
  };

  process.argv.slice(2).forEach((arg) => {
    const key = arg.replace("--", "");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") {
      args.dryRun = false;
      args.commit = true;
    }
  });

  return args;
}

async function backfillHttpsUrls(args) {
  console.log("🔒 Starting HTTPS URL backfill...");
  console.log("Options:", args);
  console.log("");

  if (args.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
    console.log("   Use --commit to execute updates\n");
  }

  const stats = {
    personCount: 0,
    personUpdated: 0,
    companyCount: 0,
    companyUpdated: 0,
  };

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, { dbName: "duxsoup" });
    console.log("✓ Connected to MongoDB\n");

    // Count Person records with http:// companyWebsite (including merged)
    stats.personCount = await Person.countDocuments({
      "snapshot.companyWebsite": /^http:\/\//,
    });
    console.log(
      `Found ${stats.personCount} Person records with http:// companyWebsite`,
    );

    // Count Company records with http:// website
    stats.companyCount = await Company.countDocuments({
      "snapshot.website": /^http:\/\//,
    });
    console.log(
      `Found ${stats.companyCount} Company records with http:// website`,
    );

    if (!args.dryRun) {
      // Use native driver for aggregation pipeline updates
      // (Mongoose updateMany rejects array pipelines without extra config)
      const personCollection = Person.collection;
      const companyCollection = Company.collection;

      // Update Person records
      if (stats.personCount > 0) {
        const personResult = await personCollection.updateMany(
          {
            "snapshot.companyWebsite": { $regex: "^http://" },
          },
          [
            {
              $set: {
                "snapshot.companyWebsite": {
                  $replaceOne: {
                    input: "$snapshot.companyWebsite",
                    find: "http://",
                    replacement: "https://",
                  },
                },
                "snapshot._meta.companyWebsite.value": {
                  $replaceOne: {
                    input: "$snapshot._meta.companyWebsite.value",
                    find: "http://",
                    replacement: "https://",
                  },
                },
              },
            },
          ],
        );
        stats.personUpdated = personResult.modifiedCount;
        console.log(`✓ Updated ${stats.personUpdated} Person records`);
      }

      // Update Company records
      if (stats.companyCount > 0) {
        const companyResult = await companyCollection.updateMany(
          { "snapshot.website": { $regex: "^http://" } },
          [
            {
              $set: {
                "snapshot.website": {
                  $replaceOne: {
                    input: "$snapshot.website",
                    find: "http://",
                    replacement: "https://",
                  },
                },
                "snapshot._meta.website.value": {
                  $replaceOne: {
                    input: "$snapshot._meta.website.value",
                    find: "http://",
                    replacement: "https://",
                  },
                },
              },
            },
          ],
        );
        stats.companyUpdated = companyResult.modifiedCount;
        console.log(`✓ Updated ${stats.companyUpdated} Company records`);
      }
    }

    console.log("\n✅ HTTPS URL backfill complete");
    console.log("Stats:", stats);
  } catch (error) {
    logger.error("HTTPS URL backfill failed", {
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
module.exports = { backfillHttpsUrls, parseArgs };

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();
  backfillHttpsUrls(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
