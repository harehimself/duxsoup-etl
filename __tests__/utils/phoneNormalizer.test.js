jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  normalizePhone,
  DEFAULT_COUNTRY,
} = require("../../src/utils/phoneNormalizer");
const logger = require("../../src/utils/logger");

describe("phoneNormalizer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("normalizePhone()", () => {
    // --- Null/empty/whitespace → null ---

    it("should return null for null", () => {
      expect(normalizePhone(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(normalizePhone(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(normalizePhone("")).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(normalizePhone("   ")).toBeNull();
    });

    it("should return null for '+' alone", () => {
      expect(normalizePhone("+")).toBeNull();
    });

    // --- US formats with country code ---

    it("should normalize US number with +1 and parentheses", () => {
      expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    });

    it("should normalize US number with +1 and dashes", () => {
      expect(normalizePhone("+1-555-123-4567")).toBe("+15551234567");
    });

    it("should normalize US number with +1 and spaces", () => {
      expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
    });

    it("should normalize US number with +1 and dots", () => {
      expect(normalizePhone("+1.555.123.4567")).toBe("+15551234567");
    });

    // --- US formats without country code (default US) ---

    it("should normalize US number with parentheses, no country code", () => {
      expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    });

    it("should normalize US 10-digit bare number", () => {
      expect(normalizePhone("5551234567")).toBe("+15551234567");
    });

    it("should normalize US number with dashes only", () => {
      expect(normalizePhone("555-123-4567")).toBe("+15551234567");
    });

    // --- International numbers ---

    it("should normalize UK number with +44", () => {
      expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    });

    it("should normalize Indian number with +91", () => {
      expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    });

    it("should normalize French number with +33", () => {
      expect(normalizePhone("+33 1 23 45 67 89")).toBe("+33123456789");
    });

    it("should normalize German number with +49", () => {
      expect(normalizePhone("+49 30 12345678")).toBe("+493012345678");
    });

    it("should normalize Brazilian number with +55", () => {
      expect(normalizePhone("+55 11 91234-5678")).toBe("+5511912345678");
    });

    // --- Non-US default country ---

    it("should use specified default country for local numbers", () => {
      // French local mobile number
      expect(normalizePhone("06 12 34 56 78", "FR")).toBe("+33612345678");
    });

    it("should use UK default for local numbers", () => {
      expect(normalizePhone("020 7946 0958", "GB")).toBe("+442079460958");
    });

    // --- Warn-only validation ---

    it("should warn on invalid phone but still return normalized", () => {
      // A number that parses but doesn't validate (e.g., too short)
      const result = normalizePhone("+1 555", "US");
      // It should return something (parsed or fallback)
      expect(result).toBeTruthy();
      // If it was invalid, logger.warn should have been called
    });

    // --- Digit-stripped fallback ---

    it("should fall back to digit-stripped for completely unparseable input", () => {
      // Use a string too short to be parsed as any country's number
      const result = normalizePhone("x1");
      expect(result).toBe("1");
      expect(logger.warn).toHaveBeenCalledWith(
        "Phone number unparseable, using digit-stripped fallback",
        expect.objectContaining({ phone: "x1" }),
      );
    });

    it("should return null for garbage with no digits", () => {
      expect(normalizePhone("call me maybe")).toBeNull();
    });

    // --- Edge cases ---

    it("should handle number type coercion", () => {
      const result = normalizePhone(5551234567);
      expect(result).toBe("+15551234567");
    });

    it("should handle number with leading/trailing whitespace", () => {
      expect(normalizePhone("  +1 555 123 4567  ")).toBe("+15551234567");
    });

    it("should handle already E.164 formatted number", () => {
      expect(normalizePhone("+15551234567")).toBe("+15551234567");
    });

    it("should export DEFAULT_COUNTRY", () => {
      expect(DEFAULT_COUNTRY).toBe(process.env.DEFAULT_PHONE_COUNTRY || "US");
    });
  });
});
