const identityResolverService = require("../../src/services/identityResolverService");

/**
 * Unit tests for validateMergeSafety().
 *
 * These tests use plain objects (no DB) because validateMergeSafety is synchronous.
 */

function makePerson(overrides = {}) {
  return {
    _id: overrides._id || "test-person",
    snapshot: {
      firstName: null,
      lastName: null,
      currentCompany: null,
      ...overrides.snapshot,
    },
    observations: {
      visits: [],
      scans: [],
      ...overrides.observations,
    },
  };
}

describe("validateMergeSafety()", () => {
  describe("safe merges", () => {
    it("should pass when winner and loser have similar observation counts", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1", "v2", "v3"], scans: ["s1"] },
      });
      const loser = makePerson({
        _id: "loser",
        observations: { visits: ["v4", "v5"], scans: ["s2", "s3"] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should pass when both records have matching names", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("should pass when both records have zero observations", () => {
      const winner = makePerson({ _id: "winner" });
      const loser = makePerson({ _id: "loser" });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("should pass when loser has zero observations and winner has some", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1", "v2"], scans: [] },
      });
      const loser = makePerson({ _id: "loser" });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("should pass when names are empty on one side", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("observation disparity blockers", () => {
    it("should block when winner has 0 observations but loser has >0", () => {
      const winner = makePerson({ _id: "winner" });
      const loser = makePerson({
        _id: "loser",
        observations: { visits: ["v1", "v2", "v3"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toContain("0 observations");
      expect(result.blockers[0]).toContain("loser");
    });

    it("should block when loser has 10x or more observations than winner", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1"], scans: [] },
      });
      const loserVisits = Array.from({ length: 10 }, (_, i) => `v${i + 2}`);
      const loser = makePerson({
        _id: "loser",
        observations: { visits: loserVisits, scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toContain("ratio");
    });

    it("should not block when loser has less than 10x observations", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1"], scans: [] },
      });
      const loserVisits = Array.from({ length: 9 }, (_, i) => `v${i + 2}`);
      const loser = makePerson({
        _id: "loser",
        observations: { visits: loserVisits, scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("should block for each loser that violates the threshold in multi-loser merge", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1"], scans: [] },
      });
      const loser1Visits = Array.from({ length: 15 }, (_, i) => `a${i}`);
      const loser1 = makePerson({
        _id: "loser1",
        observations: { visits: loser1Visits, scans: [] },
      });
      const loser2Visits = Array.from({ length: 20 }, (_, i) => `b${i}`);
      const loser2 = makePerson({
        _id: "loser2",
        observations: { visits: loser2Visits, scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser1,
        loser2,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers).toHaveLength(2);
    });

    it("should count visits AND scans for observation totals", () => {
      const winner = makePerson({
        _id: "winner",
        observations: { visits: ["v1"], scans: ["s1"] },
      });
      // Loser has 20 total (10 visits + 10 scans) = 10x winner's 2
      const loserVisits = Array.from({ length: 10 }, (_, i) => `v${i}`);
      const loserScans = Array.from({ length: 10 }, (_, i) => `s${i}`);
      const loser = makePerson({
        _id: "loser",
        observations: { visits: loserVisits, scans: loserScans },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers).toHaveLength(1);
    });
  });

  describe("name contradiction blockers", () => {
    it("should block when both first AND last name differ", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "Jane", lastName: "Smith" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toContain("Name contradiction");
    });

    it("should compare names case-insensitively", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "JOHN", lastName: "DOE" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "john", lastName: "doe" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should not block when only first name differs (partial mismatch)", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "Jonathan", lastName: "Doe" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("First name"))).toBe(true);
    });
  });

  describe("partial name mismatch warnings", () => {
    it("should warn when only first name differs", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "Robert", lastName: "Johnson" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "Bob", lastName: "Johnson" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("First name mismatch");
    });

    it("should warn when only last name differs", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { firstName: "John", lastName: "Doe" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { firstName: "John", lastName: "Smith" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Last name mismatch");
    });
  });

  describe("company mismatch warnings", () => {
    it("should warn when companies are different", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { currentCompany: "Google" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { currentCompany: "Meta" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Company mismatch");
    });

    it("should not warn when company is a substring match", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { currentCompany: "Google" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { currentCompany: "Google LLC" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should not warn when one company is empty", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { currentCompany: "Google" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { currentCompany: "" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should compare companies case-insensitively", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: { currentCompany: "GOOGLE" },
        observations: { visits: ["v1"], scans: [] },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: { currentCompany: "google" },
        observations: { visits: ["v2"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("combined scenarios", () => {
    it("should report multiple blockers and warnings together", () => {
      const winner = makePerson({
        _id: "winner",
        snapshot: {
          firstName: "John",
          lastName: "Doe",
          currentCompany: "Acme",
        },
      });
      const loser = makePerson({
        _id: "loser",
        snapshot: {
          firstName: "Jane",
          lastName: "Smith",
          currentCompany: "Globex",
        },
        observations: { visits: ["v1", "v2", "v3"], scans: [] },
      });

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      // Blocker: 0 obs vs 3 obs + name contradiction
      expect(result.blockers.length).toBeGreaterThanOrEqual(2);
      // Warning: company mismatch
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle null snapshot gracefully", () => {
      const winner = {
        _id: "winner",
        snapshot: null,
        observations: { visits: ["v1"], scans: [] },
      };
      const loser = {
        _id: "loser",
        snapshot: null,
        observations: { visits: ["v2"], scans: [] },
      };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should handle missing observations gracefully", () => {
      const winner = { _id: "winner", snapshot: {}, observations: {} };
      const loser = { _id: "loser", snapshot: {}, observations: {} };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
    });
  });
});
