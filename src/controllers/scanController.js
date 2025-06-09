const logger = require("../utils/logger");
const Scan = require("../models/scan");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;

    logger.info("Processing scan data", {
      id: payload.id,
      profile: payload.Profile,
    });

    // Validate required fields based on the actual incoming payload and your schema
    const requiredFields = [
      "id",
      "ScanTime",
      "Profile",
      "First Name",
      "Last Name",
    ];
    const missingFields = requiredFields.filter((field) => !payload[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for scan", {
        id: payload.id,
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
    }

    // Create scan document with direct mapping to match the schema field names
    const scanDataToSave = {
      id: payload.id, // Matches schema 'id'
      ScanTime: new Date(payload.ScanTime), // Matches schema 'ScanTime'
      Profile: payload.Profile, // Matches schema 'Profile'
      "First Name": payload["First Name"], // Matches schema 'First Name'
      "Last Name": payload["Last Name"], // Matches schema 'Last Name'
      Company: payload.Company || "", // Matches schema 'Company'
      Title: payload.Title || "", // Matches schema 'Title'
      Location: payload.Location || "", // Matches schema 'Location'
      Industry: payload.Industry || "", // Matches schema 'Industry'
      "Connection Degree": payload["Connection Degree"] || "", // Matches schema 'Connection Degree'
      "Profile URL": payload["Profile URL"] || "", // Matches schema 'Profile URL'
      rawData: payload, // Stores the entire original payload
    };

    try {
      // Try to create new scan document
      const scan = new Scan(scanDataToSave);
      await scan.save();

      logger.info("Scan saved to MongoDB", {
        id: scan._id,
        duxsoupId: payload.id, // Using duxsoupId for log consistency with the past naming
        profile: payload.Profile,
      });

      res.status(201).json({
        success: true,
        message: "Scan data saved successfully",
        data: {
          id: scan._id,
          duxsoupId: payload.id, // Using duxsoupId for response consistency with the past naming
          profile: payload.Profile,
          scanTime: payload.ScanTime,
          firstName: payload["First Name"],
          lastName: payload["Last Name"],
          status: "saved to database",
        },
      });
    } catch (dbError) {
      if (dbError.code === 11000) {
        // Duplicate key error - scan already exists (based on 'id' unique index)
        logger.warn("Duplicate scan detected", {
          duxsoupId: payload.id, // Using duxsoupId for log consistency
        });

        res.status(200).json({
          success: true,
          message: "Scan already exists",
          data: {
            duxsoupId: payload.id, // Using duxsoupId for response consistency
            profile: payload.Profile,
            status: "duplicate - already in database",
          },
        });
      } else {
        // Re-throw other database errors to be caught by the outer catch block
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
