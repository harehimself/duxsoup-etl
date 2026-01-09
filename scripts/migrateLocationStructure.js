#!/usr/bin/env node

/**
 * Migrate Location Structure - Add Structured Location Fields
 *
 * This script updates existing location records in the locations collection
 * to populate the new structured fields (city, state, country, etc.) by
 * re-parsing the raw location strings.
 *
 * Usage:
 *   node scripts/migrateLocationStructure.js [options]
 *
 * Options:
 *   --dry-run            Don't actually update, just log what would happen
 *   --limit=N            Limit to N locations (for testing)
 *
 * Examples:
 *   node scripts/migrateLocationStructure.js --dry-run
 *   node scripts/migrateLocationStructure.js --limit=10
 *   node scripts/migrateLocationStructure.js
 */

const mongoose = require("mongoose");
const Location = require("../src/models/location");
const { parseLocation } = require("../src/utils/location-parser");
const logger = require("../src/utils/logger");

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    args[key] = value || true;
  });
  return args;
}

async function migrateLocationStructure(args) {
  console.log("🗺️  Starting location structure migration...", args);

  const stats = {
    locations_processed: 0,
    locations_updated: 0,
    locations_skipped: 0,
    errors: 0,
  };

  const startTime = Date.now();

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri);
    console.log("✓ Connected to MongoDB");

    const limit = args.limit ? parseInt(args.limit) : 0;

    // Find all locations
    const query = {};
    const locations = await Location.find(query).limit(limit);

    console.log(`\n📍 Found ${locations.length} locations to process\n`);

    for (const location of locations) {
      try {
        stats.locations_processed++;

        // Get the raw location string from aliases
        const rawAlias = location.aliases.find((a) => a.type === "raw");
        if (!rawAlias) {
          console.log(
            `  ⚠️  No raw alias found for location ${location._id}, skipping`,
          );
          stats.locations_skipped++;
          continue;
        }

        const rawLocation = rawAlias.value;

        // Parse the location
        const parsed = parseLocation(rawLocation);

        if (args["dry-run"]) {
          console.log(`  [DRY RUN] Would update location ${location._id}:`);
          console.log(`    Raw: "${rawLocation}"`);
          console.log(`    Parsed:`, {
            city: parsed.city,
            state: parsed.state,
            stateCode: parsed.stateCode,
            country: parsed.country,
            countryCode: parsed.countryCode,
            province: parsed.province,
            region: parsed.region,
            locationType: parsed.locationType,
          });
          stats.locations_skipped++;
        } else {
          // Update the location with structured fields
          location.snapshot = location.snapshot || {};
          location.snapshot.city = parsed.city;
          location.snapshot.state = parsed.state;
          location.snapshot.stateCode = parsed.stateCode;
          location.snapshot.country = parsed.country;
          location.snapshot.countryCode = parsed.countryCode;
          location.snapshot.province = parsed.province;
          location.snapshot.region = parsed.region;
          location.snapshot.locationType = parsed.locationType;

          await location.save();

          console.log(`  ✓ Updated ${location._id}: ${rawLocation}`);
          if (parsed.city || parsed.country) {
            console.log(
              `    → ${parsed.city || "(no city)"}${parsed.state ? ", " + parsed.state : ""}${parsed.country ? ", " + parsed.country : ""}`,
            );
          }

          stats.locations_updated++;
        }

        if (stats.locations_processed % 10 === 0) {
          console.log(`  ... Processed ${stats.locations_processed} locations`);
        }
      } catch (error) {
        logger.error("Failed to migrate location", {
          location_id: location._id,
          error: error.message,
        });
        console.error(`  ❌ Error processing ${location._id}:`, error.message);
        stats.errors++;
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n✅ Migration complete!");
    console.log("Statistics:");
    console.log(`  Locations processed: ${stats.locations_processed}`);
    console.log(`  Locations updated: ${stats.locations_updated}`);
    console.log(`  Locations skipped: ${stats.locations_skipped}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Elapsed: ${elapsedSeconds}s`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    logger.error("Migration failed", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

const args = parseArgs();

if (args.help || args.h) {
  console.log(`
Migrate Location Structure - Add Structured Location Fields

Usage: node scripts/migrateLocationStructure.js [options]

Options:
  --dry-run            Don't actually update, just log what would happen
  --limit=N            Limit to N locations (for testing)
  --help, -h           Show this help message

Examples:
  node scripts/migrateLocationStructure.js --dry-run
  node scripts/migrateLocationStructure.js --limit=10
  node scripts/migrateLocationStructure.js
  `);
  process.exit(0);
}

migrateLocationStructure(args);
