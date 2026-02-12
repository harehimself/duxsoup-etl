#!/usr/bin/env node

/**
 * Cap Observation Reference Arrays
 *
 * Trims oversized observations.visits and observations.scans arrays
 * to the most recent MAX_OBSERVATION_REFS entries. Sets meta.observationsCount
 * to the true total when it was previously derived from array lengths.
 *
 * Usage:
 *   node scripts/capObservationRefs.js [options]
 *
 * Options:
 *   --dry-run              Preview changes without saving (default)
 *   --commit               Execute updates (required to make changes)
 *   --collection=<name>    Only process: person, company, location (default: all)
 *   --batch-size=N         Process N documents per batch (default: 100)
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const Company = require("../src/models/company");
const Location = require("../src/models/location");
const { MAX_OBSERVATION_REFS } = require("../src/constants/limits");

function parseArgs() {
  const args = {
    dryRun: true,
    collection: null, // null = all
    batchSize: 100,
  };

  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") args.dryRun = false;
    else if (key === "collection") args.collection = value;
    else if (key === "batch-size") args.batchSize = parseInt(value, 10);
  });

  return args;
}

async function trimCollection(Model, collectionName, args) {
  const stats = {
    scanned: 0,
    trimmed: 0,
    visitRefsTrimmed: 0,
    scanRefsTrimmed: 0,
  };

  const cap = MAX_OBSERVATION_REFS;
  console.log(
    `  Processing ${collectionName} (cap=${cap}, dryRun=${args.dryRun})...`,
  );

  // Find documents where either array exceeds the cap
  const filter = {
    $or: [
      { [`observations.visits.${cap}`]: { $exists: true } },
      { [`observations.scans.${cap}`]: { $exists: true } },
    ],
  };

  const cursor = Model.find(filter)
    .select("_id observations meta")
    .cursor({ batchSize: args.batchSize });

  for await (const doc of cursor) {
    stats.scanned++;

    const visits = doc.observations?.visits || [];
    const scans = doc.observations?.scans || [];
    const visitsOver = visits.length > cap;
    const scansOver = scans.length > cap;

    if (!visitsOver && !scansOver) continue;

    // The true total is the sum of original array lengths if meta.observationsCount
    // equals the current array sum (meaning it was derived, not $inc-based).
    const currentCount = doc.meta?.observationsCount || 0;
    const arrayTotal = visits.length + scans.length;
    const trueCount =
      currentCount === arrayTotal || currentCount === 0
        ? arrayTotal
        : currentCount;

    const visitsTrimCount = visitsOver ? visits.length - cap : 0;
    const scansTrimCount = scansOver ? scans.length - cap : 0;

    stats.visitRefsTrimmed += visitsTrimCount;
    stats.scanRefsTrimmed += scansTrimCount;
    stats.trimmed++;

    if (!args.dryRun) {
      const $set = { "meta.observationsCount": trueCount };

      // Keep only the most recent entries (ObjectIds sort chronologically)
      if (visitsOver) {
        $set["observations.visits"] = visits.slice(-cap);
      }
      if (scansOver) {
        $set["observations.scans"] = scans.slice(-cap);
      }

      await Model.updateOne({ _id: doc._id }, { $set });
    }

    if (stats.trimmed % 100 === 0) {
      console.log(`    ...trimmed ${stats.trimmed} documents so far`);
    }
  }

  return stats;
}

async function main() {
  const args = parseArgs();
  const collections = {
    person: Person,
    company: Company,
    location: Location,
  };

  console.log("=== Cap Observation Reference Arrays ===");
  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "COMMIT"}`);
  console.log(`MAX_OBSERVATION_REFS: ${MAX_OBSERVATION_REFS}`);
  console.log();

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI environment variable is required");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB\n");

  const targets = args.collection
    ? { [args.collection]: collections[args.collection] }
    : collections;

  if (args.collection && !collections[args.collection]) {
    console.error(
      `Unknown collection: ${args.collection}. Use person, company, or location.`,
    );
    process.exit(1);
  }

  const allStats = {};

  for (const [name, Model] of Object.entries(targets)) {
    const stats = await trimCollection(Model, name, args);
    allStats[name] = stats;
  }

  console.log("\n=== Results ===");
  for (const [name, stats] of Object.entries(allStats)) {
    console.log(`  ${name}:`);
    console.log(`    Scanned (oversized): ${stats.scanned}`);
    console.log(`    Trimmed: ${stats.trimmed}`);
    console.log(`    Visit refs removed: ${stats.visitRefsTrimmed}`);
    console.log(`    Scan refs removed: ${stats.scanRefsTrimmed}`);
  }

  if (args.dryRun) {
    console.log("\nDRY RUN — no changes were made. Use --commit to execute.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
