jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/utils/metricsCache", () => ({
  getOrFetch: jest.fn(),
  invalidate: jest.fn(),
  invalidateAll: jest.fn(),
  getStats: jest.fn(),
}));

jest.mock("../../src/utils/throughputTracker", () => ({
  getStats: jest.fn(),
  record: jest.fn(),
  reset: jest.fn(),
}));

// Mock models needed by healthController imports
jest.mock("../../src/models/person", () => ({}));
jest.mock("../../src/models/visit", () => ({}));
jest.mock("../../src/models/scan", () => ({}));
jest.mock("../../src/models/deadLetter", () => ({}));

const metricsCache = require("../../src/utils/metricsCache");
const throughputTracker = require("../../src/utils/throughputTracker");
const { getThroughput } = require("../../src/controllers/healthController");

function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe("healthController.getThroughput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return throughput stats via metricsCache", async () => {
    const mockStats = {
      "1m": { total: 5, success: 4, failure: 1 },
      timestamp: "2026-02-10T00:00:00.000Z",
    };
    metricsCache.getOrFetch.mockResolvedValue(mockStats);

    const { req, res } = mockReqRes();
    await getThroughput(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockStats,
    });
    // Should use 30s TTL
    expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
      "throughput",
      expect.any(Function),
      30000,
    );
  });

  it("should bypass cache when fresh=true", async () => {
    const mockStats = { "1m": { total: 0 } };
    metricsCache.getOrFetch.mockResolvedValue(mockStats);

    const { req, res } = mockReqRes({ fresh: "true" });
    await getThroughput(req, res);

    expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
      "throughput",
      expect.any(Function),
      0,
    );
  });

  it("should return 500 on error", async () => {
    metricsCache.getOrFetch.mockRejectedValue(new Error("cache failure"));

    const { req, res } = mockReqRes();
    await getThroughput(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to compute throughput metrics",
      }),
    );
  });

  it("should call throughputTracker.getStats inside the fetchFn", async () => {
    const mockStats = { "1m": { total: 10 } };
    throughputTracker.getStats.mockReturnValue(mockStats);

    // Capture the fetchFn and call it
    metricsCache.getOrFetch.mockImplementation(async (_key, fetchFn) => {
      return fetchFn();
    });

    const { req, res } = mockReqRes();
    await getThroughput(req, res);

    expect(throughputTracker.getStats).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockStats,
    });
  });
});
