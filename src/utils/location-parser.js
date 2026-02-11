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

const { getUSRegionData } = require("./us-regions");

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
  /^greater\s+(.+?)\s+area$/i, // Greater Tampa Bay Area
  /^greater\s+(.+)$/i, // Greater Boston, Greater Philadelphia
  /^(.+?)\s+metropolitan\s+area$/i, // New York City Metropolitan Area
  /^(.+?)\s+metro\s+area$/i, // Denver Metro Area
  /^(.+?)\s+metro$/i, // Charlotte Metro
  /^(.+?)\s+metroplex$/i, // Dallas-Fort Worth Metroplex
  /^(.+?)\s+bay\s+area$/i, // San Francisco Bay Area
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

// Major US cities to state mapping (for inferring state from city name)
const MAJOR_US_CITIES = {
  "los angeles": { state: "California", stateCode: "CA" },
  "san francisco": { state: "California", stateCode: "CA" },
  "san diego": { state: "California", stateCode: "CA" },
  "san jose": { state: "California", stateCode: "CA" },
  "new york": { state: "New York", stateCode: "NY" },
  "new york city": { state: "New York", stateCode: "NY" },
  chicago: { state: "Illinois", stateCode: "IL" },
  houston: { state: "Texas", stateCode: "TX" },
  dallas: { state: "Texas", stateCode: "TX" },
  "fort worth": { state: "Texas", stateCode: "TX" },
  "dallas-fort worth": { state: "Texas", stateCode: "TX" },
  austin: { state: "Texas", stateCode: "TX" },
  phoenix: { state: "Arizona", stateCode: "AZ" },
  philadelphia: { state: "Pennsylvania", stateCode: "PA" },
  seattle: { state: "Washington", stateCode: "WA" },
  boston: { state: "Massachusetts", stateCode: "MA" },
  atlanta: { state: "Georgia", stateCode: "GA" },
  miami: { state: "Florida", stateCode: "FL" },
  "fort lauderdale": { state: "Florida", stateCode: "FL" },
  "miami-fort lauderdale": { state: "Florida", stateCode: "FL" },
  tampa: { state: "Florida", stateCode: "FL" },
  denver: { state: "Colorado", stateCode: "CO" },
  portland: { state: "Oregon", stateCode: "OR" },
  detroit: { state: "Michigan", stateCode: "MI" },
  minneapolis: { state: "Minnesota", stateCode: "MN" },
  "minneapolis-st. paul": { state: "Minnesota", stateCode: "MN" },
  "las vegas": { state: "Nevada", stateCode: "NV" },
  nashville: { state: "Tennessee", stateCode: "TN" },
  baltimore: { state: "Maryland", stateCode: "MD" },
  "washington dc-baltimore": { state: "Maryland", stateCode: "MD" },
  charlotte: { state: "North Carolina", stateCode: "NC" },
  orlando: { state: "Florida", stateCode: "FL" },
  "salt lake city": { state: "Utah", stateCode: "UT" },
  raleigh: { state: "North Carolina", stateCode: "NC" },
  "raleigh-durham": { state: "North Carolina", stateCode: "NC" },
  "raleigh-durham-chapel hill": { state: "North Carolina", stateCode: "NC" },
  sacramento: { state: "California", stateCode: "CA" },
  "kansas city": { state: "Missouri", stateCode: "MO" },
  "st. louis": { state: "Missouri", stateCode: "MO" },
  pittsburgh: { state: "Pennsylvania", stateCode: "PA" },
  indianapolis: { state: "Indiana", stateCode: "IN" },
  columbus: { state: "Ohio", stateCode: "OH" },
  cleveland: { state: "Ohio", stateCode: "OH" },
  cincinnati: { state: "Ohio", stateCode: "OH" },
  milwaukee: { state: "Wisconsin", stateCode: "WI" },
  "tampa bay": { state: "Florida", stateCode: "FL" },
  "san antonio": { state: "Texas", stateCode: "TX" },
  syracuse: { state: "New York", stateCode: "NY" },
  "syracuse-auburn": { state: "New York", stateCode: "NY" },
  buffalo: { state: "New York", stateCode: "NY" },
  "buffalo-niagara falls": { state: "New York", stateCode: "NY" },
  brooklyn: { state: "New York", stateCode: "NY" },
};

/**
 * Infer state from city name for major US metropolitan areas
 * @param {string} cityName - The city name
 * @returns {object|null} State information or null
 */
