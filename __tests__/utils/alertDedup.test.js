const {
  computeHash,
  isDuplicate,
  record,
  getStats,
  _reset,
} = require("../../src/utils/alertDedup");

describe("alertDedup", () => {
  beforeEach(() => {
    _reset();
  });

  describe("computeHash()", () => {
    it("should return a hex string", () => {
      const hash = computeHash({
        status: "critical",
        criticalIssues: [{ message: "Dead letters above threshold" }],
      });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce the same hash for same issues in different order", () => {
      const report1 = {
        status: "critical",
        criticalIssues: [
          { message: "Issue A", recommendation: "Fix A" },
          { message: "Issue B", recommendation: "Fix B" },
        ],
        warnings: [],
      };
      const report2 = {
        status: "critical",
        criticalIssues: [
          { message: "Issue B", recommendation: "Fix B" },
          { message: "Issue A", recommendation: "Fix A" },
        ],
        warnings: [],
      };
      expect(computeHash(report1)).toBe(computeHash(report2));
    });

    it("should produce the same hash when only metric values differ", () => {
      const report1 = {
        status: "warning",
        warnings: [{ message: "Low coverage" }],
        metrics: { canonicalIdCoverage: 80.1 },
        timestamp: new Date("2025-01-01"),
      };
      const report2 = {
        status: "warning",
        warnings: [{ message: "Low coverage" }],
        metrics: { canonicalIdCoverage: 79.5 },
        timestamp: new Date("2025-01-02"),
      };
      expect(computeHash(report1)).toBe(computeHash(report2));
    });

    it("should produce different hash when issues differ", () => {
      const report1 = {
        status: "warning",
        warnings: [{ message: "Low coverage" }],
      };
      const report2 = {
        status: "warning",
        warnings: [{ message: "High dead letter count" }],
      };
      expect(computeHash(report1)).not.toBe(computeHash(report2));
    });

    it("should produce different hash on status escalation", () => {
      const warningReport = {
        status: "warning",
        warnings: [{ message: "Dead letters rising" }],
      };
      const criticalReport = {
        status: "critical",
        criticalIssues: [{ message: "Dead letters rising" }],
      };
      expect(computeHash(warningReport)).not.toBe(computeHash(criticalReport));
    });

    it("should handle missing criticalIssues and warnings gracefully", () => {
      const hash = computeHash({ status: "healthy" });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("isDuplicate() / record()", () => {
    it("should return false for a never-seen hash", () => {
      expect(isDuplicate("abc123")).toBe(false);
    });

    it("should return true for a recently recorded hash", () => {
      record("abc123");
      expect(isDuplicate("abc123")).toBe(true);
    });

    it("should return false after the suppression window expires", () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now);

      record("abc123");
      expect(isDuplicate("abc123")).toBe(true);

      // Advance time past the 6-hour window
      Date.now.mockReturnValue(now + 6 * 60 * 60 * 1000 + 1);
      expect(isDuplicate("abc123")).toBe(false);

      Date.now.mockRestore();
    });

    it("should not suppress different hashes", () => {
      record("hash1");
      expect(isDuplicate("hash2")).toBe(false);
    });
  });

  describe("getStats()", () => {
    it("should return count of tracked hashes", () => {
      expect(getStats().count).toBe(0);

      record("a");
      record("b");
      expect(getStats().count).toBe(2);
    });
  });

  describe("_reset()", () => {
    it("should clear all stored hashes", () => {
      record("a");
      record("b");
      expect(getStats().count).toBe(2);

      _reset();
      expect(getStats().count).toBe(0);
      expect(isDuplicate("a")).toBe(false);
    });
  });
});
