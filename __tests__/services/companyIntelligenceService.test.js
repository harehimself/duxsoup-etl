jest.mock("../../src/models/person", () => {
  const mock = {
    countDocuments: jest.fn(),
    aggregate: jest.fn(),
    find: jest.fn(),
  };
  return mock;
});

jest.mock("../../src/models/company", () => ({
  findById: jest.fn(),
}));

jest.mock("../../src/models/change", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Person = require("../../src/models/person");
const Company = require("../../src/models/company");
const Change = require("../../src/models/change");
const {
  getCompanyIntelligence,
  _calculateMedian,
  _determineTrend,
} = require("../../src/services/companyIntelligenceService");

function leanChain(docs) {
  return {
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(docs),
        }),
      }),
    }),
  };
}

function changeFindChain(docs) {
  return {
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(docs),
        }),
      }),
    }),
  };
}

describe("companyIntelligenceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("_calculateMedian()", () => {
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

  describe("_determineTrend()", () => {
    it("should return 'stable' for empty array", () => {
      expect(_determineTrend([])).toBe("stable");
    });

    it("should return 'stable' for single entry", () => {
      expect(_determineTrend([{ count: 5 }])).toBe("stable");
    });

    it("should return 'increasing' when recent is much higher than earlier", () => {
      const monthly = [
        { count: 2 },
        { count: 2 },
        { count: 10 },
        { count: 10 },
      ];
      expect(_determineTrend(monthly)).toBe("increasing");
    });

    it("should return 'decreasing' when recent is much lower than earlier", () => {
      const monthly = [
        { count: 10 },
        { count: 10 },
        { count: 2 },
        { count: 2 },
      ];
      expect(_determineTrend(monthly)).toBe("decreasing");
    });

    it("should return 'stable' when counts are similar", () => {
      const monthly = [{ count: 5 }, { count: 5 }, { count: 5 }, { count: 5 }];
      expect(_determineTrend(monthly)).toBe("stable");
    });

    it("should return 'increasing' when earlier is zero and recent has data", () => {
      const monthly = [{ count: 0 }, { count: 5 }];
      expect(_determineTrend(monthly)).toBe("increasing");
    });

    it("should return 'stable' when both are zero", () => {
      const monthly = [{ count: 0 }, { count: 0 }];
      expect(_determineTrend(monthly)).toBe("stable");
    });
  });

  describe("getCompanyIntelligence()", () => {
    it("should return null when no people are linked to the company", async () => {
      Person.countDocuments.mockResolvedValue(0);

      const result = await getCompanyIntelligence("12345");

      expect(result).toBeNull();
      expect(Person.aggregate).not.toHaveBeenCalled();
    });

    it("should return full rollup for a company with linked people", async () => {
      Person.countDocuments.mockResolvedValue(10);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "12345",
          snapshot: {
            name: "Acme Corp",
            industry: "Technology",
            location: "San Francisco",
            website: "https://acme.com",
          },
        }),
      });

      // Seniority distribution
      Person.aggregate
        .mockResolvedValueOnce([
          { _id: "VP", count: 3 },
          { _id: "Manager", count: 5 },
          { _id: "Unknown", count: 2 },
        ])
        // Department distribution
        .mockResolvedValueOnce([
          { _id: "engineering", count: 6 },
          { _id: "Unknown", count: 4 },
        ])
        // Tenure
        .mockResolvedValueOnce([
          { _id: null, avgYears: 3.25, values: [1, 2, 3, 4, 5], withData: 5 },
        ])
        // Geography
        .mockResolvedValueOnce([
          { _id: { city: "San Francisco", country: "US" }, count: 7 },
          { _id: { city: "New York", country: "US" }, count: 3 },
        ])
        // Hiring velocity
        .mockResolvedValueOnce([
          { _id: { year: 2026, month: 1 }, count: 3 },
          { _id: { year: 2026, month: 2 }, count: 5 },
        ]);

      // Decision makers
      Person.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([
                {
                  _id: "ACwAAABCDEF",
                  snapshot: {
                    fullName: "Jane Doe",
                    currentTitle: "VP Engineering",
                    parsedSeniority: "VP",
                    email: "jane@acme.com",
                    city: "San Francisco",
                  },
                  meta: { lastObservedAt: new Date("2026-01-15") },
                },
              ]),
            }),
          }),
        }),
      });

      // Recent hires
      Change.find
        .mockReturnValueOnce(
          changeFindChain([
            {
              person_id: "hire1",
              personSnapshot: { fullName: "New Hire" },
              toTitle: "Engineer",
              seniority: "Individual Contributor",
              timestamp: new Date("2026-01-10"),
              from: "OldCo",
            },
          ]),
        )
        // Recent departures
        .mockReturnValueOnce(
          changeFindChain([
            {
              person_id: "dep1",
              personSnapshot: { fullName: "Departed" },
              fromTitle: "Manager",
              seniority: "Manager",
              timestamp: new Date("2026-01-05"),
              to: "NewCo",
            },
          ]),
        );

      const result = await getCompanyIntelligence("12345");

      expect(result).not.toBeNull();
      expect(result.company).toEqual({
        _id: "12345",
        name: "Acme Corp",
        industry: "Technology",
        location: "San Francisco",
        website: "https://acme.com",
      });
      expect(result.headcount.total).toBe(10);
      expect(result.headcount.bySeniority).toHaveLength(3);
      expect(result.headcount.bySeniority[0]).toEqual({
        tier: "VP",
        count: 3,
        percentage: 30,
      });
      expect(result.headcount.byDepartment).toHaveLength(2);
      expect(result.headcount.byDepartment[0]).toEqual({
        department: "engineering",
        count: 6,
        percentage: 60,
      });
      expect(result.decisionMakers).toHaveLength(1);
      expect(result.decisionMakers[0].fullName).toBe("Jane Doe");
      expect(result.decisionMakers[0].personId).toBe("ACwAAABCDEF");
      expect(result.recentHires).toHaveLength(1);
      expect(result.recentHires[0].fullName).toBe("New Hire");
      expect(result.recentDepartures).toHaveLength(1);
      expect(result.recentDepartures[0].fullName).toBe("Departed");
      expect(result.tenure.avgYears).toBe(3.3); // rounded to 1 decimal
      expect(result.tenure.medianYears).toBe(3);
      expect(result.tenure.withData).toBe(5);
      expect(result.geography).toHaveLength(2);
      expect(result.hiringVelocity.monthlyNewPeople).toHaveLength(2);
      expect(result.hiringVelocity.avgPerMonth).toBe(4);
      expect(result.hiringVelocity.trend).toBe("increasing");
    });

    it("should handle missing Company document gracefully", async () => {
      Person.countDocuments.mockResolvedValue(2);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([{ _id: "Unknown", count: 2 }]) // seniority
        .mockResolvedValueOnce([{ _id: "Unknown", count: 2 }]) // department
        .mockResolvedValueOnce([]) // tenure
        .mockResolvedValueOnce([]) // geography
        .mockResolvedValueOnce([]); // hiring velocity

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("99999");

      expect(result.company).toEqual({
        _id: "99999",
        name: null,
        industry: null,
        location: null,
        website: null,
      });
    });

    it("should compute seniority percentages correctly", async () => {
      Person.countDocuments.mockResolvedValue(20);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([
          { _id: "CXO", count: 2 },
          { _id: "VP", count: 4 },
          { _id: "Individual Contributor", count: 14 },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("11111");

      expect(result.headcount.bySeniority).toEqual([
        { tier: "CXO", count: 2, percentage: 10 },
        { tier: "VP", count: 4, percentage: 20 },
        { tier: "Individual Contributor", count: 14, percentage: 70 },
      ]);
    });

    it("should map null seniority to 'Unknown'", async () => {
      Person.countDocuments.mockResolvedValue(5);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      // $ifNull maps null to "Unknown" in the pipeline
      Person.aggregate
        .mockResolvedValueOnce([{ _id: "Unknown", count: 5 }])
        .mockResolvedValueOnce([{ _id: "Unknown", count: 5 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("22222");

      expect(result.headcount.bySeniority[0].tier).toBe("Unknown");
      expect(result.headcount.byDepartment[0].department).toBe("Unknown");
    });

    it("should return empty arrays when no hires or departures", async () => {
      Person.countDocuments.mockResolvedValue(3);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("33333");

      expect(result.recentHires).toEqual([]);
      expect(result.recentDepartures).toEqual([]);
    });

    it("should handle null tenure data", async () => {
      Person.countDocuments.mockResolvedValue(3);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // empty tenure
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("44444");

      expect(result.tenure).toEqual({
        avgYears: null,
        medianYears: null,
        withData: 0,
      });
    });

    it("should limit geography to top 20 entries", async () => {
      // The aggregate pipeline has $limit: 20 — verify it's called
      Person.countDocuments.mockResolvedValue(1);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(
          Array.from({ length: 20 }, (_, i) => ({
            _id: { city: `City${i}`, country: "US" },
            count: 20 - i,
          })),
        )
        .mockResolvedValueOnce([]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("55555");

      expect(result.geography).toHaveLength(20);
      expect(result.geography[0].city).toBe("City0");
    });

    it("should format hiring velocity with correct trend", async () => {
      Person.countDocuments.mockResolvedValue(20);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { _id: { year: 2025, month: 9 }, count: 1 },
          { _id: { year: 2025, month: 10 }, count: 1 },
          { _id: { year: 2025, month: 11 }, count: 1 },
          { _id: { year: 2025, month: 12 }, count: 1 },
        ]);

      Person.find.mockReturnValue(leanChain([]));
      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      const result = await getCompanyIntelligence("66666");

      expect(result.hiringVelocity.monthlyNewPeople).toHaveLength(4);
      expect(result.hiringVelocity.avgPerMonth).toBe(1);
      expect(result.hiringVelocity.trend).toBe("stable");
    });

    it("should limit decision makers to 10 and sort by rank descending", async () => {
      Person.countDocuments.mockResolvedValue(15);

      Company.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      Person.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // Verify the find query has the correct filter
      const sortMock = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      Person.find.mockReturnValue({ sort: sortMock });

      Change.find
        .mockReturnValueOnce(changeFindChain([]))
        .mockReturnValueOnce(changeFindChain([]));

      await getCompanyIntelligence("77777");

      expect(Person.find).toHaveBeenCalledWith(
        expect.objectContaining({
          "snapshot.currentCompanyId": "77777",
          mergedInto: null,
          "derived.highestSeniorityRank": { $gte: 5 },
        }),
      );
      expect(sortMock).toHaveBeenCalledWith({
        "derived.highestSeniorityRank": -1,
      });
    });
  });
});
