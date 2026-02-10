jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/constants/limits", () => ({
  DEBOUNCE_WINDOW_MS: 100, // short window for fast tests
  MAX_DEBOUNCE_CACHE_SIZE: 5, // small size for eviction tests
}));

const {
  shouldSkip,
  clear,
  getStats,
} = require("../../src/utils/upsertDebounce");

describe("upsertDebounce", () => {
  afterEach(() => {
    clear();
  });

  describe("shouldSkip()", () => {
    it("should return false on the first call for a key", () => {
      expect(shouldSkip("pid.abc")).toBe(false);
    });

    it("should return true on the second call within the debounce window", () => {
      shouldSkip("pid.abc");
      expect(shouldSkip("pid.abc")).toBe(true);
    });

    it("should return false again after the debounce window expires", async () => {
      shouldSkip("pid.abc");
      expect(shouldSkip("pid.abc")).toBe(true);

      // Wait for the 100 ms window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(shouldSkip("pid.abc")).toBe(false);
    });

    it("should not interfere between different keys", () => {
      shouldSkip("pid.abc");
      expect(shouldSkip("pid.xyz")).toBe(false); // different key
      expect(shouldSkip("pid.abc")).toBe(true); // same key still debounced
    });

    it("should clean up expired entries on each call", async () => {
      shouldSkip("pid.old");

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Trigger cleanup via a new call
      shouldSkip("pid.new");

      const stats = getStats();
      expect(stats.keys).not.toContain("pid.old");
      expect(stats.keys).toContain("pid.new");
    });
  });

  describe("clear()", () => {
    it("should reset all debounce state", () => {
      shouldSkip("pid.abc");
      shouldSkip("pid.xyz");
      expect(getStats().size).toBe(2);

      clear();

      expect(getStats().size).toBe(0);
      // Previously-debounced key should now proceed
      expect(shouldSkip("pid.abc")).toBe(false);
    });
  });

  describe("max size eviction", () => {
    it("should evict oldest entries when cache reaches MAX_DEBOUNCE_CACHE_SIZE", () => {
      // Fill cache to capacity (MAX_DEBOUNCE_CACHE_SIZE = 5)
      for (let i = 0; i < 5; i++) {
        shouldSkip(`pid.${i}`);
      }
      expect(getStats().size).toBe(5);

      // Adding one more should trigger eviction
      shouldSkip("pid.new");

      // Cache should not exceed max size
      expect(getStats().size).toBeLessThanOrEqual(5);
      // The new entry should be present
      expect(getStats().keys).toContain("pid.new");
    });

    it("should log a warning when eviction occurs", () => {
      const logger = require("../../src/utils/logger");
      for (let i = 0; i < 5; i++) {
        shouldSkip(`pid.evict.${i}`);
      }
      logger.warn.mockClear();

      shouldSkip("pid.evict.trigger");

      expect(logger.warn).toHaveBeenCalledWith(
        "Debounce cache at capacity, evicted oldest entries",
        expect.objectContaining({ maxSize: 5 }),
      );
    });
  });

  describe("getStats()", () => {
    it("should return size and keys of the cache", () => {
      shouldSkip("pid.a");
      shouldSkip("pid.b");

      const stats = getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toEqual(expect.arrayContaining(["pid.a", "pid.b"]));
    });
  });
});
