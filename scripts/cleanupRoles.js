#!/usr/bin/env node

/**
 * Role Cleanup Script
 *
 * Fixes three data quality issues in existing Person records:
 *
 *   1. Duplicate roles from corrupted 2001 dates
 *      - Scan data sometimes produces start dates in 2000-2002 by parsing
 *        relative date strings without a reference year.
 *      - Merges duplicates: keeps the role with the real date, discards the
 *        corrupted-date copy.
 *
 *   2. Stale isCurrent flags
 *      - Old roles from past companies stuck as isCurrent: true because no
 *        lifecycle management flipped them when newer observations arrived.
 *      - Detects roles that ended (have an endDate or a newer role at a
 *        different company) and flips isCurrent to false.
 *
 *   3. Missing/incorrect seniority on roles
 *      - Re-parses every role title with the updated titleParser (which now
 *        recognizes RVP, Regional Vice President, etc.).
 *      - Updates seniority + seniorityRank on each role.
 *
 *   After all three fixes, recomputes derived metrics (avgTenureMonths,
 *   yearsAtCurrentCompany, highestSeniority, etc.).
 *
 * Usage:
 *   node scripts/cleanupRoles.js [options]
 *
 * Options:
 *   --dry-run            Preview changes without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N people (default: 0 = unlimited)
 *   --skip=N             Skip first N people (for resuming)
 *   --verbose            Log every individual change
 *   --id=VALUE           Process a single person by _id
 *
 * Examples:
 *   node scripts/cleanupRoles.js --dry-run
 *   node scripts/cleanupRoles.js --dry-run --id=mike-hare --verbose
 *   node scripts/cleanupRoles.js --commit --limit=500
 *   node scripts/cleanupRoles.js --commit
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const logger = require("../src/utils/logger");
const {
  parseTitle,
  getHighestSeniorityRole,
} = require("../src/utils/titleParser");
const { parseSafeDate } = require("../src/utils/date-parser");

// --- CLI args ---

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 0,
    skip: 0,
    verbose: false,
    id: null,
  };

  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") {
      args.dryRun = false;
      args.commit = true;
    } else if (key === "limit") args.limit = parseInt(value, 10);
    else if (key === "skip") args.skip = parseInt(value, 10);
    else if (key === "id") args.id = value;
    else if (key === "verbose") args.verbose = true;
  });

  return args;
}

// --- Helpers ---

/**
 * Detect whether a date looks like a corrupted/fabricated date.
 * Scan data sometimes produces dates in 2000-2002 when parsing
 * relative date strings without a reference year.
 */
function isLikelyCorruptedDate(date) {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2000 && year <= 2002;
}

/**
 * Normalize role text for comparison (lowercase, collapse whitespace).
 */
