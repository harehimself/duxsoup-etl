/**
 * Location Parser Utility
 *
 * Parses LinkedIn location strings into structured components.
 * Handles various formats:
 * - "Chicago, Illinois, United States"
 * - "San Francisco, CA"
 * - "Greater Tampa Bay Area"
 * - "Denver Metropolitan Area"
 * - "Toronto, Ontario, Canada"
 * - "London, England, United Kingdom"
 */

// US State mappings
const US_STATES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

// Common metropolitan area patterns
const METRO_PATTERNS = [
  /^greater\s+(.+?)\s+area$/i,
  /^(.+?)\s+metropolitan\s+area$/i,
  /^(.+?)\s+metro\s+area$/i,
  /^(.+?)\s+bay\s+area$/i,
];

// Country name standardization
const COUNTRY_CODES = {
  "United States": "US",
  "United Kingdom": "GB",
  Canada: "CA",
  Mexico: "MX",
  Germany: "DE",
  France: "FR",
  Spain: "ES",
  Italy: "IT",
  Netherlands: "NL",
  Belgium: "BE",
  Switzerland: "CH",
  Austria: "AT",
  Australia: "AU",
  "New Zealand": "NZ",
  India: "IN",
  China: "CN",
  Japan: "JP",
  "South Korea": "KR",
  Singapore: "SG",
  Brazil: "BR",
  Argentina: "AR",
};

// Reverse lookup for states (full name to code)
const US_STATE_NAME_TO_CODE = Object.entries(US_STATES).reduce(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  },
  {},
);

/**
 * Parse a LinkedIn location string into structured components
 * @param {string} rawLocation - The raw location string from LinkedIn
 * @returns {object} Structured location object
 */
function parseLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== "string") {
    return {
      rawLocation: rawLocation || "",
      locationType: "unknown",
    };
  }

  const location = {
    rawLocation: rawLocation.trim(),
    city: null,
    state: null,
    stateCode: null,
    country: null,
    countryCode: null,
    province: null,
    region: null,
    locationType: "unknown",
  };

  // Check for metropolitan area patterns
  for (const pattern of METRO_PATTERNS) {
    const match = rawLocation.match(pattern);
    if (match) {
      location.region = match[1].trim();
      location.locationType = "metropolitan";
      // Try to extract country if present
      const parts = rawLocation.split(",").map((p) => p.trim());
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        if (COUNTRY_CODES[lastPart]) {
          location.country = lastPart;
          location.countryCode = COUNTRY_CODES[lastPart];
        }
      }
      return location;
    }
  }

  // Split by comma for standard city, state, country format
  const parts = rawLocation.split(",").map((p) => p.trim());

  if (parts.length === 1) {
    // Single part - could be city, region, or country
    location.city = parts[0];
    location.locationType = "city";
    return location;
  }

  if (parts.length === 2) {
    // Two parts: likely "City, State" (US) or "City, Country"
    const [firstPart, secondPart] = parts;

    // Check if second part is a US state code
    if (US_STATES[secondPart.toUpperCase()]) {
      location.city = firstPart;
      location.stateCode = secondPart.toUpperCase();
      location.state = US_STATES[location.stateCode];
      location.country = "United States";
      location.countryCode = "US";
      location.locationType = "city";
    }
    // Check if second part is a US state full name
    else if (US_STATE_NAME_TO_CODE[secondPart.toLowerCase()]) {
      location.city = firstPart;
      location.state = secondPart;
      location.stateCode = US_STATE_NAME_TO_CODE[secondPart.toLowerCase()];
      location.country = "United States";
      location.countryCode = "US";
      location.locationType = "city";
    }
    // Otherwise assume "City, Country"
    else {
      location.city = firstPart;
      location.country = secondPart;
      location.countryCode = COUNTRY_CODES[secondPart] || null;
      location.locationType = "city";
    }

    return location;
  }

  if (parts.length === 3) {
    // Three parts: "City, State/Province, Country"
    const [city, stateOrProvince, country] = parts;

    location.city = city;
    location.country = country;
    location.countryCode = COUNTRY_CODES[country] || null;

    // Check if this is US
    if (
      country === "United States" ||
      US_STATES[stateOrProvince.toUpperCase()] ||
      US_STATE_NAME_TO_CODE[stateOrProvince.toLowerCase()]
    ) {
      if (US_STATES[stateOrProvince.toUpperCase()]) {
        location.stateCode = stateOrProvince.toUpperCase();
        location.state = US_STATES[location.stateCode];
      } else if (US_STATE_NAME_TO_CODE[stateOrProvince.toLowerCase()]) {
        location.state = stateOrProvince;
        location.stateCode =
          US_STATE_NAME_TO_CODE[stateOrProvince.toLowerCase()];
      } else {
        location.state = stateOrProvince;
      }
      location.locationType = "city";
    } else {
      // Non-US: treat middle part as province/region
      location.province = stateOrProvince;
      location.locationType = "city";
    }

    return location;
  }

  // Four or more parts - unusual, take best guess
  if (parts.length >= 4) {
    location.city = parts[0];
    location.province = parts[1];
    location.country = parts[parts.length - 1];
    location.countryCode = COUNTRY_CODES[location.country] || null;
    location.locationType = "city";
  }

  return location;
}

/**
 * Batch parse locations from an array
 * @param {Array<string>} locations - Array of raw location strings
 * @returns {Array<object>} Array of structured location objects
 */
function batchParseLocations(locations) {
  return locations.map((loc) => parseLocation(loc));
}

module.exports = {
  parseLocation,
  batchParseLocations,
};
