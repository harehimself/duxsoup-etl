#!/usr/bin/env node

/**
 * HTML Sanitization Backfill
 *
 * Strips HTML tags and decodes entities from existing summary and
 * role description fields on Person snapshots.
 *
 * Usage:
 *   node scripts/backfillHtmlSanitization.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N people (default: 1000)
 *   --batch-size=N       Process N people per batch (default: 100)
 *   --target=summary|roles  Only process one target (default: both)
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const logger = require("../src/utils/logger");
const { stripHtmlTags } = require("../src/utils/htmlSanitizer");

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 1000,
    batchSize: 100,
    target: null, // null = both
  };

  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") {
      args.dryRun = false;
      args.commit = true;
    } else if (key === "limit") args.limit = parseInt(value, 10);
    else if (key === "batch-size") args.batchSize = parseInt(value, 10);
    else if (key === "target") args.target = value;
  });

  return args;
}

async function backfillHtmlSanitization(args) {
  console.log("🧹 Starting HTML sanitization backfill...");
  console.log("Options:", args);
  console.log("");

  if (args.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
    console.log("   Use --commit to execute updates\n");
  }

  const stats = {
    processed: 0,
    summaryUpdated: 0,
    rolesUpdated: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, {
      dbName: process.env.MONGODB_DB_NAME || "duxsoup",
    });
    console.log("✓ Connected to MongoDB\n");

    // Build query based on target
    const query = { mergedInto: { $exists: false } };
    const selectFields = ["_id"];

    if (!args.target || args.target === "summary") {
      selectFields.push("snapshot.summary", "snapshot._meta.summary");
    }
    if (!args.target || args.target === "roles") {
      selectFields.push("snapshot.roles");
    }

    const people = await Person.find(query)
      .select(selectFields.join(" "))
      .limit(args.limit)
      .lean();

    console.log(`Found ${people.length} people to process\n`);

    for (let i = 0; i < people.length; i += args.batchSize) {
      const batch = people.slice(i, i + args.batchSize);

      for (const person of batch) {
        stats.processed += 1;
        const updates = {};
        let changed = false;

        // Pass 1: Summary
        if (!args.target || args.target === "summary") {
          const rawSummary = person.snapshot?.summary;
          if (rawSummary && typeof rawSummary === "string") {
            const stripped = stripHtmlTags(rawSummary);
            if (stripped !== rawSummary) {
              updates["snapshot.summary"] = stripped;
              updates["snapshot._meta.summary.value"] = stripped;
              stats.summaryUpdated += 1;
              changed = true;

              if (args.dryRun) {
                logger.info("Would strip HTML from summary", {
                  person_id: person._id,
                  originalLength: rawSummary.length,
                  cleanedLength: stripped ? stripped.length : 0,
                });
              }
            }
          }
        }

        // Pass 2: Role descriptions
        if (!args.target || args.target === "roles") {
          const roles = person.snapshot?.roles;
          if (roles && roles.length > 0) {
            let rolesChanged = false;
            const updatedRoles = roles.map((role) => {
              if (
                role.description &&
                typeof role.description === "string"
              ) {
                const stripped = stripHtmlTags(role.description);
                if (stripped !== role.description) {
                  rolesChanged = true;
                  return { ...role, description: stripped };
                }
              }
              return role;
            });

            if (rolesChanged) {
              updates["snapshot.roles"] = updatedRoles;
              stats.rolesUpdated += 1;
              changed = true;

              if (args.dryRun) {
                logger.info("Would strip HTML from role descriptions", {
                  person_id: person._id,
                });
              }
            }
          }
        }

        if (!changed) {
          stats.skipped += 1;
          continue;
        }

        if (args.dryRun) {
          continue;
        }

        try {
          await Person.updateOne({ _id: person._id }, { $set: updates });
        } catch (error) {
          stats.failed += 1;
          logger.error("Failed to strip HTML", {
            person_id: person._id,
            error: error.message,
          });
        }
      }
    }

    console.log("\n✅ HTML sanitization backfill complete");
    console.log("Stats:", stats);
  } catch (error) {
    logger.error("HTML sanitization backfill failed", {
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
module.exports = { backfillHtmlSanitization, parseArgs };

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();
  backfillHtmlSanitization(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
