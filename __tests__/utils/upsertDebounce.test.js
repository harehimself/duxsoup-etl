jest.mock("../../src/constants/limits", () => ({
  DEBOUNCE_WINDOW_MS: 100, // short window for fast tests
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
