#!/usr/bin/env node

/**
 * Comprehensive Duplicate Analysis Script
 *
 * Analyzes all collections for different types of duplicates:
 * - Scans: event_key, profile combinations, timing patterns
 * - Visits: event_key, profile combinations, timing patterns
 * - People: canonical_id, aliases, name combinations
 * - Companies: canonical_id, name variations
 * - Locations: canonical_id, name variations
 *
 * Usage:
 *   node scripts/analyzeDuplicates.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const Scan = require("../src/models/scan");
const Visit = require("../src/models/visit");

// Color output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  log(`\n${"=".repeat(70)}`, "bright");
  log(title, "bright");
  log("=".repeat(70), "bright");
}

/**
 * Analyze Scans collection for various duplicate patterns
 */
async function analyzeScans() {
  section("SCANS COLLECTION ANALYSIS");

  const total = await Scan.countDocuments();
  log(`\nTotal scans: ${total}`, "cyan");

  // 1. Event key analysis (webhook retries)
  log("\n1. Webhook Retry Duplicates (same event_key):", "yellow");
  const eventKeyDupes = await Scan.aggregate([
    { $match: { event_key: { $ne: null } } },
    {
      $group: {
        _id: "$event_key",
        count: { $sum: 1 },
        docs: { $push: { _id: "$_id", createdAt: "$createdAt" } },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  log(
    `   Found ${eventKeyDupes.length} duplicate event_key groups`,
    eventKeyDupes.length > 0 ? "red" : "green",
  );
  if (eventKeyDupes.length > 0) {
    log("   Top 3 duplicate groups:", "yellow");
    eventKeyDupes.slice(0, 3).forEach((group) => {
      console.log(
        `     - event_key: ${group._id.substring(0, 16)}... (${group.count} copies)`,
      );
    });
  }

  // 2. Profile URL duplicates (same person scanned multiple times)
  log("\n2. Same Profile Scanned Multiple Times:", "yellow");
  const profileDupes = await Scan.aggregate([
    { $match: { Profile: { $ne: null, $ne: "" } } },
    {
      $group: {
        _id: "$Profile",
        count: { $sum: 1 },
        first_scan: { $min: "$ScanTime" },
        last_scan: { $max: "$ScanTime" },
        ids: { $push: "$id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  log(
    `   Found ${profileDupes.length} profiles scanned multiple times`,
    "cyan",
  );
  if (profileDupes.length > 0) {
    log("   Top 5 most scanned profiles:", "yellow");
    for (const profile of profileDupes.slice(0, 5)) {
      const daysDiff = Math.floor(
        (profile.last_scan - profile.first_scan) / (1000 * 60 * 60 * 24),
      );
      console.log(
        `     - ${profile._id.substring(0, 50)}... (${profile.count} scans over ${daysDiff} days)`,
      );
    }
  }

  // 3. Same person, same time (true duplicates)
  log("\n3. Same Person + Same Time (True Duplicates):", "yellow");
  const sameDayDupes = await Scan.aggregate([
    { $match: { Profile: { $ne: null, $ne: "" } } },
    {
      $addFields: {
        scanDate: {
          $dateToString: { format: "%Y-%m-%d", date: "$ScanTime" },
        },
      },
    },
    {
      $group: {
        _id: { profile: "$Profile", date: "$scanDate" },
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: "$_id",
            id: "$id",
            ScanTime: "$ScanTime",
            event_key: "$event_key",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  log(
    `   Found ${sameDayDupes.length} cases of same person scanned multiple times on same day`,
    sameDayDupes.length > 0 ? "red" : "green",
  );
  if (sameDayDupes.length > 0) {
    log("   Sample (first 3):", "yellow");
    sameDayDupes.slice(0, 3).forEach((dup) => {
      console.log(`     - ${dup._id.profile.substring(0, 40)}...`);
      console.log(`       Date: ${dup._id.date}, Count: ${dup.count}`);
      console.log(
        `       Event keys: ${dup.docs.map((d) => (d.event_key ? "✓" : "✗")).join(", ")}`,
      );
    });
  }

  // 4. DuxSoup ID duplicates (should be unique per scan)
  log("\n4. DuxSoup ID Duplicates (same 'id' field):", "yellow");
  const duxIdDupes = await Scan.aggregate([
    { $match: { id: { $ne: null } } },
    {
      $group: {
        _id: "$id",
        count: { $sum: 1 },
        profiles: { $addToSet: "$Profile" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  log(
    `   Found ${duxIdDupes.length} duplicate DuxSoup IDs`,
    duxIdDupes.length > 0 ? "red" : "green",
  );
  if (duxIdDupes.length > 0) {
    log("   Top 3:", "yellow");
    duxIdDupes.slice(0, 3).forEach((dup) => {
      console.log(`     - id: ${dup._id} (${dup.count} copies)`);
      console.log(`       Profiles: ${dup.profiles.length} unique`);
    });
  }

  // 5. Missing event_key summary
  log("\n5. Event Key Coverage:", "yellow");
  const withKey = await Scan.countDocuments({ event_key: { $ne: null } });
  const withoutKey = total - withKey;
  log(
    `   With event_key: ${withKey} (${((withKey / total) * 100).toFixed(1)}%)`,
    "green",
  );
  log(
    `   Without event_key: ${withoutKey} (${((withoutKey / total) * 100).toFixed(1)}%)`,
    withoutKey > 0 ? "yellow" : "green",
  );

  return {
    total,
    eventKeyDupes: eventKeyDupes.length,
    profileDupes: profileDupes.length,
    sameDayDupes: sameDayDupes.length,
    duxIdDupes: duxIdDupes.length,
    withoutEventKey: withoutKey,
  };
}

/**
 * Analyze Visits collection
 */
async function analyzeVisits() {
  section("VISITS COLLECTION ANALYSIS");

  const total = await Visit.countDocuments();
  log(`\nTotal visits: ${total}`, "cyan");

  // Same analysis as scans
  log("\n1. Webhook Retry Duplicates (same event_key):", "yellow");
  const eventKeyDupes = await Visit.aggregate([
    { $match: { event_key: { $ne: null } } },
    {
      $group: {
        _id: "$event_key",
        count: { $sum: 1 },
        docs: { $push: { _id: "$_id", createdAt: "$createdAt" } },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  log(
    `   Found ${eventKeyDupes.length} duplicate event_key groups`,
    eventKeyDupes.length > 0 ? "red" : "green",
  );

  log("\n2. Same Profile Visited Multiple Times:", "yellow");
  const profileDupes = await Visit.aggregate([
    { $match: { Profile: { $ne: null, $ne: "" } } },
    {
      $group: {
        _id: "$Profile",
        count: { $sum: 1 },
        first_visit: { $min: "$VisitTime" },
        last_visit: { $max: "$VisitTime" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  log(
    `   Found ${profileDupes.length} profiles visited multiple times`,
    "cyan",
  );
  if (profileDupes.length > 0) {
    log("   Top 5 most visited profiles:", "yellow");
    for (const profile of profileDupes.slice(0, 5)) {
      const daysDiff = Math.floor(
        (profile.last_visit - profile.first_visit) / (1000 * 60 * 60 * 24),
      );
      console.log(
        `     - ${profile._id.substring(0, 50)}... (${profile.count} visits over ${daysDiff} days)`,
      );
    }
  }

  log("\n3. Same Person + Same Day Visits:", "yellow");
  const sameDayDupes = await Visit.aggregate([
    { $match: { Profile: { $ne: null, $ne: "" } } },
    {
      $addFields: {
        visitDate: {
          $dateToString: { format: "%Y-%m-%d", date: "$VisitTime" },
        },
      },
    },
    {
      $group: {
        _id: { profile: "$Profile", date: "$visitDate" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);
  log(
    `   Found ${sameDayDupes.length} cases of same person visited multiple times on same day`,
    sameDayDupes.length > 0 ? "red" : "green",
  );

  log("\n4. Event Key Coverage:", "yellow");
  const withKey = await Visit.countDocuments({ event_key: { $ne: null } });
  const withoutKey = total - withKey;
  log(
    `   With event_key: ${withKey} (${((withKey / total) * 100).toFixed(1)}%)`,
    "green",
  );
  log(
    `   Without event_key: ${withoutKey} (${((withoutKey / total) * 100).toFixed(1)}%)`,
    withoutKey > 0 ? "yellow" : "green",
  );

  return {
    total,
    eventKeyDupes: eventKeyDupes.length,
    profileDupes: profileDupes.length,
    sameDayDupes: sameDayDupes.length,
    withoutEventKey: withoutKey,
  };
}

/**
 * Analyze People collection for identity duplicates
 */
async function analyzePeople() {
  section("PEOPLE COLLECTION ANALYSIS");

  const db = mongoose.connection.db;
  const People = db.collection("people");

  const total = await People.countDocuments();
  log(`\nTotal people: ${total}`, "cyan");

  // 1. Duplicate canonical_ids (shouldn't exist - unique index)
  log("\n1. Duplicate Canonical IDs:", "yellow");
  const canonicalDupes = await People.aggregate([
    { $match: { canonical_id: { $ne: null } } },
    {
      $group: {
        _id: "$canonical_id",
        count: { $sum: 1 },
        docs: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  log(
    `   Found ${canonicalDupes.length} duplicate canonical_ids`,
    canonicalDupes.length > 0 ? "red" : "green",
  );

  // 2. Duplicate names
  log("\n2. Duplicate Full Names:", "yellow");
  const nameDupes = await People.aggregate([
    {
      $match: {
        "snapshot.first_name": { $ne: null },
        "snapshot.last_name": { $ne: null },
      },
    },
    {
      $group: {
        _id: {
          first: "$snapshot.first_name",
          last: "$snapshot.last_name",
        },
        count: { $sum: 1 },
        canonical_ids: { $addToSet: "$canonical_id" },
        aliases: { $push: "$aliases" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();
  log(`   Found ${nameDupes.length} duplicate name combinations`, "cyan");
  if (nameDupes.length > 0) {
    log("   Top 5 duplicate names:", "yellow");
    nameDupes.slice(0, 5).forEach((dup) => {
      console.log(
        `     - ${dup._id.first} ${dup._id.last} (${dup.count} records, ${dup.canonical_ids.length} unique IDs)`,
      );
    });
  }

  // 3. Overlapping aliases
  log("\n3. Overlapping Aliases (same person, different records):", "yellow");
  const aliasStats = await People.aggregate([
    { $match: { aliases: { $exists: true, $ne: [] } } },
    { $unwind: "$aliases" },
    {
      $group: {
        _id: {
          type: "$aliases.type",
          value: "$aliases.value",
        },
        count: { $sum: 1 },
        person_ids: { $addToSet: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();
  log(
    `   Found ${aliasStats.length} aliases pointing to multiple people`,
    aliasStats.length > 0 ? "red" : "green",
  );
  if (aliasStats.length > 0) {
    log("   Top 5 conflicting aliases:", "yellow");
    aliasStats.slice(0, 5).forEach((alias) => {
      console.log(
        `     - ${alias._id.type}: ${alias._id.value.substring(0, 40)}... (${alias.count} people)`,
      );
    });
  }

  // 4. Missing canonical_id
  log("\n4. Missing Canonical ID:", "yellow");
  const missingCanonical = await People.countDocuments({
    canonical_id: { $exists: false },
  });
  log(
    `   People without canonical_id: ${missingCanonical}`,
    missingCanonical > 0 ? "red" : "green",
  );

  return {
    total,
    canonicalDupes: canonicalDupes.length,
    nameDupes: nameDupes.length,
    aliasDupes: aliasStats.length,
    missingCanonical,
  };
}

/**
 * Analyze Companies collection
 */
async function analyzeCompanies() {
  section("COMPANIES COLLECTION ANALYSIS");

  const db = mongoose.connection.db;
  const Companies = db.collection("companies");

  const total = await Companies.countDocuments();
  log(`\nTotal companies: ${total}`, "cyan");

  if (total === 0) {
    log("   No companies to analyze", "yellow");
    return { total: 0 };
  }

  // Duplicate company names
  const nameDupes = await Companies.aggregate([
    { $match: { name: { $ne: null, $ne: "" } } },
    {
      $group: {
        _id: "$name",
        count: { $sum: 1 },
        canonical_ids: { $addToSet: "$canonical_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();

  log(
    `\nDuplicate Company Names: ${nameDupes.length} found`,
    nameDupes.length > 0 ? "yellow" : "green",
  );
  if (nameDupes.length > 0) {
    log("   Top 5:", "yellow");
    nameDupes.slice(0, 5).forEach((dup) => {
      console.log(`     - ${dup._id} (${dup.count} records)`);
    });
  }

  return {
    total,
    nameDupes: nameDupes.length,
  };
}

/**
 * Analyze Locations collection
 */
async function analyzeLocations() {
  section("LOCATIONS COLLECTION ANALYSIS");

  const db = mongoose.connection.db;
  const Locations = db.collection("locations");

  const total = await Locations.countDocuments();
  log(`\nTotal locations: ${total}`, "cyan");

  if (total === 0) {
    log("   No locations to analyze", "yellow");
    return { total: 0 };
  }

  // Duplicate location names
  const nameDupes = await Locations.aggregate([
    { $match: { name: { $ne: null, $ne: "" } } },
    {
      $group: {
        _id: "$name",
        count: { $sum: 1 },
        canonical_ids: { $addToSet: "$canonical_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();

  log(
    `\nDuplicate Location Names: ${nameDupes.length} found`,
    nameDupes.length > 0 ? "yellow" : "green",
  );
  if (nameDupes.length > 0) {
    log("   Top 5:", "yellow");
    nameDupes.slice(0, 5).forEach((dup) => {
      console.log(`     - ${dup._id} (${dup.count} records)`);
    });
  }

  return {
    total,
    nameDupes: nameDupes.length,
  };
}

/**
 * Main execution
 */
async function main() {
  log("\n" + "=".repeat(70), "bright");
  log("COMPREHENSIVE DUPLICATE ANALYSIS", "bright");
  log("DuxSoup ETL - All Collections", "bright");
  log("=".repeat(70) + "\n", "bright");

  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    log("Connected to MongoDB\n", "green");

    const results = {};

    // Analyze each collection
    results.scans = await analyzeScans();
    results.visits = await analyzeVisits();
    results.people = await analyzePeople();
    results.companies = await analyzeCompanies();
    results.locations = await analyzeLocations();

    // Final summary
    section("OVERALL SUMMARY");

    log("\nCollection Totals:", "cyan");
    log(`  Scans:     ${results.scans.total.toLocaleString()}`, "cyan");
    log(`  Visits:    ${results.visits.total.toLocaleString()}`, "cyan");
    log(`  People:    ${results.people.total.toLocaleString()}`, "cyan");
    log(`  Companies: ${results.companies.total.toLocaleString()}`, "cyan");
    log(`  Locations: ${results.locations.total.toLocaleString()}`, "cyan");

    log("\nDuplicate Issues Found:", "yellow");
    let totalIssues = 0;

    if (results.scans.eventKeyDupes > 0) {
      log(
        `  ⚠ Scans: ${results.scans.eventKeyDupes} event_key duplicates`,
        "red",
      );
      totalIssues += results.scans.eventKeyDupes;
    }
    if (results.scans.duxIdDupes > 0) {
      log(
        `  ⚠ Scans: ${results.scans.duxIdDupes} DuxSoup ID duplicates`,
        "red",
      );
      totalIssues += results.scans.duxIdDupes;
    }
    if (results.visits.eventKeyDupes > 0) {
      log(
        `  ⚠ Visits: ${results.visits.eventKeyDupes} event_key duplicates`,
        "red",
      );
      totalIssues += results.visits.eventKeyDupes;
    }
    if (results.people.canonicalDupes > 0) {
      log(
        `  ⚠ People: ${results.people.canonicalDupes} canonical_id duplicates`,
        "red",
      );
      totalIssues += results.people.canonicalDupes;
    }
    if (results.people.aliasDupes > 0) {
      log(
        `  ⚠ People: ${results.people.aliasDupes} overlapping aliases`,
        "red",
      );
      totalIssues += results.people.aliasDupes;
    }

    if (totalIssues === 0) {
      log("  ✓ No critical duplicate issues found!", "green");
    }

    log("\nData Quality Notes:", "yellow");
    if (results.scans.withoutEventKey > 0) {
      log(
        `  • ${results.scans.withoutEventKey} scans missing event_key (run backfill)`,
        "yellow",
      );
    }
    if (results.visits.withoutEventKey > 0) {
      log(
        `  • ${results.visits.withoutEventKey} visits missing event_key (run backfill)`,
        "yellow",
      );
    }
    if (results.scans.profileDupes > 0) {
      log(
        `  • ${results.scans.profileDupes} profiles scanned multiple times (expected behavior)`,
        "cyan",
      );
    }
    if (results.visits.profileDupes > 0) {
      log(
        `  • ${results.visits.profileDupes} profiles visited multiple times (expected behavior)`,
        "cyan",
      );
    }
    if (results.people.nameDupes > 0) {
      log(
        `  • ${results.people.nameDupes} duplicate names in people (may be different people)`,
        "cyan",
      );
    }

    log("\n" + "=".repeat(70) + "\n", "bright");
  } catch (error) {
    log(`\nError: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log("Disconnected from MongoDB\n", "green");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  analyzeScans,
  analyzeVisits,
  analyzePeople,
  analyzeCompanies,
  analyzeLocations,
};