function normalizeRoleText(text) {
  if (text == null) return "";
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

// --- Step 1: Deduplicate roles with corrupted dates ---

/**
 * Given a roles array, find and merge duplicates where:
 * - Same title + company (case-insensitive)
 * - One copy has a corrupted date (2000-2002), the other has a real date
 *
 * Keeps the copy with the real date and merges any non-empty fields
 * from the corrupted copy into it.
 *
 * @param {Array} roles - Mutable roles array
 * @returns {{ deduped: Array, removedCount: number }}
 */
function deduplicateCorruptedDateRoles(roles) {
  if (!roles || roles.length === 0) return { deduped: roles, removedCount: 0 };

  // Group roles by normalized title+company
  const groups = new Map();
  for (const role of roles) {
    const key = `${normalizeRoleText(role.title)}||${normalizeRoleText(role.companyName)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(role);
  }

  const deduped = [];
  let removedCount = 0;

  for (const [, group] of groups) {
    if (group.length <= 1) {
      deduped.push(...group);
      continue;
    }

    // Separate corrupted vs real dated roles
    const corrupted = group.filter(
      (r) => r.startDate && isLikelyCorruptedDate(r.startDate),
    );
    const real = group.filter(
      (r) => !r.startDate || !isLikelyCorruptedDate(r.startDate),
    );

    if (corrupted.length === 0) {
      // No corrupted dates — keep all (they may be genuinely different roles)
      deduped.push(...group);
      continue;
    }

    if (real.length === 0) {
      // All copies have corrupted dates — keep only one (the first)
      deduped.push(corrupted[0]);
      removedCount += corrupted.length - 1;
      continue;
    }

    // Keep real roles, merge fields from corrupted copies into their
    // best-matching real counterpart (same title+company, closest dates)
    deduped.push(...real);
    removedCount += corrupted.length;

    // Backfill: for each corrupted role, merge non-empty fields into
    // the first real role that lacks them
    for (const corruptedRole of corrupted) {
      const target = real[0];
      for (const field of ["location", "description", "companyId"]) {
        if (
          corruptedRole[field] &&
          corruptedRole[field] !== "" &&
          (target[field] == null || target[field] === "")
        ) {
          target[field] = corruptedRole[field];
        }
      }
    }
  }

  return { deduped, removedCount };
}

// --- Step 2: Fix stale isCurrent flags ---

/**
 * Identify roles that should no longer be isCurrent and flip them.
 *
 * Logic:
 * - If a role has isCurrent: true AND has an endDate, flip to false
 * - If multiple roles at different companies are all isCurrent: true,
 *   keep only the one with the latest startDate as current
 *
 * @param {Array} roles - Mutable roles array
 * @returns {number} Number of roles flipped
 */
function fixStaleIsCurrentFlags(roles) {
  if (!roles || roles.length === 0) return 0;

  let flipped = 0;

  // Pass 1: Any role with an endDate should not be isCurrent
  for (const role of roles) {
    if (role.isCurrent && role.endDate) {
      role.isCurrent = false;
      flipped++;
    }
  }

  // Pass 2: Among remaining isCurrent roles, if there are multiple at
  // different companies, keep only the most recent one as current
  const currentRoles = roles.filter((r) => r.isCurrent);
  if (currentRoles.length > 1) {
    // Sort by startDate descending (most recent first); undated roles last
    currentRoles.sort((a, b) => {
      const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
      return bDate - aDate;
    });

    // The first entry is the most recent current role — keep it.
    // Group the rest by company to determine which to flip.
    const keepCompany = normalizeRoleText(currentRoles[0].companyName);

    for (let i = 1; i < currentRoles.length; i++) {
      const roleCompany = normalizeRoleText(currentRoles[i].companyName);
      // If it's at a different company from the most recent role, flip it
      if (roleCompany !== keepCompany) {
        currentRoles[i].isCurrent = false;
        flipped++;
      }
    }
  }

  return flipped;
}

// --- Step 3: Re-parse seniority on all roles ---

/**
 * Re-parse seniority and seniorityRank for every role using the
 * updated titleParser (which now recognizes RVP, etc.).
 *
 * @param {Array} roles - Mutable roles array
 * @returns {number} Number of roles with changed seniority
 */
function reParseSeniority(roles) {
  if (!roles || roles.length === 0) return 0;

  let changed = 0;

  for (const role of roles) {
    if (!role.title) continue;
    const parsed = parseTitle(role.title);
    if (
      role.seniority !== parsed.seniority ||
      role.seniorityRank !== parsed.seniorityRank
    ) {
      role.seniority = parsed.seniority;
      role.seniorityRank = parsed.seniorityRank;
      changed++;
    }
  }

  return changed;
}

// --- Derived metrics recomputation ---

/**
 * Compute derived metrics from the cleaned roles array.
 * Standalone version that works on plain objects (not Mongoose docs).
 */
function computeDerivedMetrics(roles) {
  if (!roles || roles.length === 0) {
    return {
      avgTenureMonths: null,
      yearsAtCurrentCompany: null,
      highestSeniority: null,
      highestSeniorityRank: null,
      highestSeniorityRoleTitle: null,
      highestSeniorityRoleCompany: null,
    };
  }

  const now = new Date();
  let totalTenureMonths = 0;
  let roleCount = 0;
  let currentCompanyYears = null;

  roles.forEach((role) => {
    const startDate = parseSafeDate(role.startDate);
    const endDate = role.endDate
      ? parseSafeDate(role.endDate)
      : role.isCurrent
        ? now
        : null;

    if (startDate && endDate) {
      const tenureMonths =
        (endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44);
      totalTenureMonths += tenureMonths;
      roleCount++;

      if (role.isCurrent) {
        const years = (now - startDate) / (1000 * 60 * 60 * 24 * 365.25);
        if (currentCompanyYears === null || years > currentCompanyYears) {
          currentCompanyYears = years;
        }
      }
    }
  });

  const highestRole = getHighestSeniorityRole(roles);

  return {
    avgTenureMonths:
      roleCount > 0 ? Math.round(totalTenureMonths / roleCount) : null,
    yearsAtCurrentCompany:
      currentCompanyYears !== null
        ? Math.round(currentCompanyYears * 10) / 10
        : null,
    highestSeniority: highestRole?.seniority || null,
    highestSeniorityRank: highestRole?.seniorityRank || null,
    highestSeniorityRoleTitle: highestRole?.title || null,
    highestSeniorityRoleCompany: highestRole?.companyName || null,
  };
}

// --- Main ---

async function cleanupRoles(args) {
  console.log("Starting role cleanup...");
  console.log("Options:", {
    dryRun: args.dryRun,
    limit: args.limit || "unlimited",
    skip: args.skip,
    id: args.id || "(all)",
    verbose: args.verbose,
  });
  console.log("");

  if (args.dryRun) {
    console.log("DRY RUN MODE - No changes will be made");
    console.log("Use --commit to execute updates\n");
  }

  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    duplicatesRemoved: 0,
    isCurrentFlipped: 0,
    seniorityChanged: 0,
    derivedRecalculated: 0,
  };

  const startTime = Date.now();

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log("Connected to MongoDB\n");

    // Build query
    // Exclude merged records (field defaults to null, so check for both)
    const query = { $or: [{ mergedInto: null }, { mergedInto: { $exists: false } }] };
    if (args.id) {
      query._id = args.id;
    }

    // Only process people who actually have roles
    query["snapshot.roles.0"] = { $exists: true };

    const totalCount = await Person.countDocuments(query);
    const effectiveLimit =
      args.limit > 0
        ? Math.min(args.limit, totalCount - args.skip)
        : totalCount - args.skip;
    console.log(`Eligible person records: ${totalCount}`);
    console.log(`Processing: ${effectiveLimit} (skip=${args.skip})\n`);

    // Cursor-based iteration for memory efficiency
    let cursor = Person.find(query)
      .sort({ _id: 1 })
      .skip(args.skip)
      .lean();

    if (args.limit > 0) {
      cursor = cursor.limit(args.limit);
    }

    const cursorStream = cursor.cursor();

    for (
      let doc = await cursorStream.next();
      doc != null;
      doc = await cursorStream.next()
    ) {
      stats.processed++;

      try {
        const roles = doc.snapshot?.roles || [];
        if (roles.length === 0) {
          stats.skipped++;
          continue;
        }

        let personChanged = false;
        const changes = {};

        // Step 1: Deduplicate corrupted-date roles
        const { deduped, removedCount } =
          deduplicateCorruptedDateRoles(roles);
        if (removedCount > 0) {
          stats.duplicatesRemoved += removedCount;
          personChanged = true;
          if (args.verbose) {
            console.log(
              `  ${doc._id}: removed ${removedCount} duplicate role(s) with corrupted dates`,
            );
          }
        }

        // Step 2: Fix stale isCurrent flags (on deduped array)
        const flipped = fixStaleIsCurrentFlags(deduped);
        if (flipped > 0) {
          stats.isCurrentFlipped += flipped;
          personChanged = true;
          if (args.verbose) {
            console.log(
              `  ${doc._id}: flipped ${flipped} stale isCurrent flag(s)`,
            );
          }
        }

        // Step 3: Re-parse seniority with updated titleParser
        const seniorityChanged = reParseSeniority(deduped);
        if (seniorityChanged > 0) {
          stats.seniorityChanged += seniorityChanged;
          personChanged = true;
          if (args.verbose) {
            console.log(
              `  ${doc._id}: updated seniority on ${seniorityChanged} role(s)`,
            );
          }
        }

        if (!personChanged) {
          stats.skipped++;
          continue;
        }

        // Set cleaned roles
        changes["snapshot.roles"] = deduped;

        // Recompute derived metrics from cleaned roles
        const derived = computeDerivedMetrics(deduped);
        const derivedFields = [
          "avgTenureMonths",
          "yearsAtCurrentCompany",
          "highestSeniority",
          "highestSeniorityRank",
          "highestSeniorityRoleTitle",
          "highestSeniorityRoleCompany",
        ];

        let derivedChanged = false;
        for (const field of derivedFields) {
          const current = doc.derived?.[field] ?? null;
          const updated = derived[field] ?? null;
          if (current !== updated) {
            changes[`derived.${field}`] = updated;
            derivedChanged = true;
          }
        }
        if (derivedChanged) {
          stats.derivedRecalculated++;
          if (args.verbose) {
            console.log(`  ${doc._id}: derived metrics recalculated`);
            for (const field of derivedFields) {
              const current = doc.derived?.[field] ?? null;
              const updated = derived[field] ?? null;
              if (current !== updated) {
                console.log(
                  `    ${field}: ${current} -> ${updated}`,
                );
              }
            }
          }
        }

        // Apply changes
        if (!args.dryRun) {
          await Person.updateOne({ _id: doc._id }, { $set: changes });
        }

        stats.updated++;
      } catch (error) {
        stats.errors++;
        logger.error("Failed to clean up roles for person", {
          person_id: doc._id,
          error: error.message,
        });
        if (args.verbose) {
          console.error(`  ERROR on ${doc._id}: ${error.message}`);
        }
      }

      // Progress reporting
      if (stats.processed % 500 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = Math.round(stats.processed / (elapsed || 1));
        console.log(
          `  Progress: ${stats.processed}/${effectiveLimit} ` +
            `(${stats.updated} updated, ${stats.skipped} skipped) ` +
            `[${elapsed}s, ${rate}/sec]`,
        );
      }
    }

    await cursorStream.close();

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const throughput = Math.round(stats.processed / (elapsedSeconds || 1));

    console.log("\nRole cleanup complete!");
    console.log("Statistics:");
    console.log(`  Processed:             ${stats.processed}`);
    console.log(`  Updated:               ${stats.updated}`);
    console.log(`  Skipped:               ${stats.skipped} (no changes needed)`);
    console.log(`  Errors:                ${stats.errors}`);
    console.log(`  Duplicate roles removed: ${stats.duplicatesRemoved}`);
    console.log(`  isCurrent flags flipped: ${stats.isCurrentFlipped}`);
    console.log(`  Seniority re-parsed:     ${stats.seniorityChanged}`);
    console.log(`  Derived recalculated:    ${stats.derivedRecalculated}`);
    console.log(`  Elapsed:               ${elapsedSeconds}s`);
    console.log(`  Throughput:            ${throughput} records/sec`);

    if (args.dryRun && stats.updated > 0) {
      console.log(`\nRe-run with --commit to apply ${stats.updated} updates`);
    }

    await mongoose.connection.close();
    return stats;
  } catch (error) {
    console.error("Fatal error:", error.message);
    logger.error("Role cleanup failed", {
      error: error.message,
      stack: error.stack,
    });
    await mongoose.connection.close();
    throw error;
  }
}

// Export for testing
module.exports = {
  cleanupRoles,
  parseArgs,
  deduplicateCorruptedDateRoles,
  fixStaleIsCurrentFlags,
  reParseSeniority,
  computeDerivedMetrics,
  isLikelyCorruptedDate,
  normalizeRoleText,
};

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
Role Cleanup Script

Fixes three data quality issues in existing Person records:
  1. Duplicate roles from corrupted 2001 dates (merges duplicates)
  2. Stale isCurrent flags (flips ended roles to false)
  3. Missing/incorrect seniority (re-parses with updated titleParser)

Then recomputes derived metrics (tenure, highest seniority, etc.).

Usage: node scripts/cleanupRoles.js [options]

Options:
  --dry-run            Preview changes without saving (default)
  --commit             Execute updates (required to make changes)
  --limit=N            Limit to N people (default: 0 = unlimited)
  --skip=N             Skip first N people (for resuming)
  --verbose            Log every individual change
  --id=VALUE           Process a single person by _id
  --help, -h           Show this help message

Examples:
  node scripts/cleanupRoles.js --dry-run
  node scripts/cleanupRoles.js --dry-run --id=mike-hare --verbose
  node scripts/cleanupRoles.js --commit --limit=500
  node scripts/cleanupRoles.js --commit
    `);
    process.exit(0);
  }

  cleanupRoles(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
