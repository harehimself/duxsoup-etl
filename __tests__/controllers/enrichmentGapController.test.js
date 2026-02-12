jest.mock("../../src/services/enrichmentGapService", () => ({
  getEnrichmentGaps: jest.fn(),
  getRevisitList: jest.fn(),
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

const enrichmentGapService = require("../../src/services/enrichmentGapService");
const metricsCache = require("../../src/utils/metricsCache");
const {
  getEnrichmentGaps,
  getRevisitList,
} = require("../../src/controllers/enrichmentGapController");

function mockReqRes(query = {}) {
  const req = { query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

const sampleGapResult = {
  summary: { totalPeople: 100, fieldsAnalyzed: 8, avgGapPercent: 45.2 },
  fieldGaps: [
    {
      field: "phone",
      weight: 20,
      missingCount: 80,
      totalCount: 100,
      missingPercent: 80.0,
    },
    {
      field: "email",
      weight: 30,
      missingCount: 50,
      totalCount: 100,
      missingPercent: 50.0,
    },
  ],
  seniorityBreakdown: [
    {
      seniority: "VP",
      count: 40,
      missingEmail: 15,
      missingPhone: 25,
      missingRoles: 10,
    },
  ],
};

const sampleRevisitList = [
  {
    personId: "p1",
    name: "Jane Doe",
    currentTitle: "VP Engineering",
    currentCompany: "Acme Corp",
    profileUrl: "https://www.linkedin.com/in/janedoe",
    gapScore: 50,
    contactValue: 80,
    priorityScore: 130,
    missingFields: ["email", "phone"],
    lastObservedAt: new Date("2026-02-10"),
  },
  {
    personId: "p2",
    name: "John Smith",
    currentTitle: "Manager",
    currentCompany: "Beta Inc",
    profileUrl: "https://www.linkedin.com/in/johnsmith",
    gapScore: 30,
    contactValue: 40,
    priorityScore: 70,
    missingFields: ["email"],
    lastObservedAt: new Date("2026-01-15"),
  },
];

describe("enrichmentGapController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    metricsCache.getOrFetch.mockImplementation((_key, fetchFn) => fetchFn());
  });

  // ── getEnrichmentGaps ─────────────────────────────────────

  describe("getEnrichmentGaps()", () => {
    it("should return 200 with gap analysis data", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes();
      await getEnrichmentGaps(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleGapResult,
          metadata: expect.objectContaining({
            generatedAt: expect.any(String),
            cached: true,
          }),
        }),
      );
    });

    it("should pass filters to service", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes({
        seniority: "VP",
        minRank: "5",
        company: "Acme",
        companyId: "comp1",
      });
      await getEnrichmentGaps(req, res, next);

      const fetchFn = metricsCache.getOrFetch.mock.calls[0][1];
      await fetchFn();

      expect(enrichmentGapService.getEnrichmentGaps).toHaveBeenCalledWith(
        expect.objectContaining({
          seniority: "VP",
          minRank: 5,
          company: "Acme",
          companyId: "comp1",
        }),
      );
    });

    it("should pass comma-separated fields filter", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes({ fields: "email,phone" });
      await getEnrichmentGaps(req, res, next);

      const fetchFn = metricsCache.getOrFetch.mock.calls[0][1];
      await fetchFn();

      expect(enrichmentGapService.getEnrichmentGaps).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: ["email", "phone"],
        }),
      );
    });

    it("should bypass cache when fresh=true", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes({ fresh: "true" });
      await getEnrichmentGaps(req, res, next);

      expect(metricsCache.getOrFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        0,
      );
    });

    it("should use cache when fresh is not set", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes();
      await getEnrichmentGaps(req, res, next);

      const ttl = metricsCache.getOrFetch.mock.calls[0][2];
      expect(ttl).toBeGreaterThan(0);
    });

    it("should clamp minRank between 1 and 8", async () => {
      enrichmentGapService.getEnrichmentGaps.mockResolvedValue(sampleGapResult);

      const { req, res, next } = mockReqRes({ minRank: "15" });
      await getEnrichmentGaps(req, res, next);

      const fetchFn = metricsCache.getOrFetch.mock.calls[0][1];
      await fetchFn();

      expect(enrichmentGapService.getEnrichmentGaps).toHaveBeenCalledWith(
        expect.objectContaining({ minRank: 8 }),
      );
    });

    it("should call next(error) on service failure", async () => {
      metricsCache.getOrFetch.mockRejectedValue(new Error("DB failure"));

      const { req, res, next } = mockReqRes();
      await getEnrichmentGaps(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ── getRevisitList ────────────────────────────────────────

  describe("getRevisitList()", () => {
    it("should return CSV by default", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue(sampleRevisitList);

      const { req, res, next } = mockReqRes();
      await getRevisitList(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        "attachment; filename=revisit-list.csv",
      );
      expect(res.send).toHaveBeenCalled();

      const csv = res.send.mock.calls[0][0];
      expect(csv).toContain("Profile URL");
      expect(csv).toContain("Jane Doe");
    });

    it("should return JSON when format=json", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue(sampleRevisitList);

      const { req, res, next } = mockReqRes({ format: "json" });
      await getRevisitList(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: sampleRevisitList,
          total: 2,
          metadata: expect.objectContaining({
            generatedAt: expect.any(String),
          }),
        }),
      );
    });

    it("should cap limit to ENRICHMENT_GAP_MAX_LIMIT (500)", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue([]);

      const { req, res, next } = mockReqRes({ limit: "9999", format: "json" });
      await getRevisitList(req, res, next);

      expect(enrichmentGapService.getRevisitList).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 }),
      );
    });

    it("should pass minScore to service", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue([]);

      const { req, res, next } = mockReqRes({
        minScore: "50",
        format: "json",
      });
      await getRevisitList(req, res, next);

      expect(enrichmentGapService.getRevisitList).toHaveBeenCalledWith(
        expect.objectContaining({ minScore: 50 }),
      );
    });

    it("should handle CSV escaping for fields with commas", async () => {
      const listWithComma = [
        {
          ...sampleRevisitList[0],
          currentTitle: "VP, Engineering",
        },
      ];
      enrichmentGapService.getRevisitList.mockResolvedValue(listWithComma);

      const { req, res, next } = mockReqRes();
      await getRevisitList(req, res, next);

      const csv = res.send.mock.calls[0][0];
      expect(csv).toContain('"VP, Engineering"');
    });

    it("should pass filter options to service", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue([]);

      const { req, res, next } = mockReqRes({
        seniority: "CXO",
        company: "Acme",
        format: "json",
      });
      await getRevisitList(req, res, next);

      expect(enrichmentGapService.getRevisitList).toHaveBeenCalledWith(
        expect.objectContaining({
          seniority: "CXO",
          company: "Acme",
        }),
      );
    });

    it("should call next(error) on service failure", async () => {
      enrichmentGapService.getRevisitList.mockRejectedValue(
        new Error("DB failure"),
      );

      const { req, res, next } = mockReqRes({ format: "json" });
      await getRevisitList(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should default minScore to 0", async () => {
      enrichmentGapService.getRevisitList.mockResolvedValue([]);

      const { req, res, next } = mockReqRes({ format: "json" });
      await getRevisitList(req, res, next);

      expect(enrichmentGapService.getRevisitList).toHaveBeenCalledWith(
        expect.objectContaining({ minScore: 0 }),
      );
    });
  });
});
