/**
 * Unit tests for GET /health/quality — structural data quality dashboard
 */

const metricsCache = require("../src/utils/metricsCache");

// Mock Person model
const mockAggregate = jest.fn();
jest.mock("../src/models/person", () => ({
  aggregate: (...args) => mockAggregate(...args),
}));

// Mock logger
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  getDataQualityDashboard,
} = require("../src/controllers/healthController");

function buildRes() {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return res;
}

function buildReq(query = {}) {
  return { query };
}

// Sample pipeline results
function sampleIdentity(total = 100) {
  return [
    {
      _id: null,
      total,
      withSalesNavId: 80,
      withNumericId: 90,
      withStableId: 95,
      withCanonicalId: 99,
    },
  ];
}

function sampleAliases() {
  return [
    { _id: "salesNavId", count: 80 },
    { _id: "numericId", count: 90 },
    { _id: "duxsoupId", count: 60 },
    { _id: "linkedInUsername", count: 70 },
    { _id: "vanityName", count: 50 },
    { _id: "publicUrl", count: 40 },
    { _id: "salesUrl", count: 30 },
    { _id: "recruiterUrl", count: 20 },
  ];
}

function sampleEnrichment(total = 100) {
  return [
    {
      _id: null,
      total,
      withRoles: 72,
      withEducation: 55,
      withSkills: 50,
      withEmail: 30,
      withPhone: 10,
    },
  ];
}

function sampleFreshness(total = 100) {
  return [
    {
      _id: null,
      total,
      updatedLast7d: 15,
      updatedLast30d: 40,
      stale90d: 25,
    },
  ];
}

function setupDefaultMocks(total = 100) {
  mockAggregate
    .mockResolvedValueOnce(sampleIdentity(total))
    .mockResolvedValueOnce(sampleAliases())
    .mockResolvedValueOnce(sampleEnrichment(total))
    .mockResolvedValueOnce(sampleFreshness(total));
}

beforeEach(() => {
  jest.clearAllMocks();
  metricsCache.invalidateAll();
});

describe("getDataQualityDashboard", () => {
  it("should return success with all four sections", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("totalPeople", 100);
    expect(body.data).toHaveProperty("identity");
    expect(body.data).toHaveProperty("aliases");
    expect(body.data).toHaveProperty("enrichment");
    expect(body.data).toHaveProperty("freshness");
    expect(body.data).toHaveProperty("timestamp");
  });

  it("should compute identity percentages correctly", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const { identity } = res.json.mock.calls[0][0].data;
    expect(identity.withSalesNavId).toEqual({ count: 80, percent: 80.0 });
    expect(identity.withNumericId).toEqual({ count: 90, percent: 90.0 });
    expect(identity.withStableId).toEqual({ count: 95, percent: 95.0 });
    expect(identity.withoutStableId).toEqual({ count: 5, percent: 5.0 });
    expect(identity.withCanonicalId).toEqual({ count: 99, percent: 99.0 });
    expect(identity.withoutCanonicalId).toEqual({ count: 1, percent: 1.0 });
  });

  it("should map alias type distribution correctly", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const { aliases } = res.json.mock.calls[0][0].data;
    expect(aliases).toEqual({
      salesNavId: 80,
      numericId: 90,
      duxsoupId: 60,
      linkedInUsername: 70,
      vanityName: 50,
      publicUrl: 40,
      salesUrl: 30,
      recruiterUrl: 20,
    });
  });

  it("should default missing alias types to 0", async () => {
    mockAggregate
      .mockResolvedValueOnce(sampleIdentity())
      .mockResolvedValueOnce([{ _id: "salesNavId", count: 5 }]) // Only one alias type
      .mockResolvedValueOnce(sampleEnrichment())
      .mockResolvedValueOnce(sampleFreshness());

    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const { aliases } = res.json.mock.calls[0][0].data;
    expect(aliases.salesNavId).toBe(5);
    expect(aliases.numericId).toBe(0);
    expect(aliases.recruiterUrl).toBe(0);
  });

  it("should compute enrichment coverage correctly", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const { enrichment } = res.json.mock.calls[0][0].data;
    expect(enrichment.withRoles).toEqual({ count: 72, percent: 72.0 });
    expect(enrichment.withoutRoles).toEqual({ count: 28, percent: 28.0 });
    expect(enrichment.withEducation).toEqual({ count: 55, percent: 55.0 });
    expect(enrichment.withSkills).toEqual({ count: 50, percent: 50.0 });
    expect(enrichment.withEmail).toEqual({ count: 30, percent: 30.0 });
    expect(enrichment.withPhone).toEqual({ count: 10, percent: 10.0 });
  });

  it("should compute freshness buckets correctly", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const { freshness } = res.json.mock.calls[0][0].data;
    expect(freshness.updatedLast7d).toEqual({ count: 15, percent: 15.0 });
    expect(freshness.updatedLast30d).toEqual({ count: 40, percent: 40.0 });
    expect(freshness.stale90d).toEqual({ count: 25, percent: 25.0 });
  });

  it("should handle empty database (zero people)", async () => {
    mockAggregate
      .mockResolvedValueOnce([]) // Empty identity
      .mockResolvedValueOnce([]) // Empty aliases
      .mockResolvedValueOnce([]) // Empty enrichment
      .mockResolvedValueOnce([]); // Empty freshness

    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totalPeople).toBe(0);
    expect(body.data.identity.withSalesNavId.percent).toBe(0);
    expect(body.data.aliases.salesNavId).toBe(0);
    expect(body.data.enrichment.withRoles.percent).toBe(0);
    expect(body.data.freshness.updatedLast7d.percent).toBe(0);
  });

  it("should use cache and bypass with fresh=true", async () => {
    // First call — fills cache
    setupDefaultMocks();
    const req1 = buildReq();
    const res1 = buildRes();
    await getDataQualityDashboard(req1, res1);
    expect(mockAggregate).toHaveBeenCalledTimes(4);

    // Second call — should use cache (no new aggregate calls)
    const req2 = buildReq();
    const res2 = buildRes();
    await getDataQualityDashboard(req2, res2);
    expect(mockAggregate).toHaveBeenCalledTimes(4); // Still 4

    // Third call with fresh=true — should bypass cache
    setupDefaultMocks();
    const req3 = buildReq({ fresh: "true" });
    const res3 = buildRes();
    await getDataQualityDashboard(req3, res3);
    expect(mockAggregate).toHaveBeenCalledTimes(8); // 4 new calls
  });

  it("should return 500 on database error", async () => {
    mockAggregate.mockRejectedValueOnce(new Error("Connection timeout"));

    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to compute data quality dashboard",
      }),
    );
  });

  it("should run 4 parallel aggregation pipelines", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    expect(mockAggregate).toHaveBeenCalledTimes(4);
  });

  it("should exclude merged records from all pipelines", async () => {
    setupDefaultMocks();
    const req = buildReq();
    const res = buildRes();

    await getDataQualityDashboard(req, res);

    // All 4 pipelines should have mergedInto: { $exists: false } as $match
    for (let i = 0; i < 4; i++) {
      const pipeline = mockAggregate.mock.calls[i][0];
      const matchStage = pipeline[0];
      expect(matchStage).toEqual({
        $match: { mergedInto: { $exists: false } },
      });
    }
  });
});
