const Scan = require("../models/scan");
const { handleObservation } = require("./observationHandler");
const { parseLocation } = require("../utils/location-parser");

/**
 * Scan-specific data mapper
 * Maps webhook profileData to Scan document structure
 */
function mapScanData(profileData, payload, eventKey) {
  // Parse location into structured fields
  const locationStr = profileData.Location || "";
  const parsedLocation = parseLocation(locationStr);

  return {
    id: profileData.id,
    ScanTime: new Date(profileData.ScanTime),
    Profile: profileData.Profile,
    "First Name": profileData["First Name"],
    "Last Name": profileData["Last Name"],
    "Middle Name": profileData["Middle Name"] || "",
    Company: profileData.Company || "",
    CompanyID: profileData.CompanyID || "",
    Title: profileData.Title || "",
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
    "Connection Degree": profileData["Connection Degree"] || "",
    "Profile URL": profileData["Profile URL"] || "",
    PublicProfile: profileData.PublicProfile || "",
    Degree: profileData.Degree || "",
    Picture: profileData.Picture || profileData.Thumbnail || "",
    Connections: profileData.Connections || "",
    Summary: profileData.Summary || "",
    SalesProfile: profileData.SalesProfile || "",
    RecruiterProfile: profileData.RecruiterProfile || "",
    rawData: payload,
    event_key: eventKey,
  };
}

/**
 * Scan webhook handler
 * Uses shared observation handler with scan-specific configuration
 */
const handleScan = async (req, res) => {
  const config = {
    model: Scan,
    type: 'scan',
    timeField: 'ScanTime',
    requiredFields: ["ScanTime", "First Name", "Last Name"],
    dataMapper: mapScanData,
  };

  return handleObservation(config, req, res);
};

module.exports = { handleScan };
