const { calculateNextReplayAt } = require("../../src/utils/backoff");

describe("calculateNextReplayAt", () => {
  const baseTime = new Date("2025-01-01T00:00:00Z");

  it("should return 2 minutes delay for attempt 1", () => {
    const result = calculateNextReplayAt(baseTime, 1);
    const expectedMs = 2 * 60 * 1000;
    expect(result.getTime()).toBe(baseTime.getTime() + expectedMs);
  });

  it("should return 4 minutes delay for attempt 2", () => {
    const result = calculateNextReplayAt(baseTime, 2);
    const expectedMs = 4 * 60 * 1000;
    expect(result.getTime()).toBe(baseTime.getTime() + expectedMs);
  });

  it("should return correct delays for attempts 1 through 10", () => {
    const expected = [2, 4, 8, 16, 32, 64, 128, 256, 512, 720];
    for (let i = 1; i <= 10; i++) {
      const result = calculateNextReplayAt(baseTime, i, 720);
      const expectedMs = expected[i - 1] * 60 * 1000;
      expect(result.getTime()).toBe(baseTime.getTime() + expectedMs);
    }
  });

  it("should cap delay at configured maximum", () => {
    const result = calculateNextReplayAt(baseTime, 20, 720);
    const cappedMs = 720 * 60 * 1000;
    expect(result.getTime()).toBe(baseTime.getTime() + cappedMs);
  });

  it("should accept a custom cap", () => {
    const result = calculateNextReplayAt(baseTime, 10, 60);
    const cappedMs = 60 * 60 * 1000;
    expect(result.getTime()).toBe(baseTime.getTime() + cappedMs);
  });

  it("should return a Date object", () => {
    const result = calculateNextReplayAt(baseTime, 1);
    expect(result).toBeInstanceOf(Date);
  });
});
