const logger = require("../utils/logger");
const Scan = require("../models/scan");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    // Extract the actual profile data from the 'data' property
    const profileData = payload.data;

    // IMPORTANT: Check if profileData exists before proceeding
    if (!profileData) {
      logger.warn('Scan webhook received without expected "data" property', { payload });
      return res.status(400).json({
        error: 'Invalid scan payload structure',
        message: 'Missing "data" property in webhook payload'
      });
    }

    logger.info("Processing scan data", {
      id: profileData.id, // Now using profileData.id
      profile: profileData.Profile, // Now using profileData.Profile
    });

    // Validate required fields based on the actual incoming profileData
    const requiredFields = [
      "id",
      "ScanTime",
      "Profile",
      "First Name",
      "Last Name",
    ];
    // Check missing fields on profileData, not payload
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for scan", {
        id: profileData.id, // Now using profileData.id
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
    }

    // Create scan document with direct mapping from profileData
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
      "Connection Degree": profileData["Connection Degree"] || "", // Ensure this exists in your Dux-Soup setup
      "Profile URL": profileData["Profile URL"] || "", // Ensure this exists in your Dux-Soup setup
      rawData: payload, // Store the entire original webhook payload
    };

    try {
      const scan = new Scan(scanDataToSave);
      await scan.save();

      logger.info("Scan saved to MongoDB", {
        id: scan._id,
        duxsoupId: profileData.id, // Using profileData.id
        profile: profileData.Profile, // Using profileData.Profile
      });

      res.status(201).json({
        success: true,
        message: "Scan data saved successfully",
        data: {
          id: scan._id,
          duxsoupId: profileData.id, // Using profileData.id
          profile: profileData.Profile, // Using profileData.Profile
          scanTime: profileData.ScanTime,
          firstName: profileData["First Name"],
          lastName: profileData["Last Name"],
          status: "saved to database",
        },
      });
    } catch (dbError) {
      if (dbError.code === 11000) {
        logger.warn("Duplicate scan detected", {
          duxsoupId: profileData.id, // Using profileData.id
        });

        res.status(200).json({
          success: true,
          message: "Scan already exists",
          data: {
            duxsoupId: profileData.id, // Using profileData.id
            profile: profileData.Profile, // Using profileData.Profile
            status: "duplicate - already in database",
          },
        });
      } else {
        throw dbError;
      }
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