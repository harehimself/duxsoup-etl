const logger = require("../utils/logger");
const Scan = require("../models/scan");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    const profileData = payload.data;

    // --- IMPORTANT: ADDED VALIDATION FOR 'id' HERE ---
    if (!profileData || !profileData.id || typeof profileData.id !== 'string' || profileData.id.trim() === '') {
      logger.warn('Scan webhook received with missing, null, or empty "id" in data property', { payload });
      return res.status(400).json({
        error: 'Invalid scan payload: Missing or invalid "id"',
        message: 'The "id" field in the webhook data is required, must be a non-empty string, and cannot be null.',
      });
    }
    // --- END ADDED VALIDATION ---

    logger.info("Processing scan data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    const requiredFields = [
      // "id", // 'id' is now explicitly checked above
      "ScanTime",
      "Profile",
      "First Name",
      "Last Name",
    ];
    // Filter out 'id' from missingFields check here as it's handled separately
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for scan (excluding 'id' which was validated)", {
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
      const scan = await Scan.findOneAndUpdate(
        { id: scanDataToSave.id },
        scanDataToSave,
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.info("Scan data processed in MongoDB", {
        id: scan._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        status: scan.__v === 0 ? "inserted" : "updated", // This is a heuristic
      });

      res.status(200).json({
        success: true,
        message: "Scan data processed successfully (inserted or updated)",
        data: {
          id: scan._id,
          duxsoupId: profileData.id,
          profile: profileData.Profile,
          scanTime: profileData.ScanTime,
          firstName: profileData["First Name"],
          lastName: profileData["Last Name"],
          status: "processed in database",
        },
      });
    } catch (dbError) {
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