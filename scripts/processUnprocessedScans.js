const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const database = require("../src/utils/database");
const Scan = require("../src/models/scan");
const Person = require("../src/models/person");
const {
  upsertFromObservation,
} = require("../src/controllers/personController");
const { extractIdentifiers } = require("../src/utils/identityMatcher");

async function processUnprocessedScans(limit = null, dryRun = true) {
  await database.connect();

  console.log("\n========================================");
  console.log("PROCESSING UNPROCESSED SCANS");
  console.log("========================================\n");
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "EXECUTE"}`);
  console.log(`Limit: ${limit || "ALL"}\n`);

  // Count people BEFORE processing
  const peopleCountBefore = await Person.countDocuments({});
  console.log(`People count BEFORE: ${peopleCountBefore}\n`);

  // Get all scans (or limited subset)
  const query = limit ? Scan.find({}).limit(limit) : Scan.find({});
  const scans = await query;

  console.log(`Total scans to check: ${scans.length}\n`);

  // Analyze identifier coverage in unprocessed scans
  console.log("Analyzing identifier coverage in sample...");
  const identifierStats = {
    linkedInUsername: 0,
    salesNavId: 0,
    profileUrl: 0,
    duxsoupId: 0,
    noIdentifiers: 0,
  };

  const sampleSize = Math.min(100, scans.length);
  for (let i = 0; i < sampleSize; i++) {
    const identifiers = extractIdentifiers(scans[i]);
    if (identifiers.linkedInUsername) identifierStats.linkedInUsername++;
    if (identifiers.salesNavId) identifierStats.salesNavId++;
    if (identifiers.profileUrl) identifierStats.profileUrl++;
    if (identifiers.duxsoupId) identifierStats.duxsoupId++;
    if (
      !identifiers.linkedInUsername &&
      !identifiers.salesNavId &&
      !identifiers.profileUrl &&
      !identifiers.duxsoupId
    ) {
      identifierStats.noIdentifiers++;
    }
  }

  console.log(`\nIdentifier coverage in sample of ${sampleSize} scans:`);
  console.log(
    `  LinkedIn Username: ${identifierStats.linkedInUsername} (${Math.round((identifierStats.linkedInUsername / sampleSize) * 100)}%)`,
  );
  console.log(
    `  Sales Nav ID: ${identifierStats.salesNavId} (${Math.round((identifierStats.salesNavId / sampleSize) * 100)}%)`,
  );
  console.log(
    `  Profile URL: ${identifierStats.profileUrl} (${Math.round((identifierStats.profileUrl / sampleSize) * 100)}%)`,
  );
  console.log(
    `  DuxSoup ID: ${identifierStats.duxsoupId} (${Math.round((identifierStats.duxsoupId / sampleSize) * 100)}%)`,
  );
  console.log(`  No identifiers: ${identifierStats.noIdentifiers}\n`);

  let alreadyProcessed = 0;
  let unprocessed = 0;
  let successfullyProcessed = 0;
  let failed = 0;
  const errors = [];
  const createdNew = new Set();
  const foundExisting = new Set();

  // Process in batches of 100
  const BATCH_SIZE = 100;
  let batchCount = 0;

  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];

    try {
      // Check if Person record exists with this scan in observations
      const person = await Person.findOne({
        "observations.scans": scan._id,
      });

      if (person) {
        alreadyProcessed++;
        continue;
      }

      // This scan has no Person record
      unprocessed++;

      if (!dryRun) {
        // Check if person exists before processing
        const personBefore = await Person.findOne({
          "observations.scans": scan._id,
        });

        // Process the scan
        const result = await upsertFromObservation(scan, "scan");

        if (result) {
          successfullyProcessed++;

          // Track if we created new or found existing
          if (personBefore) {
            foundExisting.add(result._id.toString());
          } else {
            // Check if person existed by other means (alias match)
            const wasExisting =
              foundExisting.has(result._id.toString()) ||
              createdNew.has(result._id.toString());
            if (!wasExisting) {
              // Check person observation count to determine if new
              const obsCount =
                (result.observations.visits?.length || 0) +
                (result.observations.scans?.length || 0);
              if (obsCount === 1) {
                createdNew.add(result._id.toString());
              } else {
                foundExisting.add(result._id.toString());
              }
            }
          }
        } else {
          failed++;
          errors.push({
            scanId: scan._id,
            profile: scan.Profile,
            error: "upsertFromObservation returned null",
          });
        }
      }

      // Show progress every batch
      if ((i + 1) % BATCH_SIZE === 0) {
        batchCount++;
        const progress = Math.round(((i + 1) / scans.length) * 100);
        console.log(
          `Progress: ${i + 1}/${scans.length} (${progress}%) - Batch ${batchCount} complete`,
        );
        console.log(`  Already processed: ${alreadyProcessed}`);
        console.log(`  Unprocessed: ${unprocessed}`);
        if (!dryRun) {
          console.log(`  Successfully processed: ${successfullyProcessed}`);
          console.log(`  Failed: ${failed}`);
        }
        console.log("");
      }
    } catch (error) {
      failed++;
      errors.push({
        scanId: scan._id,
        profile: scan.Profile,
        error: error.message,
      });
    }
  }

  // Count people AFTER processing
  const peopleCountAfter = await Person.countDocuments({});

  // Final summary
  console.log("\n========================================");
  console.log("SUMMARY");
  console.log("========================================\n");
  console.log(`Total scans checked: ${scans.length}`);
  console.log(`Already processed (have Person): ${alreadyProcessed}`);
  console.log(`Unprocessed (no Person): ${unprocessed}`);

  if (!dryRun) {
    console.log(`\nProcessing Results:`);
    console.log(`  Successfully processed: ${successfullyProcessed}`);
    console.log(`  Failed: ${failed}`);

    console.log(`\nDeduplication Stats:`);
    console.log(`  New Person records created: ${createdNew.size}`);
    console.log(`  Matched existing Person records: ${foundExisting.size}`);
    console.log(`  People count BEFORE: ${peopleCountBefore}`);
    console.log(`  People count AFTER: ${peopleCountAfter}`);
    console.log(`  Net increase: ${peopleCountAfter - peopleCountBefore}`);

    if (errors.length > 0) {
      console.log(`\nFirst 10 Errors:`);
      errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. Scan ${err.scanId} (${err.profile})`);
        console.log(`     Error: ${err.error}`);
      });
    }
  } else {
    console.log(`\nThis was a DRY-RUN. No changes were made.`);
    console.log(`Run with dryRun=false to process ${unprocessed} scans.`);
  }

  console.log("\n========================================\n");

  await database.disconnect();

  return {
    total: scans.length,
    alreadyProcessed,
    unprocessed,
    successfullyProcessed,
    failed,
    errors,
  };
}

// Parse command line arguments
const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const dryRunArg = args.find((arg) => arg === "--execute");

const limit = limitArg ? parseInt(limitArg.split("=")[1]) : null;
const dryRun = !dryRunArg; // default to dry-run unless --execute is passed

processUnprocessedScans(limit, dryRun).catch(console.error);
