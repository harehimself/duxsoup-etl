const {
  parseSafeDate,
  parseLinkedInDate,
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
});
