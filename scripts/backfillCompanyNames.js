#!/usr/bin/env node

/**
 * Company Name Normalization Backfill
 *
 * Three passes:
 *   (a) Person snapshot.currentCompany — normalize value + update _meta provenance
 *   (b) Person snapshot.roles[].companyName — normalize each role's company name
 *   (c) Company snapshot.name + name aliases — normalize name field + dedup name aliases
 *
 * Usage:
 *   node scripts/backfillCompanyNames.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N records per pass (default: 5000)
 *   --batch-size=N       Process N records per batch (default: 100)
 *   --target=SCOPE       Target scope: person | company | all (default: all)
 */

const mongoose = require("mongoose");
const Person = require("../src/models/person");
const Company = require("../src/models/company");
const logger = require("../src/utils/logger");
const { normalizeCompanyName } = require("../src/utils/companyNormalizer");

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 5000,
    batchSize: 100,
    target: "all",
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

/**
 * Pass (a): Normalize Person snapshot.currentCompany
 */
async function backfillPersonCurrentCompany(args) {
  console.log("\n--- Pass (a): Person snapshot.currentCompany ---");

  const stats = { processed: 0, updated: 0, skipped: 0, failed: 0 };

  const query = {
    "snapshot.currentCompany": { $nin: [null, ""] },
    mergedInto: { $exists: false },
  };

  const people = await Person.find(query)
    .select("_id snapshot.currentCompany snapshot._meta.currentCompany")
    .limit(args.limit)
    .lean();

  console.log(`Found ${people.length} people with currentCompany\n`);

  for (let i = 0; i < people.length; i += args.batchSize) {
    const batch = people.slice(i, i + args.batchSize);

    for (const person of batch) {
      stats.processed += 1;
      const raw = person.snapshot?.currentCompany;

      if (!raw) {
        stats.skipped += 1;
        continue;
      }

      const normalized = normalizeCompanyName(raw);

      if (!normalized || normalized === raw) {
        stats.skipped += 1;
        continue;
      }

      if (args.dryRun) {
        logger.info("Would normalize currentCompany", {
          person_id: person._id,
          from: raw,
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
              "snapshot.currentCompany": normalized,
              "snapshot._meta.currentCompany.value": normalized,
            },
          },
        );
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        logger.error("Failed to normalize currentCompany", {
          person_id: person._id,
          error: error.message,
        });
      }
    }
  }

  console.log("Pass (a) stats:", stats);
  return stats;
}

/**
 * Pass (b): Normalize Person snapshot.roles[].companyName
 */
async function backfillPersonRoleCompanyNames(args) {
  console.log("\n--- Pass (b): Person snapshot.roles[].companyName ---");

  const stats = { processed: 0, updated: 0, skipped: 0, failed: 0 };

  const query = {
    "snapshot.roles": { $exists: true, $not: { $size: 0 } },
    mergedInto: { $exists: false },
  };

  const people = await Person.find(query)
    .select("_id snapshot.roles")
    .limit(args.limit)
    .lean();

  console.log(`Found ${people.length} people with roles\n`);

  for (let i = 0; i < people.length; i += args.batchSize) {
    const batch = people.slice(i, i + args.batchSize);

    for (const person of batch) {
      stats.processed += 1;
      const roles = person.snapshot?.roles;

      if (!roles || roles.length === 0) {
        stats.skipped += 1;
        continue;
      }

      let hasChanges = false;
      const updates = {};

      roles.forEach((role, idx) => {
        if (!role.companyName) return;

        const normalized = normalizeCompanyName(role.companyName);
        if (normalized && normalized !== role.companyName) {
          updates[`snapshot.roles.${idx}.companyName`] = normalized;
          hasChanges = true;
        }
      });

      if (!hasChanges) {
        stats.skipped += 1;
        continue;
      }

      if (args.dryRun) {
        logger.info("Would normalize role companyNames", {
          person_id: person._id,
          changesCount: Object.keys(updates).length,
        });
        stats.updated += 1;
        continue;
      }

      try {
        await Person.updateOne({ _id: person._id }, { $set: updates });
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        logger.error("Failed to normalize role companyNames", {
          person_id: person._id,
          error: error.message,
        });
      }
    }
  }

  console.log("Pass (b) stats:", stats);
  return stats;
}

