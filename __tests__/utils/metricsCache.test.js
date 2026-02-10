jest.mock("../../src/constants/limits", () => ({
  MAX_METRICS_CACHE_SIZE: 3, // small for testing
}));

const {
  getOrFetch,
  invalidate,
  invalidateAll,
  getStats,
} = require("../../src/utils/metricsCache");

describe("MetricsCache", () => {
  beforeEach(() => {
    invalidateAll();
  });

  describe("getOrFetch()", () => {
    it("should call fetchFn on cache miss and return the result", async () => {
      const fetchFn = jest.fn().mockResolvedValue({ count: 42 });

      const result = await getOrFetch("test-key", fetchFn);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ count: 42 });
    });

    it("should return cached data on cache hit without calling fetchFn again", async () => {
      const fetchFn = jest.fn().mockResolvedValue({ count: 42 });

      await getOrFetch("test-key", fetchFn, 60000);
      const result = await getOrFetch("test-key", fetchFn, 60000);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ count: 42 });
    });

    it("should re-fetch when cache entry has expired", async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 2 });

      // Use a 1ms TTL so it expires immediately
      await getOrFetch("test-key", fetchFn, 1);

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 5));

      const result = await getOrFetch("test-key", fetchFn, 1);

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ count: 2 });
    });

    it("should bypass cache when ttlMs is 0", async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 2 });

      await getOrFetch("test-key", fetchFn, 60000);
      const result = await getOrFetch("test-key", fetchFn, 0);

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ count: 2 });
    });

    it("should not store result in cache when ttlMs is 0", async () => {
      const fetchFn = jest.fn().mockResolvedValue({ count: 1 });

      await getOrFetch("bypass-key", fetchFn, 0);

      expect(getStats().keys).not.toContain("bypass-key");
    });

    it("should support custom TTL per call", async () => {
      const fetchFn = jest
        .fn()
        .mockResolvedValueOnce("short")
        .mockResolvedValueOnce("refreshed");

      // Cache with 1ms TTL
      await getOrFetch("short-ttl", fetchFn, 1);
      await new Promise((r) => setTimeout(r, 5));

      const result = await getOrFetch("short-ttl", fetchFn, 60000);

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toBe("refreshed");
    });

    it("should propagate errors from fetchFn without caching", async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error("DB down"));

      await expect(getOrFetch("error-key", fetchFn)).rejects.toThrow("DB down");

      // Key should not be in cache
      expect(getStats().keys).not.toContain("error-key");
    });
  });

  describe("invalidate()", () => {
    it("should remove a single cache entry", async () => {
      const fetchFn = jest.fn().mockResolvedValue("data");

      await getOrFetch("a", fetchFn);
      await getOrFetch("b", fetchFn);

      invalidate("a");

      const stats = getStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toEqual(["b"]);
    });

    it("should be a no-op for non-existent keys", () => {
      expect(() => invalidate("nonexistent")).not.toThrow();
    });
  });

  describe("invalidateAll()", () => {
    it("should clear all cache entries", async () => {
      const fetchFn = jest.fn().mockResolvedValue("data");

      await getOrFetch("x", fetchFn);
      await getOrFetch("y", fetchFn);
      await getOrFetch("z", fetchFn);

      invalidateAll();

      expect(getStats().size).toBe(0);
      expect(getStats().keys).toEqual([]);
    });
  });

  describe("max size eviction", () => {
    it("should evict oldest entry when cache reaches MAX_METRICS_CACHE_SIZE", async () => {
      const fetchFn = jest.fn().mockResolvedValue("data");

      // Fill cache to capacity (MAX_METRICS_CACHE_SIZE = 3)
      await getOrFetch("a", fetchFn, 60000);
      await getOrFetch("b", fetchFn, 60000);
      await getOrFetch("c", fetchFn, 60000);
      expect(getStats().size).toBe(3);

      // Adding one more should evict the oldest
      await getOrFetch("d", fetchFn, 60000);

      expect(getStats().size).toBeLessThanOrEqual(3);
      expect(getStats().keys).toContain("d");
    });
  });

  describe("getStats()", () => {
    it("should return size and keys of current cache", async () => {
      const fetchFn = jest.fn().mockResolvedValue("data");

      await getOrFetch("alpha", fetchFn);
      await getOrFetch("beta", fetchFn);

      const stats = getStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain("alpha");
      expect(stats.keys).toContain("beta");
    });

    it("should return empty state when cache is empty", () => {
      const stats = getStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });
});
