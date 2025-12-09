const logger = require("../utils/logger");
const Visit = require("../models/visit");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError
} = require("../utils/validation");
const { getConfig } = require("../utils/env");

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;
    const config = getConfig();

    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, 'visit');
    if (!payloadValidation.isValid) {
      return res.status(400).json(createErrorResponse(payloadValidation.error));
    }

    const profileData = payloadValidation.profileData;

    logger.info("Processing visit data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    // Validate required fields
    const requiredFields = ["VisitTime", "Profile", "Degree", "First Name"];
    const fieldsValidation = validateRequiredFields(profileData, requiredFields, 'visit');

    if (!fieldsValidation.isValid) {
      return res.status(400).json(
        createErrorResponse(fieldsValidation.error, {
          missingFields: fieldsValidation.missingFields,
          required: requiredFields
        })
      );
    }

    const visitDataToSave = {
      id: profileData.id,
      VisitTime: new Date(profileData.VisitTime),
      Profile: profileData.Profile,
      "First Name": profileData["First Name"],
      "Last Name": profileData["Last Name"] || "",
      Degree: profileData.Degree,
      SalesProfile: profileData.SalesProfile || "",
      RecruiterProfile: profileData.RecruiterProfile || "",
      Picture: profileData.Picture || "",
      "Middle Name": profileData["Middle Name"] || "",
      Connections: profileData.Connections || "",
      Summary: profileData.Summary || "",
      Title: profileData.Title || "",
      From: profileData.From || "",
      Company: profileData.Company || "",
      CompanyProfile: profileData.CompanyProfile || "",
      CompanyWebsite: profileData.CompanyWebsite || "",
      PersonalWebsite: profileData.PersonalWebsite || "",
      Email: profileData.Email || "",
      Phone: profileData.Phone || "",
      IM: profileData.IM || "",
      Twitter: profileData.Twitter || "",
      Location: profileData.Location || "",
      Industry: profileData.Industry || "",
      "My Tags": profileData["My Tags"] || [],
      extended: profileData.extended,
      "My Notes": profileData["My Notes"] || "",
      rawData: payload,
    };

    try {
      const visit = await Visit.findOneAndUpdate(
        { id: visitDataToSave.id },
        visitDataToSave,
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.info("Visit data processed in MongoDB", {
        id: visit._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        isNew: !visit.__v || visit.__v === 0
      });

      res.status(200).json(createSuccessResponse('visit', visit, profileData));
    } catch (dbError) {
      const errorResponse = handleDatabaseError(dbError, 'visit', profileData.id, config.isProduction);
      return res.status(500).json(errorResponse);
    }
  } catch (error) {
    logger.error("Error processing visit data:", {
      error: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      error: "Failed to process visit data",
      message: error.message
    };

    // Don't expose stack traces in production
    if (!config.isProduction && error.stack) {
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
};

module.exports = { handleVisit };