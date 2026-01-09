/**
 * Company ID Migration Script
 *
 * Migrates company _id from various formats to numeric LinkedIn company IDs
 *
 * Handles:
 * 1. "linkedin.com/company/314350" → "314350" (extract numeric ID)
 * 2. Company names → Delete if --delete-invalid flag is used
 *
 * Creates backup collection before migrating
 */

const mongoose = require("mongoose");
require("dotenv").config();

const DRY_RUN = process.argv.includes("--dry-run");
const EXECUTE = process.argv.includes("--execute");
const DELETE_INVALID = process.argv.includes("--delete-invalid");

if (!DRY_RUN && !EXECUTE) {
  console.log("\n⚠️  Error: You must specify --dry-run or --execute\n");
  console.log("Usage:");
  console.log(
    "  node scripts/migrateCompanyIds.js --dry-run              # Preview changes",
  );
  console.log(
    "  node scripts/migrateCompanyIds.js --execute              # Migrate only (keep invalid)",
  );
  console.log(
    "  node scripts/migrateCompanyIds.js --execute --delete-invalid  # Migrate + delete invalid\n",
  );
  process.exit(1);
}

/**
 * Extract numeric company ID from LinkedIn company URL
 * Example: "linkedin.com/company/314350" → "314350"
 */
function extractNumericId(companyId) {
  if (!companyId || typeof companyId !== "string") return null;

  // Already numeric - return as-is
  if (/^\d+$/.test(companyId)) {
    return companyId;
  }

  // Extract from URL pattern: linkedin.com/company/12345
  const urlPattern = /linkedin\.com\/company\/(\d+)/i;
  const match = companyId.match(urlPattern);

  if (match) {
    return match[1];
  }

  // No numeric ID found
  return null;
}

