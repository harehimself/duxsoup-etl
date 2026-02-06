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

/**
 * Check whether a date string contains an explicit 4-digit year.
 * Rejects strings like "March 14", "Jan 5", "12/25" that Node's Date()
 * silently coerces to year 2001.
 * @param {string} value - The raw date string
 * @returns {boolean} true if a 4-digit year is present
 */
function containsYear(value) {
  if (typeof value !== "string") return false;
  return /\b\d{4}\b/.test(value);
}

/**
 * Parse a birthday date string, rejecting year-less inputs.
 * LinkedIn commonly sends birthdays as "March 14" (no year), which
 * Node coerces to 2001-03-14. This function detects that case and
 * returns the raw string instead so the caller can store it separately.
 *
 * @param {string|Date|null|undefined} dateValue - The birthday value
 * @returns {{ date: Date|null, raw: string|null }}
 *   - date: Valid Date when the input includes a year, null otherwise
 *   - raw: Original string when no year is present, null otherwise
 */
function parseBirthdayDate(dateValue) {
  if (!dateValue || dateValue === "") {
    return { date: null, raw: null };
  }

  // Already a Date object — trust it (caller constructed it)
  if (dateValue instanceof Date) {
    const valid = !isNaN(dateValue.getTime());
    return { date: valid ? dateValue : null, raw: null };
  }

  // String input — check for an explicit year before parsing
  if (typeof dateValue === "string") {
    if (!containsYear(dateValue)) {
      // Year-less input like "March 14" — return as raw, don't coerce
      return { date: null, raw: dateValue.trim() };
    }
  }

  // Has a year — parse normally
  const parsed = parseSafeDate(dateValue);
  return { date: parsed, raw: null };
}

module.exports = {
  parseSafeDate,
  parseLinkedInDate,
  containsYear,
  parseBirthdayDate,
};
