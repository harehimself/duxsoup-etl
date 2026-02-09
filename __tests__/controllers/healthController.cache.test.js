jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/person", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/visit", () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
}));

jest.mock("../../src/models/scan", () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

const metricsCache = require("../../src/utils/metricsCache");
const Person = require("../../src/models/person");
const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");
const DeadLetter = require("../../src/models/deadLetter");
const {
  getIngestionHealth,
  getCanonicalCoverage,
} = require("../../src/controllers/healthController");

/**
 * Build a minimal Express req/res pair for testing handlers.
 */
function buildReqRes(query = {}) {
  const req = { query };
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

/**
 * Set up default mock return values for the ingestion handler's DB calls.
 */
function stubIngestionDefaults() {
  DeadLetter.countDocuments.mockResolvedValue(0);
  Visit.countDocuments.mockResolvedValue(10);
  Scan.countDocuments.mockResolvedValue(5);
}

describe("HealthController Caching", () => {
  beforeEach(() => {
    metricsCache.invalidateAll();
    jest.clearAllMocks();
  });

  describe("getIngestionHealth()", () => {
    it("should return cached data on second call without extra DB queries", async () => {
      stubIngestionDefaults();

      const { req: req1, res: res1 } = buildReqRes();
      await getIngestionHealth(req1, res1);

      const dbCallsAfterFirst =
        DeadLetter.countDocuments.mock.calls.length +
        Visit.countDocuments.mock.calls.length +
        Scan.countDocuments.mock.calls.length;

      // Second call — should hit cache
      const { req: req2, res: res2 } = buildReqRes();
      await getIngestionHealth(req2, res2);

      const dbCallsAfterSecond =
        DeadLetter.countDocuments.mock.calls.length +
        Visit.countDocuments.mock.calls.length +
        Scan.countDocuments.mock.calls.length;

      // No additional DB calls
      expect(dbCallsAfterSecond).toBe(dbCallsAfterFirst);

      // Both responses should be identical
      expect(res2.json).toHaveBeenCalledWith(res1.json.mock.calls[0][0]);
    });

    it("should bypass cache when ?fresh=true is provided", async () => {
      stubIngestionDefaults();

      const { req: req1, res: res1 } = buildReqRes();
      await getIngestionHealth(req1, res1);

      const dbCallsAfterFirst =
        DeadLetter.countDocuments.mock.calls.length +
        Visit.countDocuments.mock.calls.length +
        Scan.countDocuments.mock.calls.length;

      // Second call with fresh=true
      const { req: req2, res: res2 } = buildReqRes({ fresh: "true" });
      await getIngestionHealth(req2, res2);

      const dbCallsAfterSecond =
        DeadLetter.countDocuments.mock.calls.length +
        Visit.countDocuments.mock.calls.length +
        Scan.countDocuments.mock.calls.length;

      // DB was queried again
      expect(dbCallsAfterSecond).toBeGreaterThan(dbCallsAfterFirst);
    });

    it("should not cache error responses", async () => {
      DeadLetter.countDocuments.mockRejectedValueOnce(new Error("DB down"));

      const { req: req1, res: res1 } = buildReqRes();
      await getIngestionHealth(req1, res1);

      expect(res1.status).toHaveBeenCalledWith(500);

      // Cache should be empty — next call retries DB
      expect(metricsCache.getStats().keys).not.toContain("ingestion");
    });
  });

  describe("getCanonicalCoverage()", () => {
    it("should return cached data on second call", async () => {
      Person.countDocuments
        .mockResolvedValueOnce(100) // totalPeople
        .mockResolvedValueOnce(5); // missingCanonical

      const { req: req1, res: res1 } = buildReqRes();
      await getCanonicalCoverage(req1, res1);

      const callsAfterFirst = Person.countDocuments.mock.calls.length;

      const { req: req2, res: res2 } = buildReqRes();
      await getCanonicalCoverage(req2, res2);

      // No additional DB calls
      expect(Person.countDocuments.mock.calls.length).toBe(callsAfterFirst);
      expect(res2.json).toHaveBeenCalledWith(res1.json.mock.calls[0][0]);
    });

    it("should bypass cache with ?fresh=true", async () => {
      Person.countDocuments.mockResolvedValue(100);

      const { req: req1, res: res1 } = buildReqRes();
      await getCanonicalCoverage(req1, res1);

      const callsAfterFirst = Person.countDocuments.mock.calls.length;

      const { req: req2, res: res2 } = buildReqRes({ fresh: "true" });
      await getCanonicalCoverage(req2, res2);

      expect(Person.countDocuments.mock.calls.length).toBeGreaterThan(
        callsAfterFirst,
      );
    });
  });
});