async function migrateCompanyIds() {
  try {
    console.log("\n" + "=".repeat(70));
    console.log("Company ID Migration Script");
    console.log("=".repeat(70));
    console.log(
      `Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "EXECUTE (will apply changes)"}`,
    );
    console.log("=".repeat(70) + "\n");

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB Atlas\n");

    const db = mongoose.connection.db;
    const companies = db.collection("companies");

    // Get all companies
    const allCompanies = await companies.find({}).toArray();
    console.log(`Total companies: ${allCompanies.length}\n`);

    // Analyze what needs to be migrated
    const alreadyNumeric = [];
    const canExtract = []; // Can extract numeric ID from URL
    const noNumericId = []; // Company names, can't extract

    allCompanies.forEach((company) => {
      const currentId = company._id;
      const numericId = extractNumericId(currentId);

      if (currentId === numericId) {
        // Already numeric
        alreadyNumeric.push(company);
      } else if (numericId) {
        // Can extract from URL
        canExtract.push({ company, currentId, newId: numericId });
      } else {
        // No numeric ID (company name)
        noNumericId.push(company);
      }
    });

    console.log("Analysis:");
    console.log("=".repeat(70));
    console.log(
      `✅ Already numeric: ${alreadyNumeric.length} (${((alreadyNumeric.length / allCompanies.length) * 100).toFixed(1)}%)`,
    );
    console.log(
      `🔄 Can migrate (extract from URL): ${canExtract.length} (${((canExtract.length / allCompanies.length) * 100).toFixed(1)}%)`,
    );
    console.log(
      `⚠️  Cannot migrate (no numeric ID): ${noNumericId.length} (${((noNumericId.length / allCompanies.length) * 100).toFixed(1)}%)`,
    );
    console.log("=".repeat(70) + "\n");

    // Show examples of what will be migrated
    if (canExtract.length > 0) {
      console.log("Examples of companies that will be migrated:");
      console.log("-".repeat(70));
      canExtract.slice(0, 10).forEach((item, idx) => {
        console.log(`${idx + 1}. "${item.currentId}" → "${item.newId}"`);
        console.log(`   Name: ${item.company.snapshot?.name || "null"}`);
      });
      console.log("-".repeat(70) + "\n");
    }

    // Show examples of companies that CANNOT be migrated
    if (noNumericId.length > 0) {
      console.log("⚠️  Companies that CANNOT be migrated (no numeric ID):");
      console.log("-".repeat(70));
      noNumericId.slice(0, 10).forEach((company, idx) => {
        console.log(`${idx + 1}. _id: "${company._id}"`);
        console.log(`   Name: ${company.snapshot?.name || "null"}`);
      });
      console.log("-".repeat(70) + "\n");
      console.log(
        `⚠️  These ${noNumericId.length} companies will keep their current IDs (company names)`,
      );
      console.log(
        "⚠️  They will FAIL model validation if you try to update them!",
      );
      console.log(
        "⚠️  Recommendation: Find their LinkedIn company URLs and update manually\n",
      );
    }

    if (DRY_RUN) {
      console.log("\n" + "=".repeat(70));
      console.log("DRY RUN COMPLETE - No changes made");
      console.log("=".repeat(70));
      console.log(`\nWould migrate: ${canExtract.length} companies`);
      console.log(`Would skip (already numeric): ${alreadyNumeric.length}`);
      if (DELETE_INVALID) {
        console.log(`Would delete (no numeric ID): ${noNumericId.length}`);
      } else {
        console.log(
          `Would keep (no numeric ID): ${noNumericId.length} (use --delete-invalid to delete)`,
        );
      }
      console.log("\nRun with --execute to apply these changes\n");
      await mongoose.connection.close();
      return;
    }

    // EXECUTE MODE - Apply migrations
    console.log("\n" + "=".repeat(70));
    console.log("EXECUTING MIGRATION");
    console.log("=".repeat(70) + "\n");

    // Step 1: Create backup
    console.log("Step 1: Creating backup...");
    const backupName = `companies_backup_${Date.now()}`;
    await db.collection(backupName).insertMany(allCompanies);
    console.log(
      `✅ Backup created: ${backupName} (${allCompanies.length} records)\n`,
    );

    // Step 2: Migrate companies
    console.log("Step 2: Migrating companies...");
    let migratedCount = 0;
    let errorCount = 0;

    for (const item of canExtract) {
      try {
        // Check if a company with the numeric ID already exists
        const existingCompany = await companies.findOne({ _id: item.newId });

        if (existingCompany) {
          // Merge: Update existing company with aliases from the URL-based record
          const oldIdAlias = {
            type: "profileUrl",
            value: item.currentId,
            addedAt: new Date(),
          };

          // Merge aliases from both records
          const mergedAliases = existingCompany.aliases || [];

          // Add old URL as alias if not already there
          if (!mergedAliases.find((a) => a.value === item.currentId)) {
            mergedAliases.push(oldIdAlias);
          }

          // Add any aliases from the URL-based record
          if (item.company.aliases) {
            item.company.aliases.forEach((alias) => {
              if (!mergedAliases.find((a) => a.value === alias.value)) {
                mergedAliases.push(alias);
              }
            });
          }

          // Update existing company with merged aliases
          await companies.updateOne(
            { _id: item.newId },
            { $set: { aliases: mergedAliases } },
          );

          // Delete the old URL-based record
          await companies.deleteOne({ _id: item.currentId });
        } else {
          // No conflict: Create new company with numeric ID
          const newCompany = {
            ...item.company,
            _id: item.newId,
          };

          // Add old ID to aliases if not already there
          if (!newCompany.aliases) {
            newCompany.aliases = [];
          }

          const oldIdAlias = {
            type: "profileUrl",
            value: item.currentId,
            addedAt: new Date(),
          };

          // Only add if not already in aliases
          if (!newCompany.aliases.find((a) => a.value === item.currentId)) {
            newCompany.aliases.push(oldIdAlias);
          }

          // Insert new record
          await companies.insertOne(newCompany);

          // Delete old record
          await companies.deleteOne({ _id: item.currentId });
        }

        migratedCount++;

        if (migratedCount % 100 === 0) {
          console.log(`  Migrated ${migratedCount}/${canExtract.length}...`);
        }
      } catch (error) {
        console.error(
          `  ❌ Error migrating "${item.currentId}": ${error.message}`,
        );
        errorCount++;
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`  Migrated: ${migratedCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Skipped (already numeric): ${alreadyNumeric.length}`);

    // Step 3: Delete companies without numeric IDs (if flag is set)
    let deletedCount = 0;
    if (DELETE_INVALID && noNumericId.length > 0) {
      console.log(
        `\nStep 3: Deleting companies without numeric IDs (DELETE_INVALID flag set)...`,
      );
      console.log(`  Companies to delete: ${noNumericId.length}`);

      for (const company of noNumericId) {
        try {
          await companies.deleteOne({ _id: company._id });
          deletedCount++;

          if (deletedCount % 50 === 0) {
            console.log(`  Deleted ${deletedCount}/${noNumericId.length}...`);
          }
        } catch (error) {
          console.error(
            `  ❌ Error deleting "${company._id}": ${error.message}`,
          );
        }
      }

      console.log(`\n✅ Deletion complete!`);
      console.log(`  Deleted: ${deletedCount}`);
    } else if (!DELETE_INVALID && noNumericId.length > 0) {
      console.log(
        `\n⏭️  Step 3: Skipping deletion of ${noNumericId.length} companies without numeric IDs`,
      );
      console.log(`   (Use --delete-invalid flag to delete these companies)`);
    }

    // Step 4: Verify migration
    console.log(
      `\nStep ${DELETE_INVALID && noNumericId.length > 0 ? "4" : "3"}: Verifying migration...`,
    );
    const afterMigration = await companies.find({}).toArray();
    const afterNumeric = afterMigration.filter((c) => /^\d+$/.test(c._id));
    const afterNonNumeric = afterMigration.filter((c) => !/^\d+$/.test(c._id));

    console.log(`  Total companies: ${afterMigration.length}`);
    console.log(
      `  Numeric IDs: ${afterNumeric.length} (${((afterNumeric.length / afterMigration.length) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Non-numeric IDs: ${afterNonNumeric.length} (${((afterNonNumeric.length / afterMigration.length) * 100).toFixed(1)}%)`,
    );

    console.log("\n" + "=".repeat(70));
    console.log("MIGRATION COMPLETE");
    console.log("=".repeat(70));
    console.log(`\nBackup collection: ${backupName}`);
    console.log(
      "To restore: db.companies.drop(); db.${backupName}.find().forEach(function(doc) { db.companies.insert(doc); });\n",
    );

    await mongoose.connection.close();
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migrateCompanyIds();
