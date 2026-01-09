const mongoose = require("mongoose");
require("dotenv").config();

async function checkCompanyIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB Atlas\n");

    const db = mongoose.connection.db;
    const companies = db.collection("companies");

    // Get total count
    const total = await companies.countDocuments();
    console.log(`Total companies: ${total}\n`);

    // Sample first 20 companies to see their _id format
    console.log("Sample company IDs (first 20):");
    console.log("=".repeat(60));
    const samples = await companies.find({}).limit(20).toArray();

    samples.forEach((company, idx) => {
      const isNumeric = /^\d+$/.test(company._id);
      console.log(
        `${idx + 1}. _id: "${company._id}" | Numeric: ${isNumeric ? "✅" : "❌"} | Name: ${company.snapshot?.name || "null"}`,
      );
    });

    // Count how many are numeric vs non-numeric
    console.log("\n" + "=".repeat(60));
    console.log("Analysis:");
    console.log("=".repeat(60));

    const allCompanies = await companies.find({}).toArray();
    const numericIds = allCompanies.filter((c) => /^\d+$/.test(c._id));
    const nonNumericIds = allCompanies.filter((c) => !/^\d+$/.test(c._id));

    console.log(
      `Numeric IDs (valid): ${numericIds.length} (${((numericIds.length / total) * 100).toFixed(1)}%)`,
    );
    console.log(
      `Non-numeric IDs (INVALID): ${nonNumericIds.length} (${((nonNumericIds.length / total) * 100).toFixed(1)}%)`,
    );

    if (nonNumericIds.length > 0) {
      console.log(
        "\n⚠️  WARNING: Found non-numeric company IDs that will FAIL validation!",
      );
      console.log("\nExamples of non-numeric IDs:");
      nonNumericIds.slice(0, 10).forEach((company, idx) => {
        console.log(
          `  ${idx + 1}. _id: "${company._id}" | Name: ${company.snapshot?.name || "null"}`,
        );
      });
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkCompanyIds();