function inferStateFromCity(cityName) {
  if (!cityName) return null;
  return MAJOR_US_CITIES[cityName.toLowerCase()] || null;
}

/**
 * Enrich a parsed location object with US region data when a US state code is present.
 * Adds usRegion, usSubregion, timezone, and utcOffset fields.
 *
 * @param {object} location - Parsed location object with stateCode field
 * @returns {object} Same location object with region fields added
 */
function enrichWithUSRegion(location) {
  const regionData = getUSRegionData(location.stateCode);
  if (regionData) {
    location.usRegion = regionData.usRegion;
    location.usSubregion = regionData.usSubregion;
    location.timezone = regionData.timezone;
    location.utcOffset = regionData.utcOffset;
  } else {
    location.usRegion = null;
    location.usSubregion = null;
    location.timezone = null;
    location.utcOffset = null;
  }
  return location;
}

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
      usRegion: null,
      usSubregion: null,
      timezone: null,
      utcOffset: null,
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
    usRegion: null,
    usSubregion: null,
    timezone: null,
    utcOffset: null,
  };

  // Check for metropolitan area patterns
  for (const pattern of METRO_PATTERNS) {
    const match = rawLocation.match(pattern);
    if (match) {
      const coreLocation = match[1].trim();
      location.region = coreLocation;
      location.locationType = "metropolitan";

      // Parse the core location (e.g., "Los Angeles" from "Los Angeles Metropolitan Area")
      // to extract city, state, country information
      const coreParts = coreLocation.split(",").map((p) => p.trim());

      if (coreParts.length === 1) {
        // Single part metro area (e.g., "Los Angeles")
        // Try to match known US cities to infer state
        location.city = coreParts[0];
        // For major US metro areas, infer the state
        const inferredState = inferStateFromCity(coreParts[0]);
        if (inferredState) {
          location.state = inferredState.state;
          location.stateCode = inferredState.stateCode;
          location.country = "United States";
          location.countryCode = "US";
        }
      } else if (coreParts.length === 2) {
        // Two parts (e.g., "Los Angeles, California" or "Tampa Bay, FL")
        location.city = coreParts[0];
        const secondPart = coreParts[1];

        // Check if second part is a US state
        if (US_STATES[secondPart.toUpperCase()]) {
          location.stateCode = secondPart.toUpperCase();
          location.state = US_STATES[location.stateCode];
          location.country = "United States";
          location.countryCode = "US";
        } else if (US_STATE_NAME_TO_CODE[secondPart.toLowerCase()]) {
          location.state = secondPart;
          location.stateCode = US_STATE_NAME_TO_CODE[secondPart.toLowerCase()];
          location.country = "United States";
          location.countryCode = "US";
        } else {
          // Assume country
          location.country = secondPart;
          location.countryCode = COUNTRY_CODES[secondPart] || null;
        }
      } else if (coreParts.length >= 3) {
        // Three or more parts (e.g., "Los Angeles, California, United States")
        location.city = coreParts[0];
        const stateOrProvince = coreParts[1];
        location.country = coreParts[coreParts.length - 1];
        location.countryCode = COUNTRY_CODES[location.country] || null;

        if (US_STATES[stateOrProvince.toUpperCase()]) {
          location.stateCode = stateOrProvince.toUpperCase();
          location.state = US_STATES[location.stateCode];
        } else if (US_STATE_NAME_TO_CODE[stateOrProvince.toLowerCase()]) {
          location.state = stateOrProvince;
          location.stateCode =
            US_STATE_NAME_TO_CODE[stateOrProvince.toLowerCase()];
        } else {
          location.province = stateOrProvince;
        }
      }

      return enrichWithUSRegion(location);
    }
  }

  // Split by comma for standard city, state, country format
  const parts = rawLocation.split(",").map((p) => p.trim());

  if (parts.length === 1) {
    // Single part - could be city, region, or country
    location.city = parts[0];
    location.locationType = "city";
    return enrichWithUSRegion(location);
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

    return enrichWithUSRegion(location);
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

    return enrichWithUSRegion(location);
  }

  // Four or more parts - unusual, take best guess
  if (parts.length >= 4) {
    location.city = parts[0];
    location.province = parts[1];
    location.country = parts[parts.length - 1];
    location.countryCode = COUNTRY_CODES[location.country] || null;
    location.locationType = "city";
  }

  return enrichWithUSRegion(location);
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
