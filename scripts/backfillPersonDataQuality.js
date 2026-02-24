#!/usr/bin/env node

/**
 * Comprehensive Person Data Quality Backfill
 *
 * Applies ALL recent data quality improvements to existing person records
 * in a single pass. This script addresses the gap where improvements were
 * added to the ingestion pipeline but never backfilled to existing records.
 *
 * Improvements applied:
 *   1. Whitespace trimming/collapsing on snapshot string fields
 *   2. Email normalization (lowercase + trim)
 *   3. Phone normalization (E.164 format)
 *   4. Case-insensitive skill deduplication
 *   5. Case-insensitive education deduplication
 *   6. Structured location parsing (city, state, country, etc.)
 *   7. US region/subregion/timezone categorization
 *   8. Seniority and department parsing from currentTitle
 *   9. Derived metrics recomputation (tenure, highest seniority)
 *
 * Usage:
 *   node scripts/backfillPersonDataQuality.js [options]
 *
 * Options:
 *   --dry-run            Preview changes without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N people (default: 0 = unlimited)
 *   --batch-size=N       Process N people per batch (default: 100)
 *   --skip=N             Skip first N people (for resuming)
 *   --only=STEP          Run only a specific step (whitespace|email|phone|skills|education|location|seniority|derived)
 *   --verbose            Log every individual field change
 *
 * Examples:
 *   node scripts/backfillPersonDataQuality.js --dry-run
 *   node scripts/backfillPersonDataQuality.js --commit --limit=500
 *   node scripts/backfillPersonDataQuality.js --commit --only=whitespace
 *   node scripts/backfillPersonDataQuality.js --commit --skip=1000 --limit=1000
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const logger = require("../src/utils/logger");
const { parseLocation } = require("../src/utils/location-parser");
const { parseTitle, getHighestSeniorityRole } = require("../src/utils/titleParser");
const { normalizePhone } = require("../src/utils/phoneNormalizer");
const { parseSafeDate } = require("../src/utils/date-parser");

// --- Helpers (copied from personController to avoid coupling to Mongoose context) ---

function cleanString(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  return value.trim().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim().toLowerCase();
  if (str === "") return null;
  return str;
}

/**
 * Compute derived metrics from roles timeline.
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

// Fields that should have cleanString() applied
const CLEANABLE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "fullName",
  "currentTitle",
  "currentCompany",
  "location",
  "industry",
  "summary",
  "twitter",
];

// Location sub-fields from parseLocation()
const LOCATION_FIELDS = [
  "city",
  "state",
  "stateCode",
  "country",
  "countryCode",
  "province",
  "region",
  "locationType",
  "usRegion",
  "usSubregion",
  "timezone",
  "utcOffset",
];

// --- CLI args ---

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 0,
    batchSize: 100,
    skip: 0,
    only: null,
    verbose: false,
  };

  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace("--", "").split("=");
    if (key === "dry-run") args.dryRun = true;
    else if (key === "commit") {
      args.dryRun = false;
      args.commit = true;
    } else if (key === "limit") args.limit = parseInt(value, 10);
    else if (key === "batch-size") args.batchSize = parseInt(value, 10);
    else if (key === "skip") args.skip = parseInt(value, 10);
    else if (key === "only") args.only = value;
    else if (key === "verbose") args.verbose = true;
  });

  return args;
}

// --- Step implementations ---

/**
 * Step 1: Trim and collapse whitespace on snapshot string fields + role fields
 */
function applyWhitespaceCleaning(snapshot, changes) {
  for (const field of CLEANABLE_FIELDS) {
    const original = snapshot[field];
    if (typeof original !== "string") continue;

    const cleaned = cleanString(original);
    if (cleaned !== original) {
      changes[`snapshot.${field}`] = cleaned;
      if (snapshot._meta?.[field]) {
        changes[`snapshot._meta.${field}.value`] = cleaned;
      }
    }
  }

  // Clean role sub-fields
  if (Array.isArray(snapshot.roles)) {
    let rolesChanged = false;
    const cleanedRoles = snapshot.roles.map((role) => {
      const cleanedRole = { ...role };
      for (const roleField of ["title", "companyName", "location", "description"]) {
        if (typeof cleanedRole[roleField] === "string") {
          const cleaned = cleanString(cleanedRole[roleField]);
          if (cleaned !== cleanedRole[roleField]) {
            cleanedRole[roleField] = cleaned;
            rolesChanged = true;
          }
        }
      }
      return cleanedRole;
    });
    if (rolesChanged) {
      changes["snapshot.roles"] = cleanedRoles;
    }
  }
}

/**
 * Step 2: Normalize email
 */
function applyEmailNormalization(snapshot, changes) {
  const original = snapshot.email;
  if (!original || typeof original !== "string") return;

  const normalized = normalizeEmail(original);
  if (normalized !== original) {
    changes["snapshot.email"] = normalized;
    if (snapshot._meta?.email) {
      changes["snapshot._meta.email.value"] = normalized;
    }
  }
}

/**
 * Step 3: Normalize phone to E.164
 */
function applyPhoneNormalization(snapshot, changes) {
  const original = snapshot.phone;
  if (!original || typeof original !== "string") return;

  const defaultCountry = snapshot.countryCode || undefined;
  const normalized = normalizePhone(original, defaultCountry);

  if (normalized && normalized !== original) {
    changes["snapshot.phone"] = normalized;
    if (snapshot._meta?.phone) {
      changes["snapshot._meta.phone.value"] = normalized;
    }
  }
}

/**
 * Step 4: Deduplicate skills (case-insensitive)
 */
function applySkillDeduplication(snapshot, changes) {
  if (!Array.isArray(snapshot.skills) || snapshot.skills.length === 0) return;

  const seen = new Set();
  const deduped = [];

  for (const skill of snapshot.skills) {
    const cleaned = cleanString(skill);
    if (!cleaned) continue;
    const normalized = cleaned.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(cleaned);
    }
  }

  if (deduped.length !== snapshot.skills.length) {
    changes["snapshot.skills"] = deduped;
  }
}

/**
 * Step 5: Deduplicate education (case-insensitive)
 */
function applyEducationDeduplication(snapshot, changes) {
  if (!Array.isArray(snapshot.education) || snapshot.education.length === 0) return;

  const seen = new Set();
  const deduped = [];

  for (const edu of snapshot.education) {
    const key = [
      edu.school?.toLowerCase()?.trim(),
      edu.degree?.toLowerCase()?.trim(),
      edu.field?.toLowerCase()?.trim(),
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(edu);
    }
  }

  if (deduped.length !== snapshot.education.length) {
    changes["snapshot.education"] = deduped;
  }
}

/**
 * Step 6: Parse structured location fields + US region enrichment
 */
function applyLocationParsing(snapshot, changes) {
  const rawLocation = snapshot.location;
  if (!rawLocation || typeof rawLocation !== "string") return;

  const parsed = parseLocation(rawLocation);

  // Only update fields that are currently missing or null
  for (const field of LOCATION_FIELDS) {
    if (parsed[field] != null && snapshot[field] == null) {
      changes[`snapshot.${field}`] = parsed[field];
    }
  }
}

/**
 * Step 7: Parse seniority and department from currentTitle
 */
function applySeniorityParsing(snapshot, changes) {
  const title = snapshot.currentTitle;
  if (!title || typeof title !== "string") return;

  const parsed = parseTitle(title);

  if (parsed.seniority && snapshot.parsedSeniority !== parsed.seniority) {
    changes["snapshot.parsedSeniority"] = parsed.seniority;
  }
  if (parsed.department && snapshot.parsedDepartment !== parsed.department) {
    changes["snapshot.parsedDepartment"] = parsed.department;
  }

  // Clear stale derived fields when title no longer produces a result
  if (!parsed.seniority && snapshot.parsedSeniority) {
    changes["snapshot.parsedSeniority"] = null;
  }
  if (!parsed.department && snapshot.parsedDepartment) {
    changes["snapshot.parsedDepartment"] = null;
  }
}

/**
 * Step 8: Recompute derived metrics from roles
 */
function applyDerivedMetrics(snapshot, changes, currentDerived) {
  const roles = snapshot.roles;
  if (!Array.isArray(roles) || roles.length === 0) return;

  const computed = computeDerivedMetrics(roles);

  // Check for any differences
  const derivedFields = [
    "avgTenureMonths",
    "yearsAtCurrentCompany",
    "highestSeniority",
    "highestSeniorityRank",
    "highestSeniorityRoleTitle",
    "highestSeniorityRoleCompany",
  ];

  for (const field of derivedFields) {
    const current = currentDerived?.[field] ?? null;
    const updated = computed[field] ?? null;

    if (current !== updated) {
      changes[`derived.${field}`] = updated;
    }
  }
}

// --- Step registry ---

const ALL_STEPS = {
  whitespace: applyWhitespaceCleaning,
  email: applyEmailNormalization,
  phone: applyPhoneNormalization,
  skills: applySkillDeduplication,
  education: applyEducationDeduplication,
  location: applyLocationParsing,
  seniority: applySeniorityParsing,
  // derived is handled separately because it needs currentDerived
};

// --- Main ---

async function backfillPersonDataQuality(args) {
  console.log("Starting person data quality backfill...");
  console.log("Options:", {
    dryRun: args.dryRun,
    limit: args.limit || "unlimited",
    batchSize: args.batchSize,
    skip: args.skip,
    only: args.only || "all",
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
    stepChanges: {
      whitespace: 0,
      email: 0,
      phone: 0,
      skills: 0,
      education: 0,
      location: 0,
      seniority: 0,
      derived: 0,
    },
  };

  const startTime = Date.now();

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log("Connected to MongoDB\n");

    // Count total eligible records
    const query = { mergedInto: { $exists: false } };
    const totalCount = await Person.countDocuments(query);
    const effectiveLimit = args.limit > 0 ? Math.min(args.limit, totalCount - args.skip) : totalCount - args.skip;
    console.log(`Total person records: ${totalCount}`);
    console.log(`Processing: ${effectiveLimit} (skip=${args.skip})\n`);

    // Determine which steps to run
    const stepsToRun = args.only ? [args.only] : Object.keys(ALL_STEPS);
    const validSteps = [...Object.keys(ALL_STEPS), "derived"];
    if (args.only && !validSteps.includes(args.only)) {
      console.error(
        `Invalid step: ${args.only}. Valid steps: ${validSteps.join(", ")}`,
      );
      process.exit(1);
    }

    console.log(`Steps: ${stepsToRun.join(", ")}${!args.only || args.only === "derived" ? ", derived" : ""}\n`);

    // Cursor-based iteration for memory efficiency
    let cursor = Person.find(query)
      .sort({ _id: 1 })
      .skip(args.skip)
      .select("+snapshot._meta")
      .lean();

    if (args.limit > 0) {
      cursor = cursor.limit(args.limit);
    }

    const cursorStream = cursor.cursor();

    for (let doc = await cursorStream.next(); doc != null; doc = await cursorStream.next()) {
      stats.processed++;

      try {
        const snapshot = doc.snapshot || {};
        const changes = {};

        // Run selected steps
        for (const step of stepsToRun) {
          if (step === "derived") continue; // Handled below
          const stepFn = ALL_STEPS[step];
          if (stepFn) {
            stepFn(snapshot, changes);
          }
        }

        // Derived metrics step (needs both snapshot and current derived)
        if (!args.only || args.only === "derived") {
          // If roles were cleaned by whitespace step, use the cleaned version
          const effectiveSnapshot = { ...snapshot };
          if (changes["snapshot.roles"]) {
            effectiveSnapshot.roles = changes["snapshot.roles"];
          }
          applyDerivedMetrics(effectiveSnapshot, changes, doc.derived);
        }

        // Check if any changes detected
        const changeKeys = Object.keys(changes);
        if (changeKeys.length === 0) {
          stats.skipped++;
          continue;
        }

        // Track per-step changes
        for (const key of changeKeys) {
          if (key.startsWith("derived.")) {
            stats.stepChanges.derived++;
          } else if (key.includes("email")) {
            stats.stepChanges.email++;
          } else if (key.includes("phone")) {
            stats.stepChanges.phone++;
          } else if (key.includes("skills")) {
            stats.stepChanges.skills++;
          } else if (key.includes("education")) {
            stats.stepChanges.education++;
          } else if (key.includes("parsedSeniority") || key.includes("parsedDepartment")) {
            stats.stepChanges.seniority++;
          } else if (LOCATION_FIELDS.some((f) => key.includes(f))) {
            stats.stepChanges.location++;
          } else {
            stats.stepChanges.whitespace++;
          }
        }

        if (args.verbose) {
          console.log(`  Person ${doc._id}: ${changeKeys.length} changes`);
          for (const [key, val] of Object.entries(changes)) {
            // Avoid logging full arrays
            const displayVal =
              Array.isArray(val) ? `[${val.length} items]` : val;
            console.log(`    ${key}: ${displayVal}`);
          }
        }

        if (!args.dryRun) {
          await Person.updateOne({ _id: doc._id }, { $set: changes });
        }

        stats.updated++;
      } catch (error) {
        stats.errors++;
        logger.error("Failed to backfill person data quality", {
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
            `(${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors) ` +
            `[${elapsed}s, ${rate}/sec]`,
        );
      }
    }

    await cursorStream.close();

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    const throughput = Math.round(stats.processed / (elapsedSeconds || 1));

    console.log("\nBackfill complete!");
    console.log("Statistics:");
    console.log(`  Processed: ${stats.processed}`);
    console.log(`  Updated:   ${stats.updated}`);
    console.log(`  Skipped:   ${stats.skipped} (no changes needed)`);
    console.log(`  Errors:    ${stats.errors}`);
    console.log(`  Elapsed:   ${elapsedSeconds}s`);
    console.log(`  Throughput: ${throughput} records/sec`);
    console.log("\nChanges by step:");
    for (const [step, count] of Object.entries(stats.stepChanges)) {
      if (count > 0) {
        console.log(`  ${step}: ${count} field changes`);
      }
    }

    if (args.dryRun && stats.updated > 0) {
      console.log(`\nRe-run with --commit to apply ${stats.updated} updates`);
    }

    await mongoose.connection.close();
    return stats;
  } catch (error) {
    console.error("Fatal error:", error.message);
    logger.error("Person data quality backfill failed", {
      error: error.message,
      stack: error.stack,
    });
    await mongoose.connection.close();
    throw error;
  }
}

// Export for testing
module.exports = {
  backfillPersonDataQuality,
  parseArgs,
  // Export step functions for unit testing
  applyWhitespaceCleaning,
  applyEmailNormalization,
  applyPhoneNormalization,
  applySkillDeduplication,
  applyEducationDeduplication,
  applyLocationParsing,
  applySeniorityParsing,
  applyDerivedMetrics,
  computeDerivedMetrics,
  cleanString,
  normalizeEmail,
};

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
Comprehensive Person Data Quality Backfill

Applies ALL recent data quality improvements to existing person records:
  1. Whitespace trimming/collapsing on snapshot string fields
  2. Email normalization (lowercase + trim)
  3. Phone normalization (E.164 format)
  4. Case-insensitive skill deduplication
  5. Case-insensitive education deduplication
  6. Structured location parsing (city, state, country, etc.)
  7. US region/subregion/timezone categorization
  8. Seniority and department parsing from currentTitle
  9. Derived metrics recomputation (tenure, highest seniority)

Usage: node scripts/backfillPersonDataQuality.js [options]

Options:
  --dry-run            Preview changes without saving (default)
  --commit             Execute updates (required to make changes)
  --limit=N            Limit to N people (default: 0 = unlimited)
  --batch-size=N       Process N people per batch (default: 100)
  --skip=N             Skip first N people (for resuming)
  --only=STEP          Run only a specific step
                       (whitespace|email|phone|skills|education|location|seniority|derived)
  --verbose            Log every individual field change
  --help, -h           Show this help message

Examples:
  node scripts/backfillPersonDataQuality.js --dry-run
  node scripts/backfillPersonDataQuality.js --commit --limit=500
  node scripts/backfillPersonDataQuality.js --commit --only=location
  node scripts/backfillPersonDataQuality.js --commit --skip=1000 --limit=1000
    `);
    process.exit(0);
  }

  backfillPersonDataQuality(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
