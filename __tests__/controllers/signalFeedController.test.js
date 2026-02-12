jest.mock("../../src/services/signalFeedService", () => ({
  getSignals: jest.fn(),
  VALID_SIGNAL_TYPES: [
    "new_role",
    "promotion",
    "lateral_move",
    "new_decision_maker",
  ],
}));

jest.mock("../../src/utils/metricsCache", () => ({
  getOrFetch: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const signalFeedService = require("../../src/services/signalFeedService");
const metricsCache = require("../../src/utils/metricsCache");
const { getSignals } = require("../../src/controllers/signalFeedController");

function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

const sampleResult = {
  signals: [
    {
      type: "new_role",
      personId: "p1",
      personName: "Jane Doe",
      title: "VP Engineering",
      company: "Acme Corp",
      score: 72.5,
      priority: "high",
      timestamp: new Date("2026-02-10"),
      actionContext: "New VP Engineering at Acme Corp (2 days into role).",
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe("signalFeedController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    metricsCache.getOrFetch.mockImplementation((_key, fetchFn) => fetchFn());
  });

  describe("getSignals()", () => {
    it("should return 200 with signals data", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes();
      await getSignals(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleResult.signals,
          total: 1,
          limit: 50,
          offset: 0,
        }),
      );
    });

    it("should return 400 for invalid signal type", async () => {
      const { req, res, next } = mockReqRes({ type: "invalid_type" });
      await getSignals(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "VALIDATION_ERROR",
          message: expect.stringContaining("invalid_type"),
        }),
      );
    });

    it("should accept comma-separated valid types", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({
        type: "new_role,promotion",
      });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["new_role", "promotion"],
        }),
      );
    });

    it("should pass parsed query params to service", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({
        minRank: "5",
        days: "60",
        limit: "25",
        offset: "10",
        company: "Acme",
        companyId: "comp1",
      });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({
          minRank: 5,
          days: 60,
          limit: 25,
          offset: 10,
          company: "Acme",
          companyId: "comp1",
        }),
      );
    });

    it("should cap days to SIGNAL_MAX_DAYS (180)", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ days: "999" });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({ days: 180 }),
      );
    });

    it("should cap limit to SIGNAL_MAX_LIMIT (500)", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ limit: "9999" });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 }),
      );
    });

    it("should clamp minRank between 1 and 8", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ minRank: "15" });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({ minRank: 8 }),
      );
    });

    it("should bypass cache when fresh=true", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ fresh: "true" });
      await getSignals(req, res, next);

      // metricsCache.getOrFetch should be called with TTL = 0
      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        0,
      );
    });

    it("should use cache when fresh is not set", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes();
      await getSignals(req, res, next);

      // metricsCache.getOrFetch should be called with positive TTL
      const ttl = metricsCache.getOrFetch.mock.calls[0][2];
      expect(ttl).toBeGreaterThan(0);
    });

    it("should include metadata in response", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ days: "45", minRank: "3" });
      await getSignals(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.metadata).toEqual(
        expect.objectContaining({
          days: 45,
          minRank: 3,
          cached: true,
          generatedAt: expect.any(String),
        }),
      );
    });

    it("should call next(error) on service failure", async () => {
      metricsCache.getOrFetch.mockRejectedValue(new Error("DB failure"));

      const { req, res, next } = mockReqRes();
      await getSignals(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should default to all types when type param is not provided", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes();
      await getSignals(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.metadata.types).toEqual([
        "new_role",
        "promotion",
        "lateral_move",
        "new_decision_maker",
      ]);
    });

    it("should reject when one type is valid and another is invalid", async () => {
      const { req, res, next } = mockReqRes({
        type: "new_role,bogus",
      });
      await getSignals(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining("bogus"),
        }),
      );
    });

    it("should handle negative offset gracefully", async () => {
      signalFeedService.getSignals.mockResolvedValue(sampleResult);

      const { req, res, next } = mockReqRes({ offset: "-5" });
      await getSignals(req, res, next);

      expect(signalFeedService.getSignals).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0 }),
      );
    });
  });
});
