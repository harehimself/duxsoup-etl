jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  validateUrl,
  validateAndEnsureHttps,
} = require("../src/utils/urlValidator");
const logger = require("../src/utils/logger");

describe("urlValidator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateUrl()", () => {
    // ── Valid URLs ──────────────────────────────────────

    it("should accept https:// URLs", () => {
      expect(validateUrl("https://example.com", "test")).toBe(
        "https://example.com",
      );
    });

    it("should accept http:// URLs", () => {
      expect(validateUrl("http://example.com", "test")).toBe(
        "http://example.com",
      );
    });

    it("should accept https URL with path", () => {
      expect(validateUrl("https://example.com/path/to/page", "test")).toBe(
        "https://example.com/path/to/page",
      );
    });

    it("should accept URL with query string", () => {
      expect(
        validateUrl("https://example.com/page?q=hello&page=2", "test"),
      ).toBe("https://example.com/page?q=hello&page=2");
    });

    it("should accept URL with fragment", () => {
      expect(validateUrl("https://example.com/page#section", "test")).toBe(
        "https://example.com/page#section",
      );
    });

    it("should accept URL with port", () => {
      expect(validateUrl("https://example.com:8080/api", "test")).toBe(
        "https://example.com:8080/api",
      );
    });

    it("should accept HTTP in uppercase (case-insensitive scheme check)", () => {
      expect(validateUrl("HTTPS://EXAMPLE.COM", "test")).toBe(
        "HTTPS://EXAMPLE.COM",
      );
    });

    it("should accept mixed case scheme", () => {
      expect(validateUrl("Http://example.com", "test")).toBe(
        "Http://example.com",
      );
    });

    it("should trim whitespace from valid URLs", () => {
      expect(validateUrl("  https://example.com  ", "test")).toBe(
        "https://example.com",
      );
    });

    // ── Invalid URLs ────────────────────────────────────

    it("should reject bare words and return null", () => {
      expect(validateUrl("hello", "test")).toBeNull();
    });

    it("should reject domain-only strings", () => {
      expect(validateUrl("example.com", "test")).toBeNull();
    });

    it("should reject www-prefixed domain without scheme", () => {
      expect(validateUrl("www.example.com", "test")).toBeNull();
    });

    it("should reject ftp:// URLs", () => {
      expect(validateUrl("ftp://files.example.com", "test")).toBeNull();
    });

    it("should reject empty string without warning", () => {
      const result = validateUrl("", "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should reject whitespace-only string without warning", () => {
      const result = validateUrl("   ", "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // ── Null/undefined/non-string ────────────────────────

    it("should return null for null without warning", () => {
      const result = validateUrl(null, "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should return null for undefined without warning", () => {
      const result = validateUrl(undefined, "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should return null for number without warning", () => {
      const result = validateUrl(42, "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should return null for boolean without warning", () => {
      const result = validateUrl(false, "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should return null for object without warning", () => {
      const result = validateUrl({ text: "hello" }, "test");
      expect(result).toBeNull();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // ── Warning logging ────────────────────────────────

    it("should log warning for invalid URL with field name context", () => {
      validateUrl("not-a-url", "profilePicture");

      expect(logger.warn).toHaveBeenCalledWith("Invalid URL format", {
        field: "profilePicture",
        value: "not-a-url",
      });
    });

    it("should log warning for bare domain", () => {
      validateUrl("example.com", "companyWebsite");

      expect(logger.warn).toHaveBeenCalledWith("Invalid URL format", {
        field: "companyWebsite",
        value: "example.com",
      });
    });

    it("should log warning for ftp:// URL", () => {
      validateUrl("ftp://files.example.com", "thumbnail");

      expect(logger.warn).toHaveBeenCalledWith("Invalid URL format", {
        field: "thumbnail",
        value: "ftp://files.example.com",
      });
    });

    it("should NOT log warning for valid URLs", () => {
      validateUrl("https://example.com", "test");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should NOT log warning for null/undefined/empty", () => {
      validateUrl(null, "test");
      validateUrl(undefined, "test");
      validateUrl("", "test");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("validateAndEnsureHttps()", () => {
    // ── Composed behavior ──────────────────────────────

    it("should validate and upgrade http to https", () => {
      expect(validateAndEnsureHttps("http://example.com", "test")).toBe(
        "https://example.com",
      );
    });

    it("should preserve already-https URLs", () => {
      expect(validateAndEnsureHttps("https://example.com", "test")).toBe(
        "https://example.com",
      );
    });

    it("should return null for non-URL strings", () => {
      expect(validateAndEnsureHttps("not-a-url", "test")).toBeNull();
    });

    it("should return null for null input", () => {
      expect(validateAndEnsureHttps(null, "test")).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(validateAndEnsureHttps(undefined, "test")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(validateAndEnsureHttps("", "test")).toBeNull();
    });

    it("should return null for bare domain (invalid URL)", () => {
      const result = validateAndEnsureHttps("example.com", "test");
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should trim whitespace and upgrade http to https", () => {
      expect(validateAndEnsureHttps("  http://example.com  ", "test")).toBe(
        "https://example.com",
      );
    });

    it("should handle URL with path after http-to-https upgrade", () => {
      expect(validateAndEnsureHttps("http://www.acme.com/about", "test")).toBe(
        "https://www.acme.com/about",
      );
    });

    // ── Integration: invalid URL rejected even if ensureHttps would accept ─

    it("should reject ftp:// even though ensureHttps passes it through", () => {
      expect(
        validateAndEnsureHttps("ftp://files.example.com", "test"),
      ).toBeNull();
    });

    it("should reject bare domain even though ensureHttps passes it through", () => {
      expect(validateAndEnsureHttps("www.example.com", "test")).toBeNull();
    });
  });
});
