const {
  parseSafeDate,
  parseLinkedInDate,
  containsYear,
  parseBirthdayDate,
} = require("../../src/utils/date-parser");

describe("Date Parser Utility", () => {
  describe("parseSafeDate()", () => {
    it("should return null for null input", () => {
      expect(parseSafeDate(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(parseSafeDate(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseSafeDate("")).toBeNull();
    });

    it("should return null for invalid date string", () => {
      expect(parseSafeDate("not a date")).toBeNull();
    });

    it("should return null for N/A", () => {
      expect(parseSafeDate("N/A")).toBeNull();
    });

    it("should parse valid ISO date string", () => {
      const result = parseSafeDate("2024-01-15");
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
      // Just verify it's a valid date, timezone differences are OK
    });

    it("should parse valid date string", () => {
      const result = parseSafeDate("January 15, 2024");
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
    });

    it("should handle Date objects - valid", () => {
      const validDate = new Date("2024-01-15");
      const result = parseSafeDate(validDate);
      expect(result).toBeInstanceOf(Date);
      expect(result).toBe(validDate);
    });

    it("should return null for Invalid Date objects", () => {
      const invalidDate = new Date("invalid");
      expect(parseSafeDate(invalidDate)).toBeNull();
    });

    it("should parse year-only strings", () => {
      const result = parseSafeDate("2024");
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it("should parse month-year strings", () => {
      const result = parseSafeDate("Jan 2024");
      expect(result).toBeInstanceOf(Date);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
    });
  });

  describe("parseLinkedInDate()", () => {
    it("should return null for Present", () => {
      expect(parseLinkedInDate("Present")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parseLinkedInDate("")).toBeNull();
    });

    it("should return null for null", () => {
      expect(parseLinkedInDate(null)).toBeNull();
    });

    it("should parse year-only format", () => {
      const result = parseLinkedInDate("2020");
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it("should parse month-year format", () => {
      const result = parseLinkedInDate("Jan 2020");
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it("should parse full date format", () => {
      const result = parseLinkedInDate("2020-01-15");
      expect(result).toBeInstanceOf(Date);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it("should return null for invalid dates", () => {
      expect(parseLinkedInDate("invalid")).toBeNull();
    });
  });

  describe("containsYear()", () => {
    it("should return true for ISO date", () => {
      expect(containsYear("2024-01-15")).toBe(true);
    });

    it("should return true for month-day-year", () => {
      expect(containsYear("March 14, 1990")).toBe(true);
    });

    it("should return true for year-only", () => {
      expect(containsYear("1990")).toBe(true);
    });

    it("should return true for month-year", () => {
      expect(containsYear("Jan 2024")).toBe(true);
    });

    it("should return false for month-day only", () => {
      expect(containsYear("March 14")).toBe(false);
    });

    it("should return false for abbreviated month-day", () => {
      expect(containsYear("Jan 5")).toBe(false);
    });

    it("should return false for numeric month/day without year", () => {
      expect(containsYear("12/25")).toBe(false);
    });

    it("should return false for non-string input", () => {
      expect(containsYear(null)).toBe(false);
      expect(containsYear(undefined)).toBe(false);
      expect(containsYear(42)).toBe(false);
    });

    it("should not match 2-digit numbers as years", () => {
      expect(containsYear("March 14")).toBe(false);
      expect(containsYear("12/25")).toBe(false);
    });
  });

  describe("parseBirthdayDate()", () => {
    it("should return date for full date with year", () => {
      const result = parseBirthdayDate("March 14, 1990");
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date.getFullYear()).toBe(1990);
      expect(result.raw).toBeNull();
    });

    it("should return date for ISO date string", () => {
      const result = parseBirthdayDate("1990-03-14");
      expect(result.date).toBeInstanceOf(Date);
      expect(result.raw).toBeNull();
    });

    it("should return raw for month-day without year (March 14)", () => {
      const result = parseBirthdayDate("March 14");
      expect(result.date).toBeNull();
      expect(result.raw).toBe("March 14");
    });

    it("should return raw for abbreviated month-day (Jan 5)", () => {
      const result = parseBirthdayDate("Jan 5");
      expect(result.date).toBeNull();
      expect(result.raw).toBe("Jan 5");
    });

    it("should return raw for month-day (January 5)", () => {
      const result = parseBirthdayDate("January 5");
      expect(result.date).toBeNull();
      expect(result.raw).toBe("January 5");
    });

    it("should return both null for null input", () => {
      const result = parseBirthdayDate(null);
      expect(result.date).toBeNull();
      expect(result.raw).toBeNull();
    });

    it("should return both null for empty string", () => {
      const result = parseBirthdayDate("");
      expect(result.date).toBeNull();
      expect(result.raw).toBeNull();
    });

    it("should return both null for undefined", () => {
      const result = parseBirthdayDate(undefined);
      expect(result.date).toBeNull();
      expect(result.raw).toBeNull();
    });

    it("should handle Date objects directly", () => {
      const d = new Date("1990-03-14");
      const result = parseBirthdayDate(d);
      expect(result.date).toBe(d);
      expect(result.raw).toBeNull();
    });

    it("should return null date for Invalid Date object", () => {
      const result = parseBirthdayDate(new Date("invalid"));
      expect(result.date).toBeNull();
      expect(result.raw).toBeNull();
    });

    it("should trim whitespace from raw birthday string", () => {
      const result = parseBirthdayDate("  March 14  ");
      expect(result.date).toBeNull();
      expect(result.raw).toBe("March 14");
    });

    it("should not fabricate year 2001 for year-less birthday", () => {
      // This is the core bug: new Date("March 14") → 2001-03-14
      const result = parseBirthdayDate("March 14");
      expect(result.date).toBeNull();
      // Ensure we never get a Date with year 2001
      expect(result.raw).toBe("March 14");
    });

    it("should accept full birthday with year (December 25, 1985)", () => {
      const result = parseBirthdayDate("December 25, 1985");
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date.getFullYear()).toBe(1985);
      expect(result.date.getMonth()).toBe(11);
      expect(result.raw).toBeNull();
    });
  });
});
