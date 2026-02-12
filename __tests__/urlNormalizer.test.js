const { ensureHttps } = require("../src/utils/urlNormalizer");

describe("urlNormalizer", () => {
  describe("ensureHttps()", () => {
    it("should convert http:// to https://", () => {
      expect(ensureHttps("http://example.com")).toBe("https://example.com");
    });

    it("should convert http:// URL with path", () => {
      expect(ensureHttps("http://www.acme.com/about")).toBe(
        "https://www.acme.com/about",
      );
    });

    it("should preserve existing https:// URLs", () => {
      expect(ensureHttps("https://example.com")).toBe("https://example.com");
    });

    it("should return null for null input", () => {
      expect(ensureHttps(null)).toBeNull();
    });

    it("should return undefined for undefined input", () => {
      expect(ensureHttps(undefined)).toBeUndefined();
    });

    it("should return empty string for empty string input", () => {
      expect(ensureHttps("")).toBe("");
    });

    it("should return non-string values unchanged", () => {
      expect(ensureHttps(42)).toBe(42);
      expect(ensureHttps(false)).toBe(false);
      expect(ensureHttps(0)).toBe(0);
    });

    it("should trim whitespace from URLs", () => {
      expect(ensureHttps("  https://example.com  ")).toBe(
        "https://example.com",
      );
    });

    it("should trim whitespace and convert http to https", () => {
      expect(ensureHttps("  http://example.com  ")).toBe("https://example.com");
    });

    it("should handle URLs without protocol unchanged", () => {
      expect(ensureHttps("www.example.com")).toBe("www.example.com");
    });

    it("should handle ftp:// URLs unchanged", () => {
      expect(ensureHttps("ftp://files.example.com")).toBe(
        "ftp://files.example.com",
      );
    });

    it("should handle HTTP in uppercase (case-sensitive, no conversion)", () => {
      // http:// check is case-sensitive — uppercase HTTP:// is not converted
      expect(ensureHttps("HTTP://example.com")).toBe("HTTP://example.com");
    });

    it("should handle real DuxSoup company website URLs", () => {
      expect(ensureHttps("http://www.salesforce.com")).toBe(
        "https://www.salesforce.com",
      );
      expect(ensureHttps("http://acme.io")).toBe("https://acme.io");
    });
  });
});
