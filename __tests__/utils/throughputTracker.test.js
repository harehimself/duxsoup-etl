const throughputTracker = require("../../src/utils/throughputTracker");

describe("throughputTracker", () => {
  beforeEach(() => {
    throughputTracker.reset();
  });

  describe("record()", () => {
    it("should increment total and success counters", () => {
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "visit", success: true });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].total).toBe(2);
      expect(stats["1m"].success).toBe(2);
      expect(stats["1m"].failure).toBe(0);
    });

    it("should increment failure counter for failed events", () => {
      throughputTracker.record({ type: "visit", success: false });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].total).toBe(1);
      expect(stats["1m"].failure).toBe(1);
      expect(stats["1m"].success).toBe(0);
    });

    it("should track debounced events", () => {
      throughputTracker.record({
        type: "visit",
        success: true,
        debounced: true,
      });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].debounced).toBe(1);
    });

    it("should track duplicate events", () => {
      throughputTracker.record({
        type: "scan",
        success: true,
        duplicate: true,
      });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].duplicate).toBe(1);
    });

    it("should track phase2Failure events", () => {
      throughputTracker.record({
        type: "visit",
        success: true,
        phase2Failure: true,
      });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].phase2Failure).toBe(1);
    });

    it("should track events by type", () => {
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "scan", success: true });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].byType.visit).toBe(2);
      expect(stats["1m"].byType.scan).toBe(1);
    });

    it("should track latency", () => {
      throughputTracker.record({
        type: "visit",
        success: true,
        latencyMs: 100,
      });
      throughputTracker.record({
        type: "visit",
        success: true,
        latencyMs: 200,
      });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].avgLatencyMs).toBe(150);
    });
  });

  describe("getStats()", () => {
    it("should return stats for all time windows", () => {
      const stats = throughputTracker.getStats();

      expect(stats).toHaveProperty("1m");
      expect(stats).toHaveProperty("5m");
      expect(stats).toHaveProperty("15m");
      expect(stats).toHaveProperty("1h");
      expect(stats).toHaveProperty("timestamp");
    });

    it("should calculate rate per minute", () => {
      // Record 60 events to get a meaningful rate
      for (let i = 0; i < 60; i++) {
        throughputTracker.record({ type: "visit", success: true });
      }

      const stats = throughputTracker.getStats();
      // All 60 events happened in the current second, so for a 1-minute window
      // the rate per minute should be 60
      expect(stats["1m"].rate.perMinute).toBe(60);
    });

    it("should calculate success rate", () => {
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "visit", success: false });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].rate.successRate).toBeCloseTo(66.67, 1);
    });

    it("should return 100% success rate when no events recorded", () => {
      const stats = throughputTracker.getStats();
      expect(stats["1m"].rate.successRate).toBe(100);
      expect(stats["1m"].rate.perMinute).toBe(0);
    });

    it("should return 0 avg latency when no latency recorded", () => {
      throughputTracker.record({ type: "visit", success: true });

      const stats = throughputTracker.getStats();
      expect(stats["1m"].avgLatencyMs).toBe(0);
    });
  });

  describe("reset()", () => {
    it("should clear all counters", () => {
      throughputTracker.record({ type: "visit", success: true });
      throughputTracker.record({ type: "scan", success: false });

      throughputTracker.reset();

      const stats = throughputTracker.getStats();
      expect(stats["1m"].total).toBe(0);
      expect(stats["1m"].success).toBe(0);
      expect(stats["1m"].failure).toBe(0);
    });
  });
});
