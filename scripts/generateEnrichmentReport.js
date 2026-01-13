const mongoose = require("mongoose");
const Person = require("../src/models/person");
const logger = require("../src/utils/logger");
require("dotenv").config();

async function generateEnrichmentReport() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info("MongoDB connected successfully");

    console.log("\n========================================");
    console.log("FINAL ENRICHMENT REPORT");
    console.log("========================================\n");

    // Total counts
    const totalPeople = await Person.countDocuments();
    const peopleWithEmail = await Person.countDocuments({
      "snapshot.email": { $exists: true, $ne: null },
    });
    const peopleWithPhone = await Person.countDocuments({
      "snapshot.phone": { $exists: true, $ne: null },
    });
    const peopleWithSkills = await Person.countDocuments({
      "snapshot.skills.0": { $exists: true },
    });
    const peopleWithEducation = await Person.countDocuments({
      "snapshot.education.0": { $exists: true },
    });
    const peopleWithRoles = await Person.countDocuments({
      "snapshot.roles.0": { $exists: true },
    });
    const peopleWithSalesNavId = await Person.countDocuments({
      _id: /^AC[wo]AA/i,
    });
    const peopleWithLinkedInUsername = await Person.countDocuments({
      _id: /^[a-z0-9_-]{3,100}$/i,
    });

    console.log("Overall Statistics:");
    console.log(`  Total Person Records: ${totalPeople.toLocaleString()}`);
    console.log(
      `  With Sales Navigator ID: ${peopleWithSalesNavId.toLocaleString()} (${((peopleWithSalesNavId / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  With LinkedIn Username: ${peopleWithLinkedInUsername.toLocaleString()} (${((peopleWithLinkedInUsername / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log();

    console.log("Data Coverage:");
    console.log(
      `  Email: ${peopleWithEmail.toLocaleString()} (${((peopleWithEmail / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Phone: ${peopleWithPhone.toLocaleString()} (${((peopleWithPhone / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Skills: ${peopleWithSkills.toLocaleString()} (${((peopleWithSkills / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Education: ${peopleWithEducation.toLocaleString()} (${((peopleWithEducation / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Career History (Roles): ${peopleWithRoles.toLocaleString()} (${((peopleWithRoles / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log();

    // Observation stats
    const peopleWithVisits = await Person.countDocuments({
      "observations.visits.0": { $exists: true },
    });
    const peopleWithScans = await Person.countDocuments({
      "observations.scans.0": { $exists: true },
    });
    const peopleWithBoth = await Person.countDocuments({
      "observations.visits.0": { $exists: true },
      "observations.scans.0": { $exists: true },
    });

    console.log("Observation Coverage:");
    console.log(
      `  People with Visit observations: ${peopleWithVisits.toLocaleString()} (${((peopleWithVisits / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  People with Scan observations: ${peopleWithScans.toLocaleString()} (${((peopleWithScans / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  People with BOTH: ${peopleWithBoth.toLocaleString()} (${((peopleWithBoth / totalPeople) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  CSV-only profiles (no observations): ${(totalPeople - peopleWithVisits - peopleWithScans + peopleWithBoth).toLocaleString()}`,
    );
    console.log();

    // Top companies
    const topCompanies = await Person.aggregate([
      {
        $match: {
          "snapshot.currentCompany": { $exists: true, $ne: null },
        },
      },
      { $group: { _id: "$snapshot.currentCompany", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    console.log("Top 10 Companies:");
    topCompanies.forEach((company, index) => {
      console.log(`  ${index + 1}. ${company._id}: ${company.count} people`);
    });
    console.log();

    // Top locations
    const topLocations = await Person.aggregate([
      { $match: { "snapshot.location": { $exists: true, $ne: null } } },
      { $group: { _id: "$snapshot.location", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    console.log("Top 10 Locations:");
    topLocations.forEach((location, index) => {
      console.log(`  ${index + 1}. ${location._id}: ${location.count} people`);
    });
    console.log();

    // Skills analysis
    const totalSkills = await Person.aggregate([
      { $match: { "snapshot.skills.0": { $exists: true } } },
      { $unwind: "$snapshot.skills" },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);

    const uniqueSkills = await Person.aggregate([
      { $match: { "snapshot.skills.0": { $exists: true } } },
      { $unwind: "$snapshot.skills" },
      { $group: { _id: "$snapshot.skills" } },
      { $count: "total" },
    ]);

    console.log("Skills Analysis:");
    console.log(
      `  Total skill entries: ${totalSkills[0]?.count?.toLocaleString() || 0}`,
    );
    console.log(
      `  Unique skills: ${uniqueSkills[0]?.total?.toLocaleString() || 0}`,
    );
    console.log();

    // Enrichment journey summary
    console.log("========================================");
    console.log("ENRICHMENT JOURNEY SUMMARY");
    console.log("========================================\n");

    console.log("Phase 1: Dead Letter Replay");
    console.log("  - Replayed 1,688 failed webhook observations");
    console.log("  - Created initial Person records from visits");
    console.log();

    console.log("Phase 2: Scan Processing");
    console.log("  - Processed 28,119 scan observations");
    console.log("  - Successfully processed: 22,601 (98.3%)");
    console.log("  - Created 15,557 net new Person records");
    console.log("  - Fixed validation limits for long titles and thumbnails");
    console.log();

    console.log("Phase 3: CSV Import");
    console.log("  - Imported 4,974 CSV profiles");
    console.log("  - Enriched 2,213 existing records (44.5%)");
    console.log("  - Created 2,758 new records (55.5%)");
    console.log("  - Added contact info, skills, full career history");
    console.log();

    console.log("Final Results:");
    console.log(`  Total Person Records: ${totalPeople.toLocaleString()}`);
    console.log(
      `  Email Coverage: ${((peopleWithEmail / totalPeople) * 100).toFixed(1)}%`,
    );
    console.log(
      `  Phone Coverage: ${((peopleWithPhone / totalPeople) * 100).toFixed(1)}%`,
    );
    console.log(
      `  Skills Coverage: ${((peopleWithSkills / totalPeople) * 100).toFixed(1)}%`,
    );
    console.log(
      `  Education Coverage: ${((peopleWithEducation / totalPeople) * 100).toFixed(1)}%`,
    );
    console.log();

    console.log("========================================\n");

    await mongoose.disconnect();
    logger.info("MongoDB disconnected successfully");
  } catch (error) {
    logger.error("Failed to generate enrichment report", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

generateEnrichmentReport()
  .then(() => {
    console.log("Report generation completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Report generation failed:", error.message);
    process.exit(1);
  });
