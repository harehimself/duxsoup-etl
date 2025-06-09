const logger = require("../utils/logger");
const Visit = require("../models/visit");

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;
    const profileData = payload.data;

    if (!profileData) {
      logger.warn('Visit webhook received without expected "data" property', { payload });
      return res.status(400).json({
        error: 'Invalid visit payload structure',
        message: 'Missing "data" property in webhook payload'
      });
    }

    logger.info("Processing visit data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    const requiredFields = [
      "id",
      "VisitTime",
      "Profile",
      "Degree",
      "First Name",
    ];
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for visit", {
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
      // Find a document by 'id' and update it, or create it if it doesn't exist
      const visit = await Visit.findOneAndUpdate(
        { id: visitDataToSave.id }, // Filter by Dux-Soup ID
        visitDataToSave, // Data to set/update
        {
          new: true, // Return the updated document
          upsert: true, // Create if not found
          runValidators: true, // Run schema validators on update/upsert
          setDefaultsOnInsert: true // Apply defaults if a new doc is inserted
        }
      );

      logger.info("Visit data processed in MongoDB", {
        id: visit._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        status: visit.__v === 0 ? "inserted" : "updated" // Heuristic for status
      });

      res.status(200).json({ // Using 200 OK for both insert and update for simplicity
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