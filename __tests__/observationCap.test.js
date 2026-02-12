jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../src/models/merge", () => ({
  create: jest.fn().mockResolvedValue({}),
}));

jest.mock("../src/models/person", () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  findById: jest.fn().mockResolvedValue(null),
  findByIdAndUpdate: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(null),
}));

const {
  MAX_OBSERVATION_REFS,
  MERGE_OBS_RATIO_THRESHOLD,
} = require("../src/constants/limits");
const identityResolverService = require("../src/services/identityResolverService");

describe("Observation Cap", () => {
  describe("MAX_OBSERVATION_REFS constant", () => {
    it("should exist and default to 200", () => {
      expect(MAX_OBSERVATION_REFS).toBeDefined();
      expect(typeof MAX_OBSERVATION_REFS).toBe("number");
      expect(MAX_OBSERVATION_REFS).toBe(200);
    });

    it("should be importable from constants/limits", () => {
      const limits = require("../src/constants/limits");
      expect(limits.MAX_OBSERVATION_REFS).toBeDefined();
      expect(limits.MAX_OBSERVATION_REFS).toBeGreaterThan(0);
    });
  });

  describe("identityResolverService.determineWinner()", () => {
    it("should use meta.observationsCount instead of array lengths", () => {
      // Winner has fewer array entries but higher meta count (arrays were capped)
      const personA = {
        _id: "ACwAAA_PersonA",
        observations: { visits: ["v1", "v2"], scans: [] },
        meta: { observationsCount: 500 },
        updatedAt: new Date("2024-01-01"),
      };
      const personB = {
        _id: "ACwAAA_PersonB",
        observations: { visits: ["v1", "v2", "v3"], scans: ["s1"] },
        meta: { observationsCount: 4 },
        updatedAt: new Date("2024-06-01"),
      };

      const winner = identityResolverService.determineWinner([
        personA,
        personB,
      ]);

      // personA has more observations (500 vs 4) even though array is shorter
      expect(winner._id).toBe("ACwAAA_PersonA");
    });

    it("should fall back to 0 when meta.observationsCount is missing", () => {
      const personA = {
        _id: "ACwAAA_PersonA",
        observations: { visits: [], scans: [] },
        meta: {},
        updatedAt: new Date("2024-06-01"),
      };
      const personB = {
        _id: "ACwAAA_PersonB",
        observations: { visits: [], scans: [] },
        meta: { observationsCount: 5 },
        updatedAt: new Date("2024-01-01"),
      };

      const winner = identityResolverService.determineWinner([
        personA,
        personB,
      ]);

      expect(winner._id).toBe("ACwAAA_PersonB");
    });

    it("should still prefer Sales Nav ID format over observation count", () => {
      const personA = {
        _id: "ACwAAABCDEFGHIJKLM",
        observations: { visits: [], scans: [] },
        meta: { observationsCount: 1 },
        updatedAt: new Date("2024-01-01"),
      };
      const personB = {
        _id: "12345678",
        observations: { visits: [], scans: [] },
        meta: { observationsCount: 999 },
        updatedAt: new Date("2024-06-01"),
      };

      const winner = identityResolverService.determineWinner([
        personA,
        personB,
      ]);

      // Sales Nav ID format takes priority
      expect(winner._id).toBe("ACwAAABCDEFGHIJKLM");
    });
  });

  describe("identityResolverService.validateMergeSafety()", () => {
    it("should use meta.observationsCount for disparity checks", () => {
      const winner = {
        _id: "winner",
        snapshot: {},
        meta: { observationsCount: 1 },
      };
      const loser = {
        _id: "loser",
        snapshot: {},
        meta: { observationsCount: MERGE_OBS_RATIO_THRESHOLD },
      };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers[0]).toContain("ratio");
    });

    it("should block when winner has 0 meta count but loser has >0", () => {
      const winner = {
        _id: "winner",
        snapshot: {},
        meta: { observationsCount: 0 },
      };
      const loser = {
        _id: "loser",
        snapshot: {},
        meta: { observationsCount: 5 },
      };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockers[0]).toContain("0 observations");
    });

    it("should pass when meta counts are within threshold", () => {
      const winner = {
        _id: "winner",
        snapshot: {},
        meta: { observationsCount: 10 },
      };
      const loser = {
        _id: "loser",
        snapshot: {},
        meta: { observationsCount: 15 },
      };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it("should handle missing meta gracefully (defaults to 0)", () => {
      const winner = {
        _id: "winner",
        snapshot: {},
      };
      const loser = {
        _id: "loser",
        snapshot: {},
      };

      const result = identityResolverService.validateMergeSafety(winner, [
        loser,
      ]);

      expect(result.safe).toBe(true);
    });
  });

  describe("mergePeople() observation capping", () => {
    it("should cap merged observation arrays to MAX_OBSERVATION_REFS", async () => {
      const halfCap = Math.ceil(MAX_OBSERVATION_REFS / 2) + 50;
      const winnerVisits = Array.from({ length: halfCap }, (_, i) => `wv${i}`);
      const loserVisits = Array.from({ length: halfCap }, (_, i) => `lv${i}`);

      const winner = {
        _id: "winner",
        aliases: [{ type: "salesNavId", value: "ACwAAA_W" }],
        observations: { visits: winnerVisits, scans: [] },
        snapshot: { roles: [], education: [], skills: [] },
        meta: { observationsCount: halfCap },
        toObject: function () {
          return { ...this };
        },
        save: jest.fn().mockResolvedValue(true),
      };

      const loser = {
        _id: "loser",
        aliases: [{ type: "salesNavId", value: "ACwAAA_L" }],
        observations: { visits: loserVisits, scans: [] },
        snapshot: { roles: [], education: [], skills: [] },
        meta: { observationsCount: halfCap },
        toObject: function () {
          return { ...this };
        },
      };

      const merged = await identityResolverService.mergePeople(
        winner,
        [loser],
        { force: true },
      );

      // Arrays should be capped
      expect(merged.observations.visits.length).toBeLessThanOrEqual(
        MAX_OBSERVATION_REFS,
      );
      expect(merged.observations.scans.length).toBeLessThanOrEqual(
        MAX_OBSERVATION_REFS,
      );

      // True count should be the sum of both entities
      expect(merged.meta.observationsCount).toBe(halfCap + halfCap);
    });

    it("should not cap arrays when combined size is within limit", async () => {
      const winner = {
        _id: "winner",
        aliases: [{ type: "salesNavId", value: "ACwAAA_W" }],
        observations: { visits: ["v1", "v2"], scans: ["s1"] },
        snapshot: { roles: [], education: [], skills: [] },
        meta: { observationsCount: 3 },
        toObject: function () {
          return { ...this };
        },
        save: jest.fn().mockResolvedValue(true),
      };

      const loser = {
        _id: "loser",
        aliases: [{ type: "salesNavId", value: "ACwAAA_L" }],
        observations: { visits: ["v3"], scans: ["s2"] },
        snapshot: { roles: [], education: [], skills: [] },
        meta: { observationsCount: 2 },
        toObject: function () {
          return { ...this };
        },
      };

      const merged = await identityResolverService.mergePeople(
        winner,
        [loser],
        { force: true },
      );

      // All refs kept (well within cap)
      expect(merged.observations.visits.length).toBe(3); // v1, v2, v3
      expect(merged.observations.scans.length).toBe(2); // s1, s2
      expect(merged.meta.observationsCount).toBe(5);
    });
  });
});
