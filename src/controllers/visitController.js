const Visit = require("../models/visit");
const { handleObservation } = require("./observationHandler");
const { parseLocation } = require("../utils/location-parser");

/**
 * Visit-specific data mapper
 * Maps webhook profileData to Visit document structure
 */
function mapVisitData(profileData, payload, eventKey) {
  // Parse location into structured fields
  const locationStr = profileData.Location || "";
  const parsedLocation = parseLocation(locationStr);

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
    Location: locationStr,
    // Structured location fields
    city: parsedLocation.city,
    state: parsedLocation.state,
    stateCode: parsedLocation.stateCode,
    country: parsedLocation.country,
    countryCode: parsedLocation.countryCode,
    province: parsedLocation.province,
    region: parsedLocation.region,
    locationType: parsedLocation.locationType,
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
 * Returns visit-specific configuration for the observation handler.
 */
function getVisitConfig() {
  return {
    model: Visit,
    type: "visit",
    timeField: "VisitTime",
    requiredFields: ["VisitTime", "Degree", "First Name"],
    dataMapper: mapVisitData,
  };
}

/**
 * Visit webhook handler
 * Uses shared observation handler with visit-specific configuration
 */
const handleVisit = async (req, res) => {
  return handleObservation(getVisitConfig(), req, res);
};

module.exports = { handleVisit, getVisitConfig };
