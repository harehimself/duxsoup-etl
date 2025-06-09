const logger = require("../utils/logger");
const Scan = require("../models/scan");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    const profileData = payload.data;

    if (!profileData) {
      logger.warn('Scan webhook received without expected "data" property', { payload });
      return res.status(400).json({
        error: 'Invalid scan payload structure',
        message: 'Missing "data" property in webhook payload'
      });
    }

    logger.info("Processing scan data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    const requiredFields = [
      "id",
      "ScanTime",
      "Profile",
      "First Name",
      "Last Name",
    ];
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for scan", {
        id: profileData.id,
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
    }

    const scanDataToSave = {
      id: profileData.id,
      ScanTime: new Date(profileData.ScanTime),
      Profile: profileData.Profile,
      "First Name": profileData["First Name"],
      "Last Name": profileData["Last Name"],
      Company: profileData.Company || "",
      Title: profileData.Title || "",
      Location: profileData.Location || "",
      Industry: profileData.Industry || "",
      "Connection Degree": profileData["Connection Degree"] || "",
      "Profile URL": profileData["Profile URL"] || "",
      rawData: payload,
    };

    try {
      // Find a document by 'id' and update it, or create it if it doesn't exist
      const scan = await Scan.findOneAndUpdate(
        { id: scanDataToSave.id }, // Filter by Dux-Soup ID
        scanDataToSave, // Data to set/update
        {
          new: true, // Return the updated document
          upsert: true, // Create if not found
          runValidators: true, // Run schema validators on update/upsert
          setDefaultsOnInsert: true // Apply defaults if a new doc is inserted
        }
      );

      // Determine if it was an insert or an update
      // A common simple way is to check the `_id` and whether it was just created (this is simplified)
      // Mongoose's findOneAndUpdate with upsert:true doesn't directly expose `isNew` easily.
      // For this scenario, we can simply log/respond that it was processed (inserted or updated).
      logger.info("Scan data processed in MongoDB", {
        id: scan._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        status: scan.__v === 0 ? "inserted" : "updated" // This is a heuristic, better for isNew
      });

      // You can return a 201 for a truly new creation, and 200 for an update
      // For simplicity, we can respond with 200/201 based on a more robust check if needed.
      // For now, let's just indicate success.
      res.status(200).json({ // Using 200 OK for both insert and update for simplicity
        success: true,
        message: "Scan data processed successfully (inserted or updated)",
        data: {
          id: scan._id,
          duxsoupId: profileData.id,
          profile: profileData.Profile,
          scanTime: profileData.ScanTime,
          firstName: profileData["First Name"],
          lastName: profileData["Last Name"],
          status: "processed in database", // Changed status message
        },
      });

    } catch (dbError) {
      // This catch block will now mostly handle validation errors, not duplicate key errors,
      // because `upsert: true` handles the unique constraint by updating instead of inserting a duplicate.
      logger.error("Error saving or updating scan data:", {
        error: dbError.message,
        stack: dbError.stack,
        duxsoupId: profileData.id,
      });

      res.status(500).json({
        error: "Failed to process scan data (database error)",
        message: dbError.message,
      });
    }

  } catch (error) {
    logger.error("Error processing scan data:", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to process scan data",
      message: error.message,
    });
  }
};

module.exports = { handleScan };