const logger = require("../utils/logger");
const Visit = require("../models/visit");

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;
    const profileData = payload.data;

    // --- IMPORTANT: ADDED VALIDATION FOR 'id' HERE ---
    if (!profileData || !profileData.id || typeof profileData.id !== 'string' || profileData.id.trim() === '') {
      logger.warn('Visit webhook received with missing, null, or empty "id" in data property', { payload });
      return res.status(400).json({
        error: 'Invalid visit payload: Missing or invalid "id"',
        message: 'The "id" field in the webhook data is required, must be a non-empty string, and cannot be null.',
      });
    }
    // --- END ADDED VALIDATION ---

    logger.info("Processing visit data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    const requiredFields = [
      // "id", // 'id' is now explicitly checked above
      "VisitTime",
      "Profile",
      "Degree",
      "First Name",
    ];
    // Filter out 'id' from missingFields check here as it's handled separately
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for visit (excluding 'id' which was validated)", {
        id: profileData.id,
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
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
        status: visit.__v === 0 ? "inserted" : "updated", // This is a heuristic
      });

      res.status(200).json({
        success: true,
        message: "Visit data processed successfully (inserted or updated)",
        data: {
          id: visit._id,
          duxsoupId: profileData.id,
          profile: profileData.Profile,
          visitTime: profileData.VisitTime,
          firstName: profileData["First Name"],
          status: "processed in database",
        },
      });
    } catch (dbError) {
      logger.error("Error saving or updating visit data:", {
        error: dbError.message,
        stack: dbError.stack,
        duxsoupId: profileData.id,
      });

      res.status(500).json({
        error: "Failed to process visit data (database error)",
        message: dbError.message,
      });
    }
  } catch (error) {
    logger.error("Error processing visit data:", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to process visit data",
      message: error.message,
    });
  }
};

module.exports = { handleVisit };