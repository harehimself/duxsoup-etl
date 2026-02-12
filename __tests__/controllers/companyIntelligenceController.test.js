jest.mock("../../src/services/companyIntelligenceService", () => ({
  getCompanyIntelligence: jest.fn(),
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

const {
  getCompanyIntelligence: getCompanyIntelligenceSvc,
} = require("../../src/services/companyIntelligenceService");
const metricsCache = require("../../src/utils/metricsCache");
const {
  getCompanyIntelligence,
} = require("../../src/controllers/companyIntelligenceController");

function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

const sampleData = {
  company: {
    _id: "12345",
    name: "Acme",
    industry: "Tech",
    location: "SF",
    website: null,
  },
  headcount: { total: 5, bySeniority: [], byDepartment: [] },
  decisionMakers: [],
  recentHires: [],
  recentDepartures: [],
  tenure: { avgYears: 2.5, medianYears: 2, withData: 3 },
  hiringVelocity: { monthlyNewPeople: [], avgPerMonth: 0, trend: "stable" },
  geography: [],
};

describe("companyIntelligenceController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: metricsCache.getOrFetch calls the provided fetchFn
    metricsCache.getOrFetch.mockImplementation((_key, fetchFn) => fetchFn());
  });

  describe("getCompanyIntelligence()", () => {
    it("should return 200 with intelligence data for a valid company", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "12345" });
      await getCompanyIntelligence(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleData,
          metadata: expect.objectContaining({
            companyId: "12345",
            cached: true,
          }),
        }),
      );
    });

    it("should return 404 when no people are linked to the company", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(null);

      const { req, res, next } = mockReqRes({ id: "99999" });
      await getCompanyIntelligence(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "NOT_FOUND",
        }),
      );
    });

    it("should return 400 when company ID is empty", async () => {
      const { req, res, next } = mockReqRes({ id: "" });
      await getCompanyIntelligence(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "VALIDATION_ERROR",
          message: "Company ID is required",
        }),
      );
    });

    it("should return 400 when company ID is whitespace only", async () => {
      const { req, res, next } = mockReqRes({ id: "   " });
      await getCompanyIntelligence(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should use cache with default TTL when fresh is not set", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "12345" });
      await getCompanyIntelligence(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        "company-intelligence:12345",
        expect.any(Function),
        5 * 60 * 1000,
      );
    });

    it("should bypass cache when fresh=true is set", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "12345" }, { fresh: "true" });
      await getCompanyIntelligence(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        "company-intelligence:12345",
        expect.any(Function),
        0,
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ cached: false }),
        }),
      );
    });

    it("should include generatedAt in metadata", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "12345" });
      await getCompanyIntelligence(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response.metadata.generatedAt).toBeDefined();
      // Verify it's a valid ISO string
      expect(new Date(response.metadata.generatedAt).toISOString()).toBe(
        response.metadata.generatedAt,
      );
    });

    it("should call next(err) on service error", async () => {
      const error = new Error("DB failure");
      metricsCache.getOrFetch.mockRejectedValue(error);

      const { req, res, next } = mockReqRes({ id: "12345" });
      await getCompanyIntelligence(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it("should include the correct response envelope shape", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "12345" });
      await getCompanyIntelligence(req, res, next);

      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty("success", true);
      expect(response).toHaveProperty("data");
      expect(response).toHaveProperty("metadata");
      expect(response.metadata).toHaveProperty("companyId", "12345");
      expect(response.metadata).toHaveProperty("generatedAt");
      expect(response.metadata).toHaveProperty("cached");
    });

    it("should pass the company ID to the service via the cache fetchFn", async () => {
      getCompanyIntelligenceSvc.mockResolvedValue(sampleData);

      const { req, res, next } = mockReqRes({ id: "67890" });
      await getCompanyIntelligence(req, res, next);

      // The fetchFn passed to getOrFetch should call the service
      const fetchFn = metricsCache.getOrFetch.mock.calls[0][1];
      await fetchFn();
      expect(getCompanyIntelligenceSvc).toHaveBeenCalledWith("67890");
    });
  });
});
