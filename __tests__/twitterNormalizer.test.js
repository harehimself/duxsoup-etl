jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { normalizeTwitter } = require("../src/utils/twitterNormalizer");
const logger = require("../src/utils/logger");

describe("normalizeTwitter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("null/empty guards", () => {
    it("should return null for null", () => {
      expect(normalizeTwitter(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(normalizeTwitter(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(normalizeTwitter("")).toBeNull();
    });

    it("should return null for non-string input", () => {
      expect(normalizeTwitter(12345)).toBeNull();
      expect(normalizeTwitter({})).toBeNull();
      expect(normalizeTwitter([])).toBeNull();
      expect(normalizeTwitter(true)).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(normalizeTwitter("   ")).toBeNull();
    });
  });

  describe("bare handles", () => {
    it("should return bare handle unchanged (lowercase)", () => {
      expect(normalizeTwitter("johndoe")).toBe("johndoe");
    });

    it("should strip leading @", () => {
      expect(normalizeTwitter("@johndoe")).toBe("johndoe");
    });

    it("should lowercase mixed case", () => {
      expect(normalizeTwitter("@JohnDoe")).toBe("johndoe");
    });

    it("should trim whitespace", () => {
      expect(normalizeTwitter("  @johndoe  ")).toBe("johndoe");
    });

    it("should handle underscores and numbers", () => {
      expect(normalizeTwitter("john_doe_123")).toBe("john_doe_123");
    });
  });

  describe("URL extraction", () => {
    it("should extract handle from twitter.com URL", () => {
      expect(normalizeTwitter("https://twitter.com/johndoe")).toBe("johndoe");
    });

    it("should extract handle from x.com URL", () => {
      expect(normalizeTwitter("https://x.com/johndoe")).toBe("johndoe");
    });

    it("should handle trailing slash", () => {
      expect(normalizeTwitter("https://twitter.com/johndoe/")).toBe("johndoe");
    });

    it("should handle query params", () => {
      expect(normalizeTwitter("https://twitter.com/johndoe?ref=xyz")).toBe(
        "johndoe",
      );
    });

    it("should handle URL with fragment", () => {
      expect(normalizeTwitter("https://twitter.com/johndoe#section")).toBe(
        "johndoe",
      );
    });

    it("should handle http:// URL", () => {
      expect(normalizeTwitter("http://twitter.com/johndoe")).toBe("johndoe");
    });

    it("should handle www prefix", () => {
      expect(normalizeTwitter("https://www.twitter.com/johndoe")).toBe(
        "johndoe",
      );
    });

    it("should handle URL without protocol", () => {
      expect(normalizeTwitter("twitter.com/johndoe")).toBe("johndoe");
    });

    it("should lowercase handle from URL", () => {
      expect(normalizeTwitter("https://twitter.com/JohnDoe")).toBe("johndoe");
    });
  });

  describe("format validation (warn-only)", () => {
    it("should warn on handles with invalid characters", () => {
      const result = normalizeTwitter("john-doe");
      expect(result).toBe("john-doe");
      expect(logger.warn).toHaveBeenCalledWith(
        "Twitter handle fails format validation",
        { twitter: "john-doe" },
      );
    });

    it("should warn on handles exceeding 15 characters", () => {
      const longHandle = "a".repeat(16);
      const result = normalizeTwitter(longHandle);
      expect(result).toBe(longHandle);
      expect(logger.warn).toHaveBeenCalledWith(
        "Twitter handle fails format validation",
        { twitter: longHandle },
      );
    });

    it("should not warn on valid handles", () => {
      normalizeTwitter("valid_handle");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should not warn on handles with underscores and numbers", () => {
      normalizeTwitter("user_123");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
