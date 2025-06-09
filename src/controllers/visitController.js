const logger = require("../utils/logger");
const Visit = require("../models/visit");

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;

    logger.info("Processing visit data", {
      id: payload.id,
      profile: payload.Profile,
    });

    // Validate required fields based on the actual incoming payload and your schema
    const requiredFields = [
      "id",
      "VisitTime",
      "Profile",
      "Degree",
      "First Name",
    ];
    const missingFields = requiredFields.filter((field) => !payload[field]);

    if (missingFields.length > 0) {
      logger.warn("Missing required fields for visit", {
        id: payload.id,
        missingFields,
      });
      return res.status(400).json({
        error: "Missing required fields",
        missingFields,
        required: requiredFields,
      });
    }

    // Create visit document with direct mapping to match the schema field names
    const visitDataToSave = {
      id: payload.id, // Matches schema 'id'
      VisitTime: new Date(payload.VisitTime), // Matches schema 'VisitTime'
      Profile: payload.Profile, // Matches schema 'Profile'
      "First Name": payload["First Name"], // Matches schema 'First Name'
      "Last Name": payload["Last Name"] || "", // Matches schema 'Last Name' (optional in your schema)
      Degree: payload.Degree, // Matches schema 'Degree'
      SalesProfile: payload.SalesProfile || "",
      RecruiterProfile: payload.RecruiterProfile || "",
      Picture: payload.Picture || "",
      "Middle Name": payload["Middle Name"] || "",
      Connections: payload.Connections || "",
      Summary: payload.Summary || "",
      Title: payload.Title || "",
      From: payload.From || "",
      Company: payload.Company || "",
      CompanyProfile: payload.CompanyProfile || "",
      CompanyWebsite: payload.CompanyWebsite || "",
      PersonalWebsite: payload.PersonalWebsite || "",
      Email: payload.Email || "",
      Phone: payload.Phone || "",
      IM: payload.IM || "",
      Twitter: payload.Twitter || "",
      Location: payload.Location || "",
      Industry: payload.Industry || "",
      "My Tags": payload["My Tags"] || [], // Matches schema 'My Tags' (as array)
      extended: payload.extended, // Matches schema 'extended' (as Mixed)
      "My Notes": payload["My Notes"] || "", // Matches schema 'My Notes'
      rawData: payload, // Stores the entire original payload
    };

    try {
      // Try to create new visit document
      const visit = new Visit(visitDataToSave);
      await visit.save();

      logger.info("Visit saved to MongoDB", {
        id: visit._id,
        duxsoupId: payload.id, // Using duxsoupId for log consistency with the past naming
        profile: payload.Profile,
      });

      res.status(201).json({
        success: true,
        message: "Visit data saved successfully",
        data: {
          id: visit._id,
          duxsoupId: payload.id, // Using duxsoupId for response consistency with the past naming
          profile: payload.Profile,
          visitTime: payload.VisitTime,
          firstName: payload["First Name"],
          status: "saved to database",
        },
      });
    } catch (dbError) {
      if (dbError.code === 11000) {
        // Duplicate key error - visit already exists (based on 'id' unique index)
        logger.warn("Duplicate visit detected", {
          duxsoupId: payload.id, // Using duxsoupId for log consistency
        });

        res.status(200).json({
          success: true,
          message: "Visit already exists",
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