/**
 * Pass (c): Normalize Company snapshot.name + dedup name aliases
 */
async function backfillCompanyNames(args) {
  console.log("\n--- Pass (c): Company snapshot.name + name aliases ---");

  const stats = { processed: 0, updated: 0, skipped: 0, failed: 0 };

  const query = {
    $or: [
      { "snapshot.name": { $nin: [null, ""] } },
      { "aliases.type": "name" },
    ],
  };

  const companies = await Company.find(query)
    .select("_id snapshot.name snapshot._meta.name aliases")
    .limit(args.limit)
    .lean();

  console.log(`Found ${companies.length} companies\n`);

  for (let i = 0; i < companies.length; i += args.batchSize) {
    const batch = companies.slice(i, i + args.batchSize);

    for (const company of batch) {
      stats.processed += 1;

      const $set = {};
      let hasChanges = false;

      // Normalize snapshot.name
      const rawName = company.snapshot?.name;
      if (rawName) {
        const normalized = normalizeCompanyName(rawName);
        if (normalized && normalized !== rawName) {
          $set["snapshot.name"] = normalized;
          $set["snapshot._meta.name.value"] = normalized;
          hasChanges = true;
        }
      }

      // Dedup name aliases
      if (company.aliases && company.aliases.length > 0) {
        const seen = new Set();
        const deduped = [];
        let aliasChanged = false;

        for (const alias of company.aliases) {
          if (alias.type === "name") {
            const normalized = normalizeCompanyName(alias.value);
            const val = normalized || alias.value;
            const key = `${alias.type}:${val}`;
            if (seen.has(key)) {
              aliasChanged = true;
              continue;
            }
            seen.add(key);
            deduped.push({ type: alias.type, value: val });
            if (val !== alias.value) aliasChanged = true;
          } else {
            const key = `${alias.type}:${alias.value}`;
            if (seen.has(key)) {
              aliasChanged = true;
              continue;
            }
            seen.add(key);
            deduped.push(alias);
          }
        }

        if (aliasChanged) {
          $set.aliases = deduped;
          hasChanges = true;
        }
      }

      if (!hasChanges) {
        stats.skipped += 1;
        continue;
      }

      if (args.dryRun) {
        logger.info("Would normalize company", {
          company_id: company._id,
          updates: Object.keys($set),
        });
        stats.updated += 1;
        continue;
      }

      try {
        await Company.updateOne({ _id: company._id }, { $set });
        stats.updated += 1;
      } catch (error) {
        stats.failed += 1;
        logger.error("Failed to normalize company", {
          company_id: company._id,
          error: error.message,
        });
      }
    }
  }

  console.log("Pass (c) stats:", stats);
  return stats;
}

async function main(args) {
  console.log("🏢 Starting company name normalization backfill...");
  console.log("Options:", args);
  console.log("");

  if (args.dryRun) {
    console.log("⚠️  DRY RUN MODE - No changes will be made");
    console.log("   Use --commit to execute updates\n");
  }

  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl";
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    console.log("✓ Connected to MongoDB\n");

    const results = {};

    if (args.target === "all" || args.target === "person") {
      results.currentCompany = await backfillPersonCurrentCompany(args);
      results.roleCompanyNames = await backfillPersonRoleCompanyNames(args);
    }

    if (args.target === "all" || args.target === "company") {
      results.companyNames = await backfillCompanyNames(args);
    }

    console.log("\n✅ Company name normalization backfill complete");
    console.log("Results:", JSON.stringify(results, null, 2));

    return results;
  } catch (error) {
    logger.error("Company name normalization backfill failed", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

// Export for testing
module.exports = {
  main,
  parseArgs,
  backfillPersonCurrentCompany,
  backfillPersonRoleCompanyNames,
  backfillCompanyNames,
};

// Run if executed directly
if (require.main === module) {
  const args = parseArgs();
  main(args)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
