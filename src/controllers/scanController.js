const logger = require("../utils/logger");
const Scan = require("../models/scan");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError
} = require("../utils/validation");
const { getConfig } = require("../utils/env");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    const config = getConfig();

    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, 'scan');
    if (!payloadValidation.isValid) {
      return res.status(400).json(createErrorResponse(payloadValidation.error));
    }

    const profileData = payloadValidation.profileData;

    logger.info("Processing scan data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    // Validate required fields
    const requiredFields = ["ScanTime", "Profile", "First Name", "Last Name"];
    const fieldsValidation = validateRequiredFields(profileData, requiredFields, 'scan');

    if (!fieldsValidation.isValid) {
      return res.status(400).json(
        createErrorResponse(fieldsValidation.error, {
          missingFields: fieldsValidation.missingFields,
          required: requiredFields
        })
      );
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
        isNew: !scan.__v || scan.__v === 0
      });

      res.status(200).json(createSuccessResponse('scan', scan, profileData));
    } catch (dbError) {
      const errorResponse = handleDatabaseError(dbError, 'scan', profileData.id, config.isProduction);
      return res.status(500).json(errorResponse);
    }
  } catch (error) {
    logger.error("Error processing scan data:", {
      error: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      error: "Failed to process scan data",
      message: error.message
    };

    // Don't expose stack traces in production
    if (!config.isProduction && error.stack) {
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
};

module.exports = { handleScan };