#!/usr/bin/env node

/**
 * Smart Scan Merge Script
 *
 * Merges duplicate scans using waterfall identity matching:
 * Priority 1: Sales Navigator ID (ACwAAA... or ACoAAA...)
 * Priority 2: DuxSoup ID (id.XXXXXXX)
 * Priority 3: Profile URL (linkedin.com/in/...)
 * Priority 4: PublicProfile
 * Priority 5: RecruiterProfile
 *
 * Strategy:
 * 1. Extract all identifiers from each scan
 * 2. Group scans by highest-priority matching identifier
 * 3. Merge duplicates, keeping most recent data
 * 4. Backup merged records before deletion
 *
 * Usage:
 *   node scripts/mergeScans.js --dry-run
 *   node scripts/mergeScans.js --execute
 */

const mongoose = require("mongoose");
require("dotenv").config();

const Scan = require("../src/models/scan");

// Color output
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
 * Extract LinkedIn username from various sources
 * Priority 1: Most stable identifier across Sales Nav and Regular LinkedIn
 *
 * Examples:
 * - Profile URL: "linkedin.com/in/bret-lamb-1424546/" → "bret-lamb-1424546"
 * - DuxSoup pid: "pid.bret-lamb-1424546" → "bret-lamb-1424546"
 *
 * IMPORTANT: Excludes Sales Navigator IDs (ACwAAA/ACoAAA patterns)
 * - "linkedin.com/in/ACwAAA-2MOoB..." → null (handled by extractSalesNavId)
 */
function extractLinkedInUsername(scan) {
  // Pattern to match LinkedIn usernames (alphanumeric, hyphens, underscores)
  const usernamePattern = /\/in\/([a-zA-Z0-9_-]+)\/?/;
  const pidPattern = /^pid\.([a-zA-Z0-9_-]+)$/;
  // Pattern to detect Sales Nav IDs (should NOT be treated as usernames)
  const salesNavIdPattern = /^A(Cw|Co)AAA/;

  /**
   * Helper to validate extracted username
   * Returns username if valid, null if it's actually a Sales Nav ID
   */
  function validateUsername(username) {
    if (!username) return null;
    // Reject if it's a Sales Navigator ID
    if (salesNavIdPattern.test(username)) {
      return null;
    }
    return username.toLowerCase();
  }

  // 1. Check DuxSoup ID for pid.username format
  if (scan.id) {
    const pidMatch = scan.id.match(pidPattern);
    if (pidMatch) {
      const username = validateUsername(pidMatch[1]);
      if (username) return username;
    }
  }

  // 2. Check Profile URL
  if (scan.Profile) {
    const match = scan.Profile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 3. Check PublicProfile
  if (scan.PublicProfile) {
    const match = scan.PublicProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 4. Check SalesProfile (rare, but possible)
  if (scan.SalesProfile) {
    const match = scan.SalesProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  // 5. Check RecruiterProfile
  if (scan.RecruiterProfile) {
    const match = scan.RecruiterProfile.match(usernamePattern);
    if (match) {
      const username = validateUsername(match[1]);
      if (username) return username;
    }
  }

  return null;
}

/**
 * Extract Sales Navigator ID from various fields
 */
function extractSalesNavId(scan) {
  // Sales Nav IDs start with ACwAAA or ACoAAA
  const salesNavPattern = /A(Cw|Co)AAA[A-Za-z0-9_-]+/;

  // Check SalesProfile URL
  if (scan.SalesProfile) {
    const match = scan.SalesProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check Profile URL (sometimes contains Sales Nav ID)
  if (scan.Profile) {
    const match = scan.Profile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check PublicProfile
  if (scan.PublicProfile) {
    const match = scan.PublicProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  // Check RecruiterProfile
  if (scan.RecruiterProfile) {
    const match = scan.RecruiterProfile.match(salesNavPattern);
    if (match) return match[0];
  }

  return null;
}

/**
 * Normalize Profile URL (remove trailing slashes, query params)
 */
function normalizeUrl(url) {
  if (!url) return null;
  try {
    let normalized = url.trim().toLowerCase();
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, "");
    // Remove query parameters
    normalized = normalized.split("?")[0];
    // Remove http/https differences
    normalized = normalized.replace(/^https?:\/\//, "");
    return normalized;
  } catch (e) {
    return url;
  }
}

/**
 * Extract all identifiers from a scan using waterfall priority
 */
function extractIdentifiers(scan) {
  const identifiers = {
    linkedInUsername: extractLinkedInUsername(scan),
    salesNavId: extractSalesNavId(scan),
    duxsoupId: scan.id || null,
    profileUrl: normalizeUrl(scan.Profile),
    publicProfile: normalizeUrl(scan.PublicProfile),
    recruiterProfile: normalizeUrl(scan.RecruiterProfile),
  };

  return identifiers;
}

/**
 * Get the primary identifier using waterfall approach
 * New Priority Order:
 * 1. LinkedIn Username (works across Sales Nav + Regular LinkedIn)
 * 2. Sales Navigator ID (stable, but only in Sales Nav)
 * 3. Normalized Profile URL (fallback for profiles without custom username)
 * 4. Public Profile / Recruiter Profile (rare)
 * 5. DuxSoup ID (last resort - changes between scan sources)
 */
function getPrimaryIdentifier(identifiers) {
  if (identifiers.linkedInUsername) {
    return { type: "linkedInUsername", value: identifiers.linkedInUsername };
  }
  if (identifiers.salesNavId) {
    return { type: "salesNavId", value: identifiers.salesNavId };
  }
  if (identifiers.profileUrl) {
    return { type: "profileUrl", value: identifiers.profileUrl };
  }
  if (identifiers.publicProfile) {
    return { type: "publicProfile", value: identifiers.publicProfile };
  }
  if (identifiers.recruiterProfile) {
    return { type: "recruiterProfile", value: identifiers.recruiterProfile };
  }
  if (identifiers.duxsoupId) {
    return { type: "duxsoupId", value: identifiers.duxsoupId };
  }
  return null;
}

/**
 * Phase 1: Analyze scans and group by identifier
 */
async function analyzeScans() {
  log("\n=== Phase 1: Analyzing Scans and Grouping by Identity ===", "bright");

  const scans = await Scan.find().lean();
  log(`Total scans: ${scans.length}`, "cyan");

  // Build identifier index
  const identifierGroups = new Map();
  const identifierStats = {
    linkedInUsername: 0,
    salesNavId: 0,
    profileUrl: 0,
    publicProfile: 0,
    recruiterProfile: 0,
    duxsoupId: 0,
    noIdentifier: 0,
  };

  for (const scan of scans) {
    const identifiers = extractIdentifiers(scan);
    const primary = getPrimaryIdentifier(identifiers);

    if (!primary) {
      identifierStats.noIdentifier++;
      continue;
    }

    // Track which identifier type was used
    identifierStats[primary.type]++;

    // Group scans by primary identifier
    const key = `${primary.type}:${primary.value}`;
    if (!identifierGroups.has(key)) {
      identifierGroups.set(key, []);
    }
    identifierGroups.get(key).push({
      _id: scan._id,
      scanTime: scan.ScanTime,
      createdAt: scan.createdAt,
      identifiers,
      scan,
    });
  }

  // Find groups with duplicates
  const duplicateGroups = [];
  for (const [key, group] of identifierGroups) {
    if (group.length > 1) {
      // Sort by ScanTime (most recent first)
      group.sort((a, b) => {
        const timeA = a.scanTime || a.createdAt || new Date(0);
        const timeB = b.scanTime || b.createdAt || new Date(0);
        return timeB - timeA;
      });

      duplicateGroups.push({
        identifier: key,
        count: group.length,
        scans: group,
      });
    }
  }

  // Sort duplicate groups by count (largest first)
  duplicateGroups.sort((a, b) => b.count - a.count);

  // Report
  log("\nIdentifier Usage (Primary identifier used for matching):", "yellow");
  log(
    `  LinkedIn Username: ${identifierStats.linkedInUsername} (${((identifierStats.linkedInUsername / scans.length) * 100).toFixed(1)}%)`,
    identifierStats.linkedInUsername > 0 ? "green" : "cyan",
  );
  log(
    `  Sales Navigator ID: ${identifierStats.salesNavId} (${((identifierStats.salesNavId / scans.length) * 100).toFixed(1)}%)`,
    "cyan",
  );
  log(
    `  Profile URL: ${identifierStats.profileUrl} (${((identifierStats.profileUrl / scans.length) * 100).toFixed(1)}%)`,
    "cyan",
  );
  log(
    `  Public Profile: ${identifierStats.publicProfile} (${((identifierStats.publicProfile / scans.length) * 100).toFixed(1)}%)`,
    "cyan",
  );
  log(
    `  Recruiter Profile: ${identifierStats.recruiterProfile} (${((identifierStats.recruiterProfile / scans.length) * 100).toFixed(1)}%)`,
    "cyan",
  );
  log(
    `  DuxSoup ID: ${identifierStats.duxsoupId} (${((identifierStats.duxsoupId / scans.length) * 100).toFixed(1)}%)`,
    "cyan",
  );
  log(
    `  No Identifier: ${identifierStats.noIdentifier}`,
    identifierStats.noIdentifier > 0 ? "red" : "green",
  );

  log("\nDuplicate Analysis:", "yellow");
  log(`  Unique people: ${identifierGroups.size}`, "green");
  log(`  Duplicate groups: ${duplicateGroups.length}`, "yellow");

  const totalDuplicateScans = duplicateGroups.reduce(
    (sum, group) => sum + (group.count - 1),
    0,
  );
  log(`  Total duplicate scans to merge: ${totalDuplicateScans}`, "yellow");

  if (duplicateGroups.length > 0) {
    log("\n  Top 10 most duplicated people:", "yellow");
    for (const group of duplicateGroups.slice(0, 10)) {
      const [type, value] = group.identifier.split(":");
      const displayValue =
        value.length > 50 ? value.substring(0, 50) + "..." : value;
      const oldest = group.scans[group.scans.length - 1];
      const newest = group.scans[0];
      const daysDiff = Math.floor(
        (newest.scanTime - oldest.scanTime) / (1000 * 60 * 60 * 24),
      );

      log(`    - ${type}: ${displayValue}`, "cyan");
      log(
        `      ${group.count} scans over ${daysDiff} days (${oldest.scanTime?.toISOString().split("T")[0]} to ${newest.scanTime?.toISOString().split("T")[0]})`,
        "cyan",
      );
    }
  }

  return {
    totalScans: scans.length,
    uniquePeople: identifierGroups.size,
    duplicateGroups,
    identifierStats,
  };
}

/**
 * Merge two scan objects, keeping most recent non-null values
 * Strategy: Start with newest scan (base), backfill missing fields from older scans
 * NEVER overwrite existing data with blank/null values
 */
function mergeScans(base, other) {
  const merged = { ...base };

  // Simple fields: ONLY update if base is missing the field AND other has it
  const simpleFields = [
    "Profile",
    "SalesProfile",
    "RecruiterProfile",
    "PublicProfile",
    "First Name",
    "Last Name",
    "Middle Name",
    "Company",
    "CompanyID",
    "Title",
    "Location",
    "Industry",
    "Connection Degree",
    "Degree",
    "Picture",
    "Connections",
    "Summary",
  ];

  for (const field of simpleFields) {
    // Only fill in if base is missing this field (null/undefined/empty)
    const baseIsEmpty =
      merged[field] === null ||
      merged[field] === undefined ||
      merged[field] === "";
    const otherHasValue =
      other[field] !== null &&
      other[field] !== undefined &&
      other[field] !== "";

    if (baseIsEmpty && otherHasValue) {
      merged[field] = other[field];
    }
  }

  // Extended data: ONLY fill if base is missing it
  const baseHasExtended =
    merged.extended && Object.keys(merged.extended).length > 0;
  const otherHasExtended =
    other.extended && Object.keys(other.extended).length > 0;

  if (!baseHasExtended && otherHasExtended) {
    merged.extended = other.extended;
  }

  // My Notes: combine if different
  if (other["My Notes"] && other["My Notes"] !== merged["My Notes"]) {
    if (Array.isArray(merged["My Notes"])) {
      merged["My Notes"].push(other["My Notes"]);
    } else if (merged["My Notes"]) {
      merged["My Notes"] = [merged["My Notes"], other["My Notes"]];
    } else {
      merged["My Notes"] = other["My Notes"];
    }
  }

  // My Tags: merge arrays (combine unique values)
  if (other["My Tags"] && Array.isArray(other["My Tags"])) {
    if (Array.isArray(merged["My Tags"])) {
      merged["My Tags"] = [
        ...new Set([...merged["My Tags"], ...other["My Tags"]]),
      ];
    } else {
      merged["My Tags"] = other["My Tags"];
    }
  }

  // ScanTime: Keep from base (base is already the most recent)
  // No need to update from older scans

  // rawData: ONLY fill if base is missing it
  if (!merged.rawData && other.rawData) {
    merged.rawData = other.rawData;
  }

  return merged;
}

/**
 * Phase 2: Perform merge
 */
async function performMerge(duplicateGroups, dryRun = true) {
  log(
    `\n=== Phase 2: ${dryRun ? "Simulating" : "Performing"} Merge ===`,
    "bright",
  );

  if (duplicateGroups.length === 0) {
    log("No duplicates to merge", "green");
    return { merged: 0, kept: 0 };
  }

  let mergedCount = 0;
  let keptCount = 0;
  const backupCollection = "scans_merge_backup";

  if (!dryRun) {
    log(`Backing up merged scans to: ${backupCollection}`, "cyan");
  }

  for (const group of duplicateGroups) {
    const [identifierType, identifierValue] = group.identifier.split(":");

    // Base record (most recent)
    const baseRecord = group.scans[0].scan;
    const toMerge = group.scans.slice(1); // All others

    if (dryRun) {
      log(
        `[DRY RUN] Would merge ${toMerge.length} scans into base ${baseRecord._id}`,
        "blue",
      );
      log(
        `  Identifier: ${identifierType} = ${identifierValue.substring(0, 40)}...`,
        "blue",
      );
    } else {
      // Merge all scans into base
      let mergedData = baseRecord;
      for (const item of toMerge) {
        mergedData = mergeScans(mergedData, item.scan);
      }

      // Update base record with merged data
      await Scan.updateOne({ _id: baseRecord._id }, { $set: mergedData });

      // Backup and delete merged scans
      for (const item of toMerge) {
        // Backup
        await mongoose.connection.db.collection(backupCollection).insertOne({
          ...item.scan,
          _merge_reason: "duplicate_identity",
          _merge_date: new Date(),
          _merged_into: baseRecord._id,
          _identifier_type: identifierType,
          _identifier_value: identifierValue,
        });

        // Delete
        await Scan.deleteOne({ _id: item.scan._id });
        mergedCount++;
      }

      keptCount++;

      if (keptCount % 100 === 0) {
        log(
          `Processed ${keptCount} groups (${mergedCount} scans merged)...`,
          "cyan",
        );
      }
    }
  }

  log("\nMerge Summary:", "bright");
  log(`  Groups processed: ${duplicateGroups.length}`, "cyan");
  log(
    `  Base records kept: ${dryRun ? duplicateGroups.length : keptCount}`,
    "green",
  );
  log(
    `  Duplicate scans merged: ${dryRun ? duplicateGroups.reduce((sum, g) => sum + (g.count - 1), 0) : mergedCount}`,
    "yellow",
  );

  if (!dryRun) {
    log(`  Backup location: ${backupCollection}`, "cyan");
  }

  return { merged: mergedCount, kept: keptCount };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--execute");

  log("\n" + "=".repeat(70), "bright");
  log("SMART SCAN MERGE SCRIPT", "bright");
  log("Waterfall Identity Matching", "bright");
  log("=".repeat(70), "bright");
  log(`Mode: ${dryRun ? "DRY RUN" : "EXECUTE"}`, dryRun ? "yellow" : "red");
  log("=".repeat(70) + "\n", "bright");

  if (dryRun) {
    log("Running in DRY RUN mode - no changes will be made", "yellow");
    log("Use --execute to actually perform merge\n", "yellow");
  } else {
    log("WARNING: Running in EXECUTE mode - changes will be made!", "red");
    log("Merged scans will be backed up before removal\n", "red");
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    log("Connected to MongoDB\n", "green");

    // Phase 1: Analyze
    const analysis = await analyzeScans();

    // Phase 2: Merge
    const mergeResults = await performMerge(analysis.duplicateGroups, dryRun);

    // Summary
    log("\n" + "=".repeat(70), "bright");
    log("FINAL SUMMARY", "bright");
    log("=".repeat(70), "bright");
    log(`Original scans: ${analysis.totalScans.toLocaleString()}`, "cyan");
    log(`Unique people: ${analysis.uniquePeople.toLocaleString()}`, "cyan");
    log(
      `Duplicate groups: ${analysis.duplicateGroups.length.toLocaleString()}`,
      "yellow",
    );
    log(
      `Scans after merge: ${(analysis.totalScans - (dryRun ? analysis.duplicateGroups.reduce((sum, g) => sum + (g.count - 1), 0) : mergeResults.merged)).toLocaleString()}`,
      "green",
    );
    log("=".repeat(70) + "\n", "bright");

    if (dryRun) {
      log("This was a DRY RUN - no changes were made", "yellow");
      log("Run with --execute to actually perform merge", "yellow");
    } else {
      log("Merge complete!", "green");
      log("Backup collection: scans_merge_backup", "cyan");
    }
  } catch (error) {
    log(`\nError: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log("\nDisconnected from MongoDB\n", "green");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  extractIdentifiers,
  getPrimaryIdentifier,
  mergeScans,
  analyzeScans,
  performMerge,
};
