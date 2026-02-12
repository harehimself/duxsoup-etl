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

  describe("getNetworkProfile()", () => {
    it("should return network composition for 1st-degree connections with all dimensions", async () => {
      // Mock countDocuments
      Person.countDocuments = jest.fn().mockResolvedValue(150);

      // Mock all aggregations
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
          // Tenure stats
          { avgTenureYears: 3.5, medianTenureYears: 3.0, count: 100 },
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
          medianTenureYears: 3.0,
          count: 100,
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

    it("should calculate percentages correctly", async () => {
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

      expect(result.topCompanies[0].percentage).toBe(63); // 50/80 * 100 = 62.5 rounded to 63
      expect(result.topCompanies[1].percentage).toBe(38); // 30/80 * 100 = 37.5 rounded to 38
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
});
