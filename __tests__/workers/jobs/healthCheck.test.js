jest.mock("../../../src/models/person", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

const mockVisitChain = {
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn(),
};

jest.mock("../../../src/models/visit", () => ({
  findOne: jest.fn(() => mockVisitChain),
}));

const mockScanChain = {
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn(),
};

jest.mock("../../../src/models/scan", () => ({
  findOne: jest.fn(() => mockScanChain),
}));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Person = require("../../../src/models/person");
const DeadLetter = require("../../../src/models/deadLetter");
const Visit = require("../../../src/models/visit");
const Scan = require("../../../src/models/scan");
const { runHealthCheck } = require("../../../src/workers/jobs/healthCheck");

describe("Health Check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: everything healthy
    Person.countDocuments.mockResolvedValue(0);
    DeadLetter.countDocuments.mockResolvedValue(0);

    // Default: fresh data (1 hour old)
    Visit.findOne.mockReturnValue(mockVisitChain);
    mockVisitChain.sort.mockReturnThis();
    mockVisitChain.select.mockReturnThis();
    mockVisitChain.lean.mockResolvedValue({
      VisitTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    Scan.findOne.mockReturnValue(mockScanChain);
    mockScanChain.sort.mockReturnThis();
    mockScanChain.select.mockReturnThis();
    mockScanChain.lean.mockResolvedValue({
      ScanTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
  });

  describe("permanently_failed dead letters", () => {
    it("should include permanentlyFailedDeadLetters in metrics", async () => {
      Person.countDocuments.mockResolvedValue(100);
      DeadLetter.countDocuments.mockImplementation((query) => {
        if (query.status === "pending") return Promise.resolve(0);
        if (query.status === "failed_again") return Promise.resolve(0);
        if (query.status === "permanently_failed") return Promise.resolve(5);
        return Promise.resolve(0);
      });

      const report = await runHealthCheck();

      expect(report.metrics.permanentlyFailedDeadLetters).toBe(5);
    });

    it("should add warning when permanently_failed count > 0", async () => {
      Person.countDocuments.mockResolvedValue(100);
      DeadLetter.countDocuments.mockImplementation((query) => {
        if (query.status === "permanently_failed") return Promise.resolve(3);
        return Promise.resolve(0);
      });

      const report = await runHealthCheck();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          type: "permanently_failed_dead_letters",
          severity: "warning",
          message: expect.stringContaining("3"),
        }),
      );
    });

    it("should not add warning when permanently_failed count is 0", async () => {
      Person.countDocuments.mockResolvedValue(100);
      DeadLetter.countDocuments.mockResolvedValue(0);

      const report = await runHealthCheck();

      expect(report.metrics.permanentlyFailedDeadLetters).toBe(0);
      const permWarning = report.warnings.find(
        (w) => w.type === "permanently_failed_dead_letters",
      );
      expect(permWarning).toBeUndefined();
    });

    it("should set report status to warning when permanently_failed exist", async () => {
      Person.countDocuments.mockResolvedValueOnce(100).mockResolvedValueOnce(0);
      DeadLetter.countDocuments.mockImplementation((query) => {
        if (query.status === "permanently_failed") return Promise.resolve(1);
        return Promise.resolve(0);
      });

      const report = await runHealthCheck();

      expect(report.status).toBe("warning");
    });
  });

  describe("data freshness", () => {
    it("should not add warnings when both visits and scans are fresh", async () => {
      const report = await runHealthCheck();

      const freshnessWarnings = report.warnings.filter((w) =>
        ["stale_visits", "stale_scans", "no_visits", "no_scans"].includes(
          w.type,
        ),
      );
      expect(freshnessWarnings).toHaveLength(0);
    });

    it("should warn when visits are stale", async () => {
      mockVisitChain.lean.mockResolvedValue({
        VisitTime: new Date(Date.now() - 10 * 60 * 60 * 1000),
      });

      const report = await runHealthCheck();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          type: "stale_visits",
          severity: "warning",
        }),
      );
    });

    it("should warn when scans are stale", async () => {
      mockScanChain.lean.mockResolvedValue({
        ScanTime: new Date(Date.now() - 10 * 60 * 60 * 1000),
      });

      const report = await runHealthCheck();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          type: "stale_scans",
          severity: "warning",
        }),
      );
    });

    it("should warn when both visits and scans are stale", async () => {
      mockVisitChain.lean.mockResolvedValue({
        VisitTime: new Date(Date.now() - 10 * 60 * 60 * 1000),
      });
      mockScanChain.lean.mockResolvedValue({
        ScanTime: new Date(Date.now() - 10 * 60 * 60 * 1000),
      });

      const report = await runHealthCheck();

      const staleWarnings = report.warnings.filter((w) =>
        ["stale_visits", "stale_scans"].includes(w.type),
      );
      expect(staleWarnings).toHaveLength(2);
    });

    it("should warn when no visits exist", async () => {
      mockVisitChain.lean.mockResolvedValue(null);

      const report = await runHealthCheck();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          type: "no_visits",
          severity: "warning",
        }),
      );
    });

    it("should warn when no scans exist", async () => {
      mockScanChain.lean.mockResolvedValue(null);

      const report = await runHealthCheck();

      expect(report.warnings).toContainEqual(
        expect.objectContaining({
          type: "no_scans",
          severity: "warning",
        }),
      );
    });

    it("should populate freshness metrics", async () => {
      const visitTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const scanTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
      mockVisitChain.lean.mockResolvedValue({ VisitTime: visitTime });
      mockScanChain.lean.mockResolvedValue({ ScanTime: scanTime });

      const report = await runHealthCheck();

      expect(report.metrics.lastVisitTime).toEqual(visitTime);
      expect(report.metrics.lastScanTime).toEqual(scanTime);
      expect(report.metrics.visitAgeHours).toBeCloseTo(2, 0);
      expect(report.metrics.scanAgeHours).toBeCloseTo(3, 0);
      expect(report.metrics.dataFreshnessThresholdHours).toBe(6);
    });

    it("should not warn when data is just under threshold", async () => {
      // 5 hours 59 minutes old — under the 6-hour threshold
      const justUnder = 5 * 60 * 60 * 1000 + 59 * 60 * 1000;
      mockVisitChain.lean.mockResolvedValue({
        VisitTime: new Date(Date.now() - justUnder),
      });
      mockScanChain.lean.mockResolvedValue({
        ScanTime: new Date(Date.now() - justUnder),
      });

      const report = await runHealthCheck();

      const staleWarnings = report.warnings.filter((w) =>
        ["stale_visits", "stale_scans"].includes(w.type),
      );
      expect(staleWarnings).toHaveLength(0);
    });
  });
});
