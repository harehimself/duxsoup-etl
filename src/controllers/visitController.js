const Visit = require("../models/visit");
const { handleObservation } = require("./observationHandler");

/**
 * Visit-specific data mapper
 * Maps webhook profileData to Visit document structure
 */
function mapVisitData(profileData, payload, eventKey) {
  return {
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
    // Metadata fields from top-level payload
    userid: payload.userid || "",
    time: payload.time ? new Date(payload.time) : null,
    type: payload.type || "",
    event: payload.event || "",
    messagecontext: payload.messagecontext || "",
    rawData: payload,
    event_key: eventKey,
  };
}

/**
 * Visit webhook handler
 * Uses shared observation handler with visit-specific configuration
 */
const handleVisit = async (req, res) => {
  const config = {
    model: Visit,
    type: 'visit',
    timeField: 'VisitTime',
    requiredFields: ["VisitTime", "Profile", "Degree", "First Name"],
    dataMapper: mapVisitData,
  };

  return handleObservation(config, req, res);
};

module.exports = { handleVisit };
