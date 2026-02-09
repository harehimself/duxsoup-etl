jest.mock("../../../src/models/person", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Person = require("../../../src/models/person");
const DeadLetter = require("../../../src/models/deadLetter");
const { runHealthCheck } = require("../../../src/workers/jobs/healthCheck");

describe("Health Check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: everything healthy
    Person.countDocuments.mockResolvedValue(0);
    DeadLetter.countDocuments.mockResolvedValue(0);
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
      // First call: total people count, second call: missing canonical_id count
      Person.countDocuments
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(0); // missing canonical_id
      DeadLetter.countDocuments.mockImplementation((query) => {
        if (query.status === "permanently_failed") return Promise.resolve(1);
        return Promise.resolve(0);
      });

      const report = await runHealthCheck();

      expect(report.status).toBe("warning");
    });
  });
});
