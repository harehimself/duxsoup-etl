const networkProfileController = require("../src/controllers/networkProfileController");
const networkProfileService = require("../src/services/networkProfileService");
const metricsCache = require("../src/utils/metricsCache");

// Mock dependencies
jest.mock("../src/services/networkProfileService");
jest.mock("../src/utils/metricsCache");
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../src/constants/limits", () => ({
  NETWORK_PROFILE_CACHE_TTL_MS: 600000, // 10 min
}));

describe("networkProfileController", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      query: {},
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe("getNetworkProfile()", () => {
    const mockNetworkProfile = {
      totalConnections: 150,
      topCompanies: [
        { company: "Google", companyId: "123", count: 25, percentage: 17 },
      ],
      seniorityBreakdown: [{ seniority: "VP", count: 30, percentage: 20 }],
      topTitles: [{ title: "Software Engineer", count: 40, percentage: 27 }],
      industryDistribution: [
        { industry: "Technology", count: 80, percentage: 53 },
      ],
      geography: {
        topCities: [
          {
            city: "San Francisco",
            state: "California",
            country: "United States",
            count: 60,
            percentage: 40,
          },
        ],
        topCountries: [
          { country: "United States", count: 120, percentage: 80 },
        ],
      },
      departmentBreakdown: [
        { department: "Engineering", count: 60, percentage: 40 },
      ],
      averageTenure: {
        avgTenureYears: 3.5,
        medianTenureYears: 3.0,
        count: 100,
      },
      filters: {},
    };

    beforeEach(() => {
      metricsCache.getOrFetch.mockImplementation((key, fn) => fn());
      networkProfileService.getNetworkProfile.mockResolvedValue(
        mockNetworkProfile,
      );
    });

    it("should return network profile with default parameters", async () => {
      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockNetworkProfile,
        metadata: {
          generatedAt: expect.any(String),
          cached: true,
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should parse and pass industry filter", async () => {
      req.query.industry = "Technology";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        industry: "Technology",
      });
    });

    it("should parse and pass location filter", async () => {
      req.query.location = "San Francisco";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        location: "San Francisco",
      });
    });

    it("should parse and pass seniority filter", async () => {
      req.query.seniority = "VP";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        seniority: "VP",
      });
    });

    it("should parse and clamp minRank filter", async () => {
      req.query.minRank = "5";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        minRank: 5,
      });
    });

    it("should clamp minRank to valid range (1-8)", async () => {
      req.query.minRank = "10";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        minRank: 8,
      });

      req.query.minRank = "0";
      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        minRank: 1,
      });
    });

    it("should parse and pass company filter", async () => {
      req.query.company = "Google";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        company: "Google",
      });
    });

    it("should parse and pass companyId filter", async () => {
      req.query.companyId = "123";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
        companyId: "123",
      });
    });

    it("should parse and clamp topN parameter", async () => {
      req.query.topN = "20";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 20,
      });
    });

    it("should clamp topN to max 50", async () => {
      req.query.topN = "100";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 50,
      });
    });

    it("should default topN to 10 when invalid", async () => {
      req.query.topN = "0";

      await networkProfileController.getNetworkProfile(req, res, next);

      // parseInt("0") returns 0, which is falsy, so || defaults to 10
      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        topN: 10,
      });
    });

    it("should use cache by default", async () => {
      await networkProfileController.getNetworkProfile(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        expect.stringContaining("network-profile:"),
        expect.any(Function),
        600000, // NETWORK_PROFILE_CACHE_TTL_MS
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ cached: true }),
        }),
      );
    });

    it("should bypass cache when fresh=true", async () => {
      req.query.fresh = "true";

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        expect.stringContaining("network-profile:"),
        expect.any(Function),
        0, // TTL = 0 to bypass cache
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ cached: false }),
        }),
      );
    });

    it("should handle service errors", async () => {
      const error = new Error("Database error");
      networkProfileService.getNetworkProfile.mockRejectedValue(error);

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should combine multiple filters", async () => {
      req.query = {
        industry: "Technology",
        location: "San Francisco",
        seniority: "VP",
        minRank: "5",
        company: "Google",
        companyId: "123",
        topN: "15",
      };

      await networkProfileController.getNetworkProfile(req, res, next);

      expect(networkProfileService.getNetworkProfile).toHaveBeenCalledWith({
        industry: "Technology",
        location: "San Francisco",
        seniority: "VP",
        minRank: 5,
        company: "Google",
        companyId: "123",
        topN: 15,
      });
    });

    it("should create unique cache keys for different filter combinations", async () => {
      // First call with no filters
      await networkProfileController.getNetworkProfile(req, res, next);
      const cacheKey1 = metricsCache.getOrFetch.mock.calls[0][0];

      // Second call with filters
      req.query = { industry: "Technology", seniority: "VP" };
      await networkProfileController.getNetworkProfile(req, res, next);
      const cacheKey2 = metricsCache.getOrFetch.mock.calls[1][0];

      expect(cacheKey1).not.toBe(cacheKey2);
      expect(cacheKey1).toContain("network-profile:");
      expect(cacheKey2).toContain("network-profile:");
    });
  });

  describe("getNetworkTrends()", () => {
    const mockTrends = {
      totalConnections: 150,
      windows: {
        "30d": {
          newConnections: 12,
          growthRate: 8.7,
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
        "60d": {
          newConnections: 25,
          growthRate: 20,
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
        "90d": {
          newConnections: 40,
          growthRate: 36.4,
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      },
      insights: ["Your fintech connections grew 15% in the last 30 days"],
      filters: {},
    };

    beforeEach(() => {
      metricsCache.getOrFetch.mockImplementation((key, fn) => fn());
      networkProfileService.getNetworkTrends.mockResolvedValue(mockTrends);
    });

    it("should return trends with default parameters", async () => {
      await networkProfileController.getNetworkTrends(req, res, next);

      expect(networkProfileService.getNetworkTrends).toHaveBeenCalledWith({
        topN: 10,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockTrends,
        metadata: {
          generatedAt: expect.any(String),
          cached: true,
        },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should parse and pass filters", async () => {
      req.query = {
        industry: "Technology",
        seniority: "VP",
        minRank: "5",
        topN: "15",
      };

      await networkProfileController.getNetworkTrends(req, res, next);

      expect(networkProfileService.getNetworkTrends).toHaveBeenCalledWith({
        industry: "Technology",
        seniority: "VP",
        minRank: 5,
        topN: 15,
      });
    });

    it("should use network-trends: cache key prefix", async () => {
      await networkProfileController.getNetworkTrends(req, res, next);

      const cacheKey = metricsCache.getOrFetch.mock.calls[0][0];
      expect(cacheKey).toContain("network-trends:");
    });

    it("should bypass cache when fresh=true", async () => {
      req.query.fresh = "true";

      await networkProfileController.getNetworkTrends(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        0,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ cached: false }),
        }),
      );
    });

    it("should handle service errors", async () => {
      const error = new Error("Database error");
      networkProfileService.getNetworkTrends.mockRejectedValue(error);

      await networkProfileController.getNetworkTrends(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should create unique cache keys for different filter combinations", async () => {
      await networkProfileController.getNetworkTrends(req, res, next);
      const key1 = metricsCache.getOrFetch.mock.calls[0][0];

      req.query = { seniority: "CXO" };
      await networkProfileController.getNetworkTrends(req, res, next);
      const key2 = metricsCache.getOrFetch.mock.calls[1][0];

      expect(key1).not.toBe(key2);
      expect(key1).toContain("network-trends:");
      expect(key2).toContain("network-trends:");
    });
  });
});
