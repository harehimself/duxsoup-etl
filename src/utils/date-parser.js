/**
 * Date Parser Utility
 *
 * Safely parses date strings and returns null for invalid dates
 * instead of Invalid Date objects that Mongoose rejects.
 */

/**
 * Safely parse a date string, returning null if invalid
 * @param {string|Date|null|undefined} dateValue - The date value to parse
 * @returns {Date|null} Valid Date object or null
 */
function parseSafeDate(dateValue) {
  // Handle null, undefined, or empty string
  if (!dateValue || dateValue === "") {
    return null;
  }

  // If already a Date object, validate it
  if (dateValue instanceof Date) {
    return isNaN(dateValue.getTime()) ? null : dateValue;
  }

  // Try to parse the date
  const parsed = new Date(dateValue);

  // Check if the result is a valid date
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

/**
 * Parse a LinkedIn date string (e.g., "2020", "Jan 2020", "Present")
 * @param {string} dateValue - The LinkedIn date string
 * @returns {Date|null} Parsed date or null
 */
function parseLinkedInDate(dateValue) {
  // Handle special cases
  if (!dateValue || dateValue === "" || dateValue === "Present") {
    return null;
  }

  // Try safe parsing first
  return parseSafeDate(dateValue);
}

module.exports = {
  parseSafeDate,
  parseLinkedInDate,
};
