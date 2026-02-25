const Person = require("../src/models/person");
const networkProfileService = require("../src/services/networkProfileService");

// Mock Person model
jest.mock("../src/models/person");

// Mock logger
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("networkProfileService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("_calculateMedian()", () => {
    const { _calculateMedian } = networkProfileService;

    it("should return null for empty array", () => {
      expect(_calculateMedian([])).toBeNull();
    });

    it("should return the single value for one-element array", () => {
      expect(_calculateMedian([5])).toBe(5);
    });

    it("should return middle value for odd-length array", () => {
      expect(_calculateMedian([1, 3, 7])).toBe(3);
    });

    it("should return average of two middle values for even-length array", () => {
      expect(_calculateMedian([1, 2, 3, 4])).toBe(2.5);
    });

    it("should handle unsorted input", () => {
      expect(_calculateMedian([7, 1, 3])).toBe(3);
    });
  });

  describe("_buildBaseFilter()", () => {
    const { _buildBaseFilter } = networkProfileService;

    it("should return base filter with degree and mergedInto", () => {
      const filter = _buildBaseFilter();
      expect(filter).toEqual({
        "snapshot.degree": 1,
        mergedInto: { $exists: false },
      });
    });

    it("should include optional filters", () => {
      const filter = _buildBaseFilter({
        industry: "Tech",
        seniority: "VP",
        minRank: 5,
      });
      expect(filter["snapshot.industry"]).toEqual({
        $regex: "Tech",
        $options: "i",
      });
      expect(filter["snapshot.parsedSeniority"]).toBe("VP");
      expect(filter["derived.highestSeniorityRank"]).toEqual({ $gte: 5 });
    });
  });

  describe("getNetworkProfile()", () => {
    it("should return network composition for 1st-degree connections with all dimensions", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(150);
      Person.aggregate = jest
        .fn()
        .mockResolvedValueOnce([
          // Top companies
          { company: "Google", companyId: "123", count: 25 },
          { company: "Meta", companyId: "456", count: 20 },
        ])
        .mockResolvedValueOnce([
          // Seniority breakdown
          { seniority: "VP", count: 30, avgRank: 6.2 },
          { seniority: "Manager", count: 50, avgRank: 3.5 },
        ])
        .mockResolvedValueOnce([
          // Top titles
          { title: "Software Engineer", count: 40 },
          { title: "Product Manager", count: 30 },
        ])
        .mockResolvedValueOnce([
          // Industry distribution
          { industry: "Technology", count: 80 },
          { industry: "Finance", count: 40 },
        ])
        .mockResolvedValueOnce([
          // Top cities
          {
            city: "San Francisco",
            state: "California",
            country: "United States",
            count: 60,
          },
          {
            city: "New York",
            state: "New York",
            country: "United States",
            count: 30,
          },
        ])
        .mockResolvedValueOnce([
          // Top countries
          { country: "United States", count: 120 },
          { country: "Canada", count: 20 },
        ])
        .mockResolvedValueOnce([
          // Department breakdown
          { department: "Engineering", count: 60 },
          { department: "Product", count: 30 },
        ])
        .mockResolvedValueOnce([
          // Tenure stats (with values array for median)
          { avgTenureYears: 3.5, values: [1, 2, 3, 4, 5, 6], count: 6 },
        ]);

      const result = await networkProfileService.getNetworkProfile();

      expect(result).toMatchObject({
        totalConnections: 150,
        topCompanies: expect.arrayContaining([
          expect.objectContaining({
            company: "Google",
            companyId: "123",
            count: 25,
            percentage: expect.any(Number),
          }),
        ]),
        seniorityBreakdown: expect.arrayContaining([
          expect.objectContaining({
            seniority: "VP",
            count: 30,
            avgRank: 6.2,
            percentage: expect.any(Number),
          }),
        ]),
        topTitles: expect.arrayContaining([
          expect.objectContaining({
            title: "Software Engineer",
            count: 40,
            percentage: expect.any(Number),
          }),
        ]),
        industryDistribution: expect.arrayContaining([
          expect.objectContaining({
            industry: "Technology",
            count: 80,
            percentage: expect.any(Number),
          }),
        ]),
        geography: {
          topCities: expect.arrayContaining([
            expect.objectContaining({
              city: "San Francisco",
              count: 60,
              percentage: expect.any(Number),
            }),
          ]),
          topCountries: expect.arrayContaining([
            expect.objectContaining({
              country: "United States",
              count: 120,
              percentage: expect.any(Number),
            }),
          ]),
        },
        departmentBreakdown: expect.arrayContaining([
          expect.objectContaining({
            department: "Engineering",
            count: 60,
            percentage: expect.any(Number),
          }),
        ]),
        averageTenure: {
          avgTenureYears: 3.5,
          medianTenureYears: 3.5, // median of [1,2,3,4,5,6] = (3+4)/2 = 3.5
          count: 6,
        },
      });

      // Verify base filter for 1st-degree connections
      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.degree": 1,
          mergedInto: { $exists: false },
        }),
      );
    });

    it("should apply industry filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        industry: "Technology",
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.industry": { $regex: "Technology", $options: "i" },
        }),
      );
    });

    it("should apply location filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        location: "San Francisco",
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.location": { $regex: "San Francisco", $options: "i" },
        }),
      );
    });

    it("should apply seniority filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        seniority: "VP",
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.parsedSeniority": "VP",
        }),
      );
    });

    it("should apply minRank filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        minRank: 5,
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "derived.highestSeniorityRank": { $gte: 5 },
        }),
      );
    });

    it("should apply company filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        company: "Google",
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.currentCompany": { $regex: "Google", $options: "i" },
        }),
      );
    });

    it("should apply companyId filter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        companyId: "123",
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.currentCompanyId": "123",
        }),
      );
    });

    it("should respect topN parameter", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({ topN: 20 });

      // Verify topN is passed through to aggregations
      const aggregateCalls = Person.aggregate.mock.calls;
      // Check that aggregations that use $limit have limit: 20
      const limitStages = aggregateCalls
        .flat()
        .filter((pipeline) => Array.isArray(pipeline))
        .flat()
        .filter((stage) => stage.$limit);

      limitStages.forEach((stage) => {
        expect(stage.$limit).toBe(20);
      });
    });

    it("should calculate percentages using totalCount as denominator", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(100);
      Person.aggregate = jest
        .fn()
        .mockResolvedValueOnce([
          { company: "Google", companyId: "123", count: 50 },
          { company: "Meta", companyId: "456", count: 30 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await networkProfileService.getNetworkProfile();

      // Percentages should be calculated against totalCount (100), not sum of top-N (80)
      expect(result.topCompanies[0].percentage).toBe(50); // 50/100 * 100 = 50
      expect(result.topCompanies[1].percentage).toBe(30); // 30/100 * 100 = 30
    });

    it("should handle zero connections", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(0);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      const result = await networkProfileService.getNetworkProfile();

      expect(result.totalConnections).toBe(0);
      expect(result.topCompanies).toEqual([]);
      expect(result.seniorityBreakdown).toEqual([]);
    });

    it("should handle missing tenure data", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]); // Empty tenure stats

      const result = await networkProfileService.getNetworkProfile();

      expect(result.averageTenure).toEqual({
        avgTenureYears: 0,
        medianTenureYears: 0,
        count: 0,
      });
    });

    it("should compute true median tenure from pushed values", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(50);
      Person.aggregate = jest
        .fn()
        .mockResolvedValueOnce([]) // companies
        .mockResolvedValueOnce([]) // seniority
        .mockResolvedValueOnce([]) // titles
        .mockResolvedValueOnce([]) // industry
        .mockResolvedValueOnce([]) // cities
        .mockResolvedValueOnce([]) // countries
        .mockResolvedValueOnce([]) // departments
        .mockResolvedValueOnce([
          { avgTenureYears: 4.0, values: [1, 2, 3, 10, 20], count: 5 },
        ]);

      const result = await networkProfileService.getNetworkProfile();

      // Median of [1, 2, 3, 10, 20] = 3, not the average (7.2)
      expect(result.averageTenure.medianTenureYears).toBe(3);
      expect(result.averageTenure.avgTenureYears).toBe(4.0);
    });

    it("should combine multiple filters", async () => {
      Person.countDocuments = jest.fn().mockResolvedValue(10);
      Person.aggregate = jest
        .fn()
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([])
        .mockResolvedValue([]);

      await networkProfileService.getNetworkProfile({
        industry: "Technology",
        location: "San Francisco",
        seniority: "VP",
        minRank: 5,
      });

      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.degree": 1,
          mergedInto: { $exists: false },
          "snapshot.industry": { $regex: "Technology", $options: "i" },
          "snapshot.location": { $regex: "San Francisco", $options: "i" },
          "snapshot.parsedSeniority": "VP",
          "derived.highestSeniorityRank": { $gte: 5 },
        }),
      );
    });
  });

  describe("getNetworkTrends()", () => {
    function setupTrendMocks(totalCount, windowResults) {
      Person.countDocuments = jest.fn().mockResolvedValue(totalCount);
      const mock = jest.fn();
      for (const result of windowResults) {
        mock.mockResolvedValueOnce(result);
      }
      Person.aggregate = mock;
    }

    it("should return trends for all three windows", async () => {
      const facetResult = [
        {
          total: [{ count: 12 }],
          byCompany: [{ company: "Google", companyId: "123", count: 3 }],
          bySeniority: [{ seniority: "VP", count: 5 }],
          byIndustry: [{ industry: "Technology", count: 8 }],
          byCountry: [{ country: "United States", count: 10 }],
          byDepartment: [{ department: "Engineering", count: 6 }],
        },
      ];

      setupTrendMocks(150, [facetResult, facetResult, facetResult]);

      const result = await networkProfileService.getNetworkTrends();

      expect(result.totalConnections).toBe(150);
      expect(result.windows).toHaveProperty("30d");
      expect(result.windows).toHaveProperty("60d");
      expect(result.windows).toHaveProperty("90d");
      expect(result.windows["30d"].newConnections).toBe(12);
      expect(result.windows["30d"].byCompany).toHaveLength(1);
      expect(result.windows["30d"].bySeniority).toHaveLength(1);
      expect(result.windows["30d"].byIndustry).toHaveLength(1);
      expect(result.windows["30d"].byCountry).toHaveLength(1);
      expect(result.windows["30d"].byDepartment).toHaveLength(1);
    });

    it("should calculate growth rate correctly", async () => {
      const facetResult = [
        {
          total: [{ count: 20 }],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(100, [facetResult, facetResult, facetResult]);

      const result = await networkProfileService.getNetworkTrends();

      // previousTotal = 100 - 20 = 80, growthRate = 20/80 * 100 = 25.0
      expect(result.windows["30d"].growthRate).toBe(25);
    });

    it("should handle zero connections", async () => {
      const emptyFacet = [
        {
          total: [],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(0, [emptyFacet, emptyFacet, emptyFacet]);

      const result = await networkProfileService.getNetworkTrends();

      expect(result.totalConnections).toBe(0);
      expect(result.windows["30d"].newConnections).toBe(0);
      expect(result.windows["30d"].growthRate).toBe(0);
    });

    it("should apply filters to trend queries", async () => {
      const emptyFacet = [
        {
          total: [],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(50, [emptyFacet, emptyFacet, emptyFacet]);

      await networkProfileService.getNetworkTrends({
        industry: "Technology",
      });

      // countDocuments should have the filter
      expect(Person.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.industry": { $regex: "Technology", $options: "i" },
        }),
      );

      // Aggregate calls should also include the filter in $match
      const firstAggCall = Person.aggregate.mock.calls[0][0];
      const matchStage = firstAggCall[0].$match;
      expect(matchStage["snapshot.industry"]).toEqual({
        $regex: "Technology",
        $options: "i",
      });
    });

    it("should generate insights for significant 30-day growth", async () => {
      const facet30 = [
        {
          total: [{ count: 20 }],
          byCompany: [{ company: "Stripe", companyId: "s1", count: 5 }],
          bySeniority: [{ seniority: "VP", count: 4 }],
          byIndustry: [{ industry: "Fintech", count: 8 }],
          byCountry: [],
          byDepartment: [],
        },
      ];
      const emptyFacet = [
        {
          total: [],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(50, [facet30, emptyFacet, emptyFacet]);

      const result = await networkProfileService.getNetworkTrends();

      // previousTotal = 50 - 20 = 30
      // Fintech: 8/30 = 26.7% > 10% and > 2 count → insight
      // VP: 4/30 = 13.3% > 10% and > 2 → insight
      // Stripe: 5/30 = 16.7% > 10% and > 2 → insight
      expect(result.insights.length).toBeGreaterThan(0);
      expect(result.insights.some((i) => i.includes("Fintech"))).toBeTruthy();
    });

    it("should not generate insights when growth is below threshold", async () => {
      const facet30 = [
        {
          total: [{ count: 2 }],
          byCompany: [],
          bySeniority: [{ seniority: "VP", count: 1 }], // Only 1, below threshold of >2
          byIndustry: [{ industry: "Tech", count: 1 }],
          byCountry: [],
          byDepartment: [],
        },
      ];
      const emptyFacet = [
        {
          total: [],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(200, [facet30, emptyFacet, emptyFacet]);

      const result = await networkProfileService.getNetworkTrends();

      expect(result.insights).toEqual([]);
    });

    it("should handle 100% growth rate when all connections are new", async () => {
      const facetResult = [
        {
          total: [{ count: 10 }],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(10, [facetResult, facetResult, facetResult]);

      const result = await networkProfileService.getNetworkTrends();

      // previousTotal = 10 - 10 = 0, so growthRate = 100
      expect(result.windows["30d"].growthRate).toBe(100);
    });

    it("should return filters in the response", async () => {
      const emptyFacet = [
        {
          total: [],
          byCompany: [],
          bySeniority: [],
          byIndustry: [],
          byCountry: [],
          byDepartment: [],
        },
      ];

      setupTrendMocks(0, [emptyFacet, emptyFacet, emptyFacet]);

      const result = await networkProfileService.getNetworkTrends({
        industry: "Tech",
        seniority: "VP",
      });

      expect(result.filters).toEqual({ industry: "Tech", seniority: "VP" });
    });
  });
});
