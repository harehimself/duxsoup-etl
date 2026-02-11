/**
 * US Region Categorization Utility
 *
 * Maps US state codes to Census Bureau regions, subregions,
 * primary IANA timezones, and standard UTC offsets.
 *
 * Region/subregion taxonomy:
 *   Northeast: New England, Mid-Atlantic
 *   Midwest:   East North Central, West North Central
 *   Southeast: Lower South, Upper South, Delta
 *   Southwest: Four Corners, Southern Plains, Great Basin
 *   West:      Pacific, Mountain
 */

const US_REGION_DATA = {
  // Northeast — New England
  CT: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  ME: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  MA: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  NH: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  RI: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  VT: {
    usRegion: "Northeast",
    usSubregion: "New England",
    timezone: "America/New_York",
    utcOffset: -5,
  },

  // Northeast — Mid-Atlantic
  DE: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  DC: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  MD: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  NJ: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  NY: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  PA: {
    usRegion: "Northeast",
    usSubregion: "Mid-Atlantic",
    timezone: "America/New_York",
    utcOffset: -5,
  },

  // Midwest — East North Central
  IL: {
    usRegion: "Midwest",
    usSubregion: "East North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  IN: {
    usRegion: "Midwest",
    usSubregion: "East North Central",
    timezone: "America/Indiana/Indianapolis",
    utcOffset: -5,
  },
  MI: {
    usRegion: "Midwest",
    usSubregion: "East North Central",
    timezone: "America/Detroit",
    utcOffset: -5,
  },
  OH: {
    usRegion: "Midwest",
    usSubregion: "East North Central",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  WI: {
    usRegion: "Midwest",
    usSubregion: "East North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },

  // Midwest — West North Central
  IA: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  KS: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  MN: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  MO: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  NE: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  ND: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  SD: {
    usRegion: "Midwest",
    usSubregion: "West North Central",
    timezone: "America/Chicago",
    utcOffset: -6,
  },

  // Southeast — Lower South
  AL: {
    usRegion: "Southeast",
    usSubregion: "Lower South",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  FL: {
    usRegion: "Southeast",
    usSubregion: "Lower South",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  GA: {
    usRegion: "Southeast",
    usSubregion: "Lower South",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  MS: {
    usRegion: "Southeast",
    usSubregion: "Lower South",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  SC: {
    usRegion: "Southeast",
    usSubregion: "Lower South",
    timezone: "America/New_York",
    utcOffset: -5,
  },

  // Southeast — Upper South
  KY: {
    usRegion: "Southeast",
    usSubregion: "Upper South",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  NC: {
    usRegion: "Southeast",
    usSubregion: "Upper South",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  TN: {
    usRegion: "Southeast",
    usSubregion: "Upper South",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  VA: {
    usRegion: "Southeast",
    usSubregion: "Upper South",
    timezone: "America/New_York",
    utcOffset: -5,
  },
  WV: {
    usRegion: "Southeast",
    usSubregion: "Upper South",
    timezone: "America/New_York",
    utcOffset: -5,
  },

  // Southeast — Delta
  AR: {
    usRegion: "Southeast",
    usSubregion: "Delta",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  LA: {
    usRegion: "Southeast",
    usSubregion: "Delta",
    timezone: "America/Chicago",
    utcOffset: -6,
  },

  // Southwest — Four Corners
  AZ: {
    usRegion: "Southwest",
    usSubregion: "Four Corners",
    timezone: "America/Phoenix",
    utcOffset: -7,
  },
  CO: {
    usRegion: "Southwest",
    usSubregion: "Four Corners",
    timezone: "America/Denver",
    utcOffset: -7,
  },
  NM: {
    usRegion: "Southwest",
    usSubregion: "Four Corners",
    timezone: "America/Denver",
    utcOffset: -7,
  },
  UT: {
    usRegion: "Southwest",
    usSubregion: "Four Corners",
    timezone: "America/Denver",
    utcOffset: -7,
  },

  // Southwest — Southern Plains
  OK: {
    usRegion: "Southwest",
    usSubregion: "Southern Plains",
    timezone: "America/Chicago",
    utcOffset: -6,
  },
  TX: {
    usRegion: "Southwest",
    usSubregion: "Southern Plains",
    timezone: "America/Chicago",
    utcOffset: -6,
  },

  // Southwest — Great Basin
  NV: {
    usRegion: "Southwest",
    usSubregion: "Great Basin",
    timezone: "America/Los_Angeles",
    utcOffset: -8,
  },

  // West — Pacific
  AK: {
    usRegion: "West",
    usSubregion: "Pacific",
    timezone: "America/Anchorage",
    utcOffset: -9,
  },
  CA: {
    usRegion: "West",
    usSubregion: "Pacific",
    timezone: "America/Los_Angeles",
    utcOffset: -8,
  },
  HI: {
    usRegion: "West",
    usSubregion: "Pacific",
    timezone: "Pacific/Honolulu",
    utcOffset: -10,
  },
  OR: {
    usRegion: "West",
    usSubregion: "Pacific",
    timezone: "America/Los_Angeles",
    utcOffset: -8,
  },
  WA: {
    usRegion: "West",
    usSubregion: "Pacific",
    timezone: "America/Los_Angeles",
    utcOffset: -8,
  },

  // West — Mountain
  ID: {
    usRegion: "West",
    usSubregion: "Mountain",
    timezone: "America/Boise",
    utcOffset: -7,
  },
  MT: {
    usRegion: "West",
    usSubregion: "Mountain",
    timezone: "America/Denver",
    utcOffset: -7,
  },
  WY: {
    usRegion: "West",
    usSubregion: "Mountain",
    timezone: "America/Denver",
    utcOffset: -7,
  },
};

/**
 * Look up US region data for a given state code.
 *
 * @param {string|null|undefined} stateCode - Two-letter US state code (e.g., "CA", "NY")
 * @returns {{ usRegion: string, usSubregion: string, timezone: string, utcOffset: number } | null}
 *   Region data or null if not a recognized US state code
 */
function getUSRegionData(stateCode) {
  if (!stateCode || typeof stateCode !== "string") return null;
  return US_REGION_DATA[stateCode.toUpperCase()] || null;
}

module.exports = {
  getUSRegionData,
  US_REGION_DATA,
};
