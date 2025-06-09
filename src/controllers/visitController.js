const logger = require("../utils/logger");
const Visit = require("../models/visit");

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;
    // Extract the actual profile data from the 'data' property
    const profileData = payload.data;

    // IMPORTANT: Check if profileData exists before proceeding
    if (!profileData) {
      logger.warn('Visit webhook received without expected "data" property', { payload });
      return res.status(400).json({
        error: 'Invalid visit payload structure',
        message: 'Missing "data" property in webhook payload'
      });
    }

    logger.info("Processing visit data", {
      id: profileData.id, // Now using profileData.id
      profile: profileData.Profile, // Now using profileData.Profile
    });

    // Validate required fields based on the actual incoming profileData
    const requiredFields = [
      "id",
      "VisitTime",
      "Profile",
      "Degree",
      "First Name",
    ];
    // Check missing fields on profileData, not payload
    const missingFields = requiredFields.filter((field) => !profileData[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for visit", {
        id: profileData.id, // Now using profileData.id
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
    }

    // Create visit document with direct mapping from profileData
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
      rawData: payload, // Store the entire original webhook payload
    };

    try {
      const visit = new Visit(visitDataToSave);
      await visit.save();

      logger.info("Visit saved to MongoDB", {
        id: visit._id,
        duxsoupId: profileData.id, // Using profileData.id
        profile: profileData.Profile, // Using profileData.Profile
      });

      res.status(201).json({
        success: true,
        message: "Visit data saved successfully",
        data: {
          id: visit._id,
          duxsoupId: profileData.id, // Using profileData.id
          profile: profileData.Profile, // Using profileData.Profile
          visitTime: profileData.VisitTime,
          firstName: profileData["First Name"],
          status: "saved to database",
        },
      });
    } catch (dbError) {
      if (dbError.code === 11000) {
        logger.warn("Duplicate visit detected", {
          duxsoupId: profileData.id, // Using profileData.id
        });

        res.status(200).json({
          success: true,
          message: "Visit already exists",
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