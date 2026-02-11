/**
 * Unit tests for untested healthController endpoints:
 * - getIngestionHealth (business logic, not just caching)
 * - getParityHealth
 * - getCoverageBreakdown
 * - getCompanyCoverage
 * - getLocationCoverage
 * - getMetrics
 * - getDataQuality
 * - getDashboard
 * - testNotifications
 */

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/person", () => ({
  countDocuments: jest.fn(),
  distinct: jest.fn(),
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

jest.mock("../../src/models/company", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/location", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/change", () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../src/services/notificationService", () => ({
  testNotifications: jest.fn(),
}));

const metricsCache = require("../../src/utils/metricsCache");
const Person = require("../../src/models/person");
const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");
const DeadLetter = require("../../src/models/deadLetter");
const Company = require("../../src/models/company");
const Location = require("../../src/models/location");
const Change = require("../../src/models/change");
const notificationService = require("../../src/services/notificationService");

const {
  getIngestionHealth,
  getParityHealth,
  getCoverageBreakdown,
  getCompanyCoverage,
  getLocationCoverage,
  getMetrics,
  getDataQuality,
  getDashboard,
  testNotifications,
} = require("../../src/controllers/healthController");

function buildReqRes(query = {}) {
  const req = { query };
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

/**
 * Build a fresh Change.find() chain mock.
 * Must be called in beforeEach because jest config has resetMocks: true
 * which clears all mock implementations between tests.
 */
function setupChangeFindChain() {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  };
  Change.find.mockReturnValue(chain);
  return chain;
}

let changeFindChain;

beforeEach(() => {
  jest.clearAllMocks();
  metricsCache.invalidateAll();
  changeFindChain = setupChangeFindChain();
});

// ---------------------------------------------------------------------------
// getIngestionHealth — business logic
// ---------------------------------------------------------------------------
describe("getIngestionHealth()", () => {
  function stubDefaults({
    deadPending = 0,
    deadFailed = 0,
    visits24h = 80,
    scans24h = 20,
    deadCreated24h = 0,
  } = {}) {
    DeadLetter.countDocuments.mockImplementation((query) => {
      if (query && query.status === "pending")
        return Promise.resolve(deadPending);
      if (query && query.status === "failed_again")
        return Promise.resolve(deadFailed);
      if (query && query.createdAt) return Promise.resolve(deadCreated24h);
      return Promise.resolve(0);
    });
    Visit.countDocuments.mockResolvedValue(visits24h);
    Scan.countDocuments.mockResolvedValue(scans24h);
  }

  it("should return healthy when success rate >= 95%", async () => {
    stubDefaults({ visits24h: 100, scans24h: 0, deadCreated24h: 3 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("healthy");
    expect(body.metrics.people_upsert_success_rate_24h).toBe(97);
    expect(body.metrics.total_observations_24h).toBe(100);
    expect(body.alerts).toEqual([]);
  });

  it("should return degraded when success rate between 90-95%", async () => {
    stubDefaults({ visits24h: 100, scans24h: 0, deadCreated24h: 8 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("degraded");
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("should return unhealthy when success rate < 90%", async () => {
    stubDefaults({ visits24h: 100, scans24h: 0, deadCreated24h: 15 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("unhealthy");
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ level: "critical" }),
    );
  });

  it("should default to 100% success rate when no observations", async () => {
    stubDefaults({ visits24h: 0, scans24h: 0, deadCreated24h: 0 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("healthy");
    expect(body.metrics.people_upsert_success_rate_24h).toBe(100);
  });

  it("should alert when pending dead letters > 100", async () => {
    stubDefaults({ deadPending: 150, visits24h: 200, scans24h: 0 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.alerts).toContainEqual(
      expect.objectContaining({
        level: "warning",
        message: expect.stringContaining("150"),
      }),
    );
  });

  it("should alert critical when failed_again dead letters > 10", async () => {
    stubDefaults({ deadFailed: 15, visits24h: 200, scans24h: 0 });
    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.alerts).toContainEqual(
      expect.objectContaining({
        level: "critical",
        message: expect.stringContaining("15"),
      }),
    );
  });

  it("should return 500 on database error", async () => {
    DeadLetter.countDocuments.mockRejectedValue(new Error("DB timeout"));
    Visit.countDocuments.mockResolvedValue(0);
    Scan.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getIngestionHealth(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: "Failed to compute ingestion health",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getParityHealth
// ---------------------------------------------------------------------------
describe("getParityHealth()", () => {
  function stubParity({
    visitProfiles = ["p1", "p2", "p3"],
    scanProfiles = ["p2", "p3", "p4"],
    totalPeople = 4,
    deadPending = 0,
  } = {}) {
    Visit.distinct.mockResolvedValue(visitProfiles);
    Scan.distinct.mockResolvedValue(scanProfiles);
    Person.countDocuments.mockResolvedValue(totalPeople);
    DeadLetter.countDocuments.mockResolvedValue(deadPending);
  }

  it("should return ready when coverage >= 98% and dead letters < 10", async () => {
    stubParity({
      visitProfiles: ["a", "b"],
      scanProfiles: ["b", "c"],
      totalPeople: 3,
    });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("ready");
    expect(body.ready_for_cutover).toBe(true);
    expect(body.metrics.coverage_ratio).toBe(1);
    expect(body.metrics.coverage_percent).toBe(100);
  });

  it("should return building when coverage between 90-98%", async () => {
    // 10 unique profiles, 9.5 people → 95% → building
    stubParity({
      visitProfiles: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      scanProfiles: [],
      totalPeople: 9,
    });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("building");
  });

  it("should return incomplete when coverage < 90%", async () => {
    stubParity({
      visitProfiles: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      scanProfiles: [],
      totalPeople: 5,
    });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("incomplete");
    expect(body.ready_for_cutover).toBe(false);
    expect(body.blockers).toContainEqual(expect.stringContaining("below 98%"));
  });

  it("should include dead letter blocker when pending >= 10", async () => {
    stubParity({ totalPeople: 3, deadPending: 25 });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.cutover_gates.dead_letters_near_zero).toBe(false);
    expect(body.blockers).toContainEqual(
      expect.stringContaining("25 pending dead letters"),
    );
  });

  it("should compute union of visit and scan profiles without duplication", async () => {
    stubParity({
      visitProfiles: ["a", "b", "c"],
      scanProfiles: ["b", "c", "d"],
      totalPeople: 4,
    });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    // Union is {a, b, c, d} = 4, people = 4 → 100%
    expect(body.metrics.estimated_legacy_people).toBe(4);
    expect(body.metrics.distinct_people_in_visits).toBe(3);
    expect(body.metrics.distinct_people_in_scans).toBe(3);
  });

  it("should handle zero legacy profiles gracefully", async () => {
    stubParity({ visitProfiles: [], scanProfiles: [], totalPeople: 0 });
    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.metrics.coverage_ratio).toBe(0);
  });

  it("should return 500 on database error", async () => {
    Visit.distinct.mockRejectedValue(new Error("Aggregation failed"));
    Scan.distinct.mockResolvedValue([]);
    Person.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getParityHealth(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to compute parity health" }),
    );
  });
});

// ---------------------------------------------------------------------------
// getCoverageBreakdown
// ---------------------------------------------------------------------------
describe("getCoverageBreakdown()", () => {
  function stubBreakdown({
    total = 100,
    salesNav = 60,
    numeric = 30,
    urlFallbackOnly = 8,
    upgradable = 2,
  } = {}) {
    Person.countDocuments.mockImplementation((query) => {
      if (!query) return Promise.resolve(total);
      if (
        query._id &&
        query._id.$regex &&
        String(query._id.$regex).includes("AC")
      ) {
        return Promise.resolve(salesNav);
      }
      if (
        query._id &&
        query._id.$regex &&
        String(query._id.$regex).includes("\\d")
      ) {
        return Promise.resolve(numeric);
      }
      if (query._id && query.$and) return Promise.resolve(urlFallbackOnly);
      if (query._id && query["aliases.type"])
        return Promise.resolve(upgradable);
      return Promise.resolve(0);
    });
  }

  it("should return identity source breakdown with percentages", async () => {
    stubBreakdown();
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_people).toBe(100);
    expect(body.by_identity_source.sales_nav_id).toBe(60);
    expect(body.by_identity_source.member_numeric_id).toBe(30);
    expect(body.by_identity_source.public_url_fallback).toBe(10);
    expect(body.percentages.sales_nav_id).toBe(60);
    expect(body.percentages.member_numeric_id).toBe(30);
  });

  it("should include url_fallback_analysis", async () => {
    stubBreakdown({ urlFallbackOnly: 8, upgradable: 3 });
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.url_fallback_analysis.url_fallback_only).toBe(8);
    expect(body.url_fallback_analysis.upgradable_to_stable_id).toBe(3);
    expect(body.url_fallback_analysis.stuck_on_url).toBe(5);
  });

  it("should recommend run_linking_job when upgradable > 0", async () => {
    stubBreakdown({ upgradable: 5 });
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.recommendations).toContainEqual(
      expect.objectContaining({ action: "run_linking_job" }),
    );
  });

  it("should recommend investigate_observations when stuck_on_url > 0", async () => {
    stubBreakdown({ urlFallbackOnly: 10, upgradable: 3 });
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.recommendations).toContainEqual(
      expect.objectContaining({ action: "investigate_observations" }),
    );
  });

  it("should return empty recommendations when no issues", async () => {
    stubBreakdown({ urlFallbackOnly: 0, upgradable: 0 });
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.recommendations).toEqual([]);
  });

  it("should return 500 on database error", async () => {
    Person.countDocuments.mockRejectedValue(new Error("Query error"));
    const { req, res } = buildReqRes();
    await getCoverageBreakdown(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Failed to compute coverage breakdown",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getCompanyCoverage
// ---------------------------------------------------------------------------
describe("getCompanyCoverage()", () => {
  it("should return company canonical_id coverage", async () => {
    Company.countDocuments
      .mockResolvedValueOnce(200) // total
      .mockResolvedValueOnce(10); // missing

    const { req, res } = buildReqRes();
    await getCompanyCoverage(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_companies).toBe(200);
    expect(body.canonical_id_present).toBe(190);
    expect(body.canonical_id_missing).toBe(10);
    expect(body.coverage_percent).toBe(95);
  });

  it("should handle zero companies gracefully", async () => {
    Company.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getCompanyCoverage(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_companies).toBe(0);
    expect(body.coverage_ratio).toBe(1);
  });

  it("should return 500 on database error", async () => {
    Company.countDocuments.mockRejectedValue(new Error("Company DB error"));

    const { req, res } = buildReqRes();
    await getCompanyCoverage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to compute company coverage" }),
    );
  });
});

// ---------------------------------------------------------------------------
// getLocationCoverage
// ---------------------------------------------------------------------------
describe("getLocationCoverage()", () => {
  it("should return location canonical_id coverage", async () => {
    Location.countDocuments
      .mockResolvedValueOnce(50) // total
      .mockResolvedValueOnce(5); // missing

    const { req, res } = buildReqRes();
    await getLocationCoverage(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_locations).toBe(50);
    expect(body.canonical_id_present).toBe(45);
    expect(body.canonical_id_missing).toBe(5);
    expect(body.coverage_percent).toBe(90);
  });

  it("should handle zero locations gracefully", async () => {
    Location.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getLocationCoverage(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.total_locations).toBe(0);
    expect(body.coverage_ratio).toBe(1);
  });

  it("should return 500 on database error", async () => {
    Location.countDocuments.mockRejectedValue(new Error("Location DB error"));

    const { req, res } = buildReqRes();
    await getLocationCoverage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to compute location coverage" }),
    );
  });
});

// ---------------------------------------------------------------------------
// getMetrics
// ---------------------------------------------------------------------------
describe("getMetrics()", () => {
  function stubMetrics({
    deadPending = 2,
    visits24h = 50,
    scans24h = 30,
    deadCreated24h = 1,
    totalPeople = 500,
  } = {}) {
    DeadLetter.countDocuments.mockImplementation((query) => {
      if (query && query.status === "pending")
        return Promise.resolve(deadPending);
      if (query && query.createdAt) return Promise.resolve(deadCreated24h);
      return Promise.resolve(0);
    });
    Visit.countDocuments.mockResolvedValue(visits24h);
    Scan.countDocuments.mockResolvedValue(scans24h);
    Person.countDocuments.mockResolvedValue(totalPeople);
  }

  it("should return combined ingestion and parity metrics", async () => {
    stubMetrics();
    const { req, res } = buildReqRes();
    await getMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty("ingestion");
    expect(body).toHaveProperty("parity");
    expect(body).toHaveProperty("timestamp");
    expect(body.ingestion.dead_letters_pending).toBe(2);
    expect(body.parity.people_count).toBe(500);
  });

  it("should calculate success rate correctly", async () => {
    stubMetrics({ visits24h: 100, scans24h: 0, deadCreated24h: 5 });
    const { req, res } = buildReqRes();
    await getMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.ingestion.success_rate_24h).toBe(95);
  });

  it("should default to 100% when no observations", async () => {
    stubMetrics({ visits24h: 0, scans24h: 0, deadCreated24h: 0 });
    const { req, res } = buildReqRes();
    await getMetrics(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.ingestion.success_rate_24h).toBe(100);
  });

  it("should return 500 on database error", async () => {
    DeadLetter.countDocuments.mockRejectedValue(new Error("Metrics error"));
    Visit.countDocuments.mockResolvedValue(0);
    Scan.countDocuments.mockResolvedValue(0);
    Person.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getMetrics(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to compute metrics" }),
    );
  });
});

// ---------------------------------------------------------------------------
// getDataQuality
// ---------------------------------------------------------------------------
describe("getDataQuality()", () => {
  function stubQuality({
    total = 100,
    missingTitle = 10,
    missingCompany = 20,
    missingLocation = 15,
    missingEmail = 60,
    missingConnections = 5,
  } = {}) {
    let callCount = 0;
    Person.countDocuments.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(total);
      // The 5 parallel missing-field queries
      const missingValues = [
        missingTitle,
        missingCompany,
        missingLocation,
        missingEmail,
        missingConnections,
      ];
      return Promise.resolve(missingValues[callCount - 2] || 0);
    });
  }

  it("should return field completeness for all 5 fields", async () => {
    stubQuality();
    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totalPeople).toBe(100);
    expect(body.data.fields).toHaveProperty("currentTitle");
    expect(body.data.fields).toHaveProperty("currentCompany");
    expect(body.data.fields).toHaveProperty("location");
    expect(body.data.fields).toHaveProperty("email");
    expect(body.data.fields).toHaveProperty("connections");
  });

  it("should calculate field coverage percentages correctly", async () => {
    stubQuality({ total: 200, missingTitle: 50 });
    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.fields.currentTitle.present).toBe(150);
    expect(body.data.fields.currentTitle.missing).toBe(50);
    expect(body.data.fields.currentTitle.coverage).toBe(75);
  });

  it("should calculate overall completeness across all fields", async () => {
    // 100 people, all fields missing = 0% completeness
    stubQuality({
      total: 100,
      missingTitle: 100,
      missingCompany: 100,
      missingLocation: 100,
      missingEmail: 100,
      missingConnections: 100,
    });
    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.overallCompleteness).toBe(0);
  });

  it("should handle zero people gracefully", async () => {
    Person.countDocuments.mockResolvedValue(0);

    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.totalPeople).toBe(0);
    expect(body.data.overallCompleteness).toBe(0);
  });

  it("should include timestamp", async () => {
    stubQuality();
    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data).toHaveProperty("timestamp");
    expect(new Date(body.data.timestamp).getTime()).not.toBeNaN();
  });

  it("should return 500 on database error", async () => {
    Person.countDocuments.mockRejectedValue(new Error("Quality error"));

    const { req, res } = buildReqRes();
    await getDataQuality(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to compute data quality",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getDashboard
// ---------------------------------------------------------------------------
describe("getDashboard()", () => {
  function stubDashboard({
    totalPeople = 1000,
    totalCompanies = 200,
    totalVisits = 5000,
    totalScans = 3000,
    visits24h = 50,
    scans24h = 30,
    deadPending = 2,
    deadFailed = 0,
    deadCreated24h = 1,
    changesLast7d = 15,
    recentChanges = [{ type: "company_change", personId: "p1" }],
  } = {}) {
    Person.countDocuments.mockResolvedValue(totalPeople);
    Company.countDocuments.mockResolvedValue(totalCompanies);

    // Visit.countDocuments called twice: total and 24h
    let visitCallCount = 0;
    Visit.countDocuments.mockImplementation(() => {
      visitCallCount++;
      return Promise.resolve(visitCallCount === 1 ? totalVisits : visits24h);
    });

    let scanCallCount = 0;
    Scan.countDocuments.mockImplementation(() => {
      scanCallCount++;
      return Promise.resolve(scanCallCount === 1 ? totalScans : scans24h);
    });

    DeadLetter.countDocuments.mockImplementation((query) => {
      if (query && query.status === "pending")
        return Promise.resolve(deadPending);
      if (query && query.status === "failed_again")
        return Promise.resolve(deadFailed);
      if (query && query.createdAt) return Promise.resolve(deadCreated24h);
      return Promise.resolve(0);
    });

    Change.countDocuments.mockResolvedValue(changesLast7d);
    changeFindChain.lean.mockResolvedValue(recentChanges);
  }

  it("should return consolidated dashboard with all sections", async () => {
    stubDashboard();
    const { req, res } = buildReqRes();
    await getDashboard(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("summary");
    expect(body.data).toHaveProperty("ingestion");
    expect(body.data).toHaveProperty("changes");
    expect(body.data).toHaveProperty("timestamp");
  });

  it("should populate summary counts correctly", async () => {
    stubDashboard({
      totalPeople: 1000,
      totalCompanies: 200,
      totalVisits: 5000,
      totalScans: 3000,
    });
    const { req, res } = buildReqRes();
    await getDashboard(req, res);

    const { summary } = res.json.mock.calls[0][0].data;
    expect(summary.totalPeople).toBe(1000);
    expect(summary.totalCompanies).toBe(200);
    expect(summary.totalObservations).toBe(8000);
  });

  it("should calculate ingestion status correctly", async () => {
    stubDashboard({ visits24h: 100, scans24h: 0, deadCreated24h: 2 });
    const { req, res } = buildReqRes();
    await getDashboard(req, res);

    const { ingestion } = res.json.mock.calls[0][0].data;
    expect(ingestion.successRate24h).toBe(98);
    expect(ingestion.status).toBe("healthy");
  });

  it("should include recent changes", async () => {
    const changes = [
      { type: "company_change", personId: "p1" },
      { type: "promotion", personId: "p2" },
    ];
    stubDashboard({ recentChanges: changes, changesLast7d: 25 });
    const { req, res } = buildReqRes();
    await getDashboard(req, res);

    const { changes: changesSection } = res.json.mock.calls[0][0].data;
    expect(changesSection.last7Days).toBe(25);
    expect(changesSection.recent).toHaveLength(2);
  });

  it("should return 500 on database error", async () => {
    Person.countDocuments.mockRejectedValue(new Error("Dashboard error"));
    Company.countDocuments.mockResolvedValue(0);
    Visit.countDocuments.mockResolvedValue(0);
    Scan.countDocuments.mockResolvedValue(0);
    DeadLetter.countDocuments.mockResolvedValue(0);
    Change.countDocuments.mockResolvedValue(0);
    changeFindChain.lean.mockResolvedValue([]);

    const { req, res } = buildReqRes();
    await getDashboard(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to compute dashboard",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// testNotifications
// ---------------------------------------------------------------------------
describe("testNotifications()", () => {
  it("should return notification test results on success", async () => {
    const mockResults = { email: "sent", sms: "sent" };
    notificationService.testNotifications.mockResolvedValue(mockResults);

    const { req, res } = buildReqRes();
    await testNotifications(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockResults,
    });
  });

  it("should return 500 when notification service throws", async () => {
    notificationService.testNotifications.mockRejectedValue(
      new Error("SMTP config missing"),
    );

    const { req, res } = buildReqRes();
    await testNotifications(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to test notifications",
      }),
    );
  });
});
