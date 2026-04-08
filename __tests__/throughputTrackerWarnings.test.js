const throughputTracker = require("../src/utils/throughputTracker");

describe("throughputTracker — warning metrics", () => {
  beforeEach(() => {
    throughputTracker.reset();
  });

  it("should include warning fields in getStats() windows", () => {
    const stats = throughputTracker.getStats();
    for (const window of ["1m", "5m", "15m", "1h"]) {
      expect(stats[window]).toHaveProperty("warnings");
      expect(stats[window].warnings).toEqual({
        total: 0,
        byCode: {},
        rate: 0,
      });
    }
  });

  it("should accumulate warningCount from record events", () => {
    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 3,
      warningsByCode: {
        NO_STABLE_ID: 1,
        ROLES_AT_CAPACITY: 2,
      },
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.total).toBe(3);
    expect(stats["1m"].warnings.byCode).toEqual({
      NO_STABLE_ID: 1,
      ROLES_AT_CAPACITY: 2,
    });
  });

  it("should sum warnings across multiple events", () => {
    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 2,
      warningsByCode: { NO_STABLE_ID: 2 },
    });

    throughputTracker.record({
      type: "scan",
      success: true,
      warningCount: 1,
      warningsByCode: { NO_STABLE_ID: 1 },
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.total).toBe(3);
    expect(stats["1m"].warnings.byCode.NO_STABLE_ID).toBe(3);
  });

  it("should not increment warnings when warningCount is absent", () => {
    throughputTracker.record({
      type: "visit",
      success: true,
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.total).toBe(0);
  });

  it("should not increment warnings when warningCount is 0", () => {
    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 0,
      warningsByCode: {},
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.total).toBe(0);
  });

  it("should calculate warning rate per minute", () => {
    // Record 60 warnings — over a 1-minute window, rate should be 60/min
    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 60,
      warningsByCode: { ROLES_AT_CAPACITY: 60 },
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.rate).toBe(60);
    // Over the 5m window the rate per minute is 60/5 = 12
    expect(stats["5m"].warnings.rate).toBe(12);
  });

  it("should merge warningsByCode across events with different codes", () => {
    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 1,
      warningsByCode: { ROLES_AT_CAPACITY: 1 },
    });

    throughputTracker.record({
      type: "visit",
      success: true,
      warningCount: 1,
      warningsByCode: { SKILLS_AT_CAPACITY: 1 },
    });

    const stats = throughputTracker.getStats();
    expect(stats["1m"].warnings.byCode).toEqual({
      ROLES_AT_CAPACITY: 1,
      SKILLS_AT_CAPACITY: 1,
    });
    expect(stats["1m"].warnings.total).toBe(2);
  });
});
