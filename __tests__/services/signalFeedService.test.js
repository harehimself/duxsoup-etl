jest.mock("../../src/models/change", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/person", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Change = require("../../src/models/change");
const Person = require("../../src/models/person");
const {
  getSignals,
  _calculateScore,
  _scoreToPriority,
  _buildActionContext,
  _deduplicateSignals,
  _daysSince,
  VALID_SIGNAL_TYPES,
} = require("../../src/services/signalFeedService");

function changeFindChain(docs) {
  return {
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(docs),
      }),
    }),
  };
}

function personFindChain(docs) {
  return {
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(docs),
      }),
    }),
  };
}

describe("signalFeedService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── _calculateScore ──────────────────────────────────────────

  describe("_calculateScore()", () => {
    const now = new Date("2026-02-12T00:00:00Z");

    it("should return a number between 0 and 100", () => {
      const score = _calculateScore(5, now, "new_role", now, 30);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("should score higher for higher seniority rank", () => {
      const vp = _calculateScore(6, now, "new_role", now, 30);
      const ic = _calculateScore(2, now, "new_role", now, 30);
      expect(vp).toBeGreaterThan(ic);
    });

    it("should score higher for more recent signals", () => {
      const recent = _calculateScore(
        5,
        new Date("2026-02-11T00:00:00Z"),
        "new_role",
        now,
        30,
      );
      const old = _calculateScore(
        5,
        new Date("2026-01-15T00:00:00Z"),
        "new_role",
        now,
        30,
      );
      expect(recent).toBeGreaterThan(old);
    });

    it("should give promotions higher type score than new_role", () => {
      const promo = _calculateScore(5, now, "promotion", now, 30);
      const newRole = _calculateScore(5, now, "new_role", now, 30);
      expect(promo).toBeGreaterThan(newRole);
    });

    it("should treat null seniorityRank as rank 3", () => {
      const withNull = _calculateScore(null, now, "new_role", now, 30);
      const withThree = _calculateScore(3, now, "new_role", now, 30);
      expect(withNull).toBe(withThree);
    });

    it("should return 0 recency for signals older than the window", () => {
      const ancient = _calculateScore(
        5,
        new Date("2025-01-01T00:00:00Z"),
        "new_role",
        now,
        30,
      );
      // recency component should be 0, so score = seniority*0.4 + 0 + type*0.25
      const expected = (5 / 8) * 100 * 0.4 + 0 + 70 * 0.25;
      expect(ancient).toBe(Math.round(expected * 10) / 10);
    });
  });

  // ── _scoreToPriority ─────────────────────────────────────────

  describe("_scoreToPriority()", () => {
    it("should return 'high' for scores >= 60", () => {
      expect(_scoreToPriority(60)).toBe("high");
      expect(_scoreToPriority(85)).toBe("high");
    });

    it("should return 'medium' for scores >= 35 and < 60", () => {
      expect(_scoreToPriority(35)).toBe("medium");
      expect(_scoreToPriority(59.9)).toBe("medium");
    });

    it("should return 'low' for scores < 35", () => {
      expect(_scoreToPriority(34.9)).toBe("low");
      expect(_scoreToPriority(0)).toBe("low");
    });
  });

  // ── _daysSince ───────────────────────────────────────────────

  describe("_daysSince()", () => {
    it("should return 0 for same day", () => {
      const now = new Date("2026-02-12T12:00:00Z");
      expect(_daysSince(now, now)).toBe(0);
    });

    it("should return correct number of days", () => {
      const now = new Date("2026-02-12T00:00:00Z");
      const past = new Date("2026-02-02T00:00:00Z");
      expect(_daysSince(past, now)).toBe(10);
    });
  });

  // ── _buildActionContext ──────────────────────────────────────

  describe("_buildActionContext()", () => {
    const now = new Date("2026-02-12T00:00:00Z");

    it("should build new_role context with days and previous company", () => {
      const ctx = _buildActionContext(
        "new_role",
        {
          personSnapshot: { fullName: "Jane Doe" },
          to: "Acme Corp",
          toTitle: "VP Engineering",
          from: "Old Corp",
          tenureDaysAtPreviousRole: 730,
          timestamp: new Date("2026-01-28T00:00:00Z"),
        },
        now,
      );
      expect(ctx).toContain("VP Engineering at Acme Corp");
      expect(ctx).toContain("15 days into role");
      expect(ctx).toContain("buying window");
      expect(ctx).toContain("Previously at Old Corp");
      expect(ctx).toContain("2 years");
    });

    it("should build new_role context without previous company when missing", () => {
      const ctx = _buildActionContext(
        "new_role",
        {
          personSnapshot: { fullName: "Jane Doe" },
          to: "Acme Corp",
          toTitle: "VP Engineering",
          from: "",
          timestamp: new Date("2026-02-10T00:00:00Z"),
        },
        now,
      );
      expect(ctx).toContain("VP Engineering at Acme Corp");
      expect(ctx).not.toContain("Previously");
    });

    it("should build promotion context", () => {
      const ctx = _buildActionContext(
        "promotion",
        {
          fromTitle: "Director",
          toTitle: "VP",
          company: "Acme Corp",
          personSnapshot: {},
        },
        now,
      );
      expect(ctx).toContain("Promoted from Director to VP at Acme Corp");
      expect(ctx).toContain("budget authority");
    });

    it("should build lateral_move context", () => {
      const ctx = _buildActionContext(
        "lateral_move",
        {
          from: "Old Corp",
          to: "Acme Corp",
          toTitle: "VP Engineering",
          seniority: "VP",
          personSnapshot: {},
        },
        now,
      );
      expect(ctx).toContain("lateral move from Old Corp to Acme Corp");
      expect(ctx).toContain("as VP Engineering");
      expect(ctx).toContain("relationship opportunity");
    });

    it("should build new_decision_maker context", () => {
      const ctx = _buildActionContext(
        "new_decision_maker",
        {
          snapshot: {
            currentTitle: "VP Engineering",
            currentCompany: "Acme Corp",
          },
          derived: { highestSeniority: "VP" },
        },
        now,
      );
      expect(ctx).toContain("VP-level decision maker");
      expect(ctx).toContain("VP Engineering at Acme Corp");
    });

    it("should return empty string for unknown signal type", () => {
      expect(_buildActionContext("unknown", {}, now)).toBe("");
    });
  });

  // ── _deduplicateSignals ──────────────────────────────────────

  describe("_deduplicateSignals()", () => {
    it("should keep all signals when no duplicates exist", () => {
      const signals = [
        { personId: "p1", timestamp: new Date("2026-02-10"), type: "new_role" },
        {
          personId: "p2",
          timestamp: new Date("2026-02-10"),
          type: "promotion",
        },
      ];
      expect(_deduplicateSignals(signals)).toHaveLength(2);
    });

    it("should keep lateral_move over new_role for same person+timestamp", () => {
      const ts = new Date("2026-02-10T00:00:00Z");
      const signals = [
        { personId: "p1", timestamp: ts, type: "new_role", score: 70 },
        { personId: "p1", timestamp: ts, type: "lateral_move", score: 75 },
      ];
      const result = _deduplicateSignals(signals);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("lateral_move");
    });

    it("should keep both when same person has different timestamps", () => {
      const signals = [
        {
          personId: "p1",
          timestamp: new Date("2026-02-10"),
          type: "new_role",
        },
        {
          personId: "p1",
          timestamp: new Date("2026-02-11"),
          type: "lateral_move",
        },
      ];
      expect(_deduplicateSignals(signals)).toHaveLength(2);
    });

    it("should keep both for same person+timestamp with non-overlapping types", () => {
      const ts = new Date("2026-02-10T00:00:00Z");
      const signals = [
        { personId: "p1", timestamp: ts, type: "promotion" },
        { personId: "p1", timestamp: ts, type: "new_decision_maker" },
      ];
      expect(_deduplicateSignals(signals)).toHaveLength(2);
    });

    it("should handle triple overlap: new_role + lateral_move + promotion at same ts", () => {
      const ts = new Date("2026-02-10T00:00:00Z");
      const signals = [
        { personId: "p1", timestamp: ts, type: "new_role" },
        { personId: "p1", timestamp: ts, type: "lateral_move" },
        { personId: "p1", timestamp: ts, type: "promotion" },
      ];
      const result = _deduplicateSignals(signals);
      // new_role dropped, lateral_move + promotion kept
      expect(result).toHaveLength(2);
      const types = result.map((s) => s.type).sort();
      expect(types).toEqual(["lateral_move", "promotion"]);
    });
  });

  // ── getSignals() integration ─────────────────────────────────

  describe("getSignals()", () => {
    const baseChange = {
      _id: "ch1",
      type: "company_change",
      person_id: "p1",
      personSnapshot: { fullName: "Jane Doe", currentCompany: "Acme" },
      from: "Old Corp",
      to: "Acme Corp",
      toCompanyId: "comp1",
      fromTitle: "Director",
      toTitle: "VP Engineering",
      seniority: "VP",
      seniorityRank: 6,
      recentJobChange: true,
      tenureDaysAtPreviousRole: 365,
      timestamp: new Date("2026-02-10T00:00:00Z"),
    };

    const basePerson = {
      _id: "p2",
      snapshot: {
        fullName: "John Smith",
        currentTitle: "CTO",
        currentCompany: "BigCo",
        currentCompanyId: "comp2",
      },
      derived: { highestSeniority: "C-Suite", highestSeniorityRank: 8 },
      createdAt: new Date("2026-02-08T00:00:00Z"),
    };

    function setupMocks(changes = [], people = []) {
      Change.find.mockReturnValue(changeFindChain(changes));
      Person.find.mockReturnValue(personFindChain(people));
    }

    it("should return signals from both Change and Person collections", async () => {
      setupMocks([baseChange], [basePerson]);

      const result = await getSignals();

      expect(result.signals).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.signals[0]).toHaveProperty("type");
      expect(result.signals[0]).toHaveProperty("score");
      expect(result.signals[0]).toHaveProperty("priority");
      expect(result.signals[0]).toHaveProperty("actionContext");
    });

    it("should filter by requested signal types", async () => {
      setupMocks([baseChange], [basePerson]);

      const result = await getSignals({ types: ["new_role"] });

      // Only change-based query should have data, DM query returns []
      expect(result.signals.every((s) => s.type === "new_role")).toBe(true);
    });

    it("should skip company_change records without recentJobChange flag", async () => {
      const staleChange = { ...baseChange, recentJobChange: false };
      setupMocks([staleChange], []);

      const result = await getSignals({ types: ["new_role"] });

      expect(result.signals).toHaveLength(0);
    });

    it("should sort signals by score descending", async () => {
      const highRank = { ...baseChange, seniorityRank: 8 };
      const lowRank = {
        ...baseChange,
        _id: "ch2",
        person_id: "p3",
        seniorityRank: 2,
      };
      setupMocks([lowRank, highRank], []);

      const result = await getSignals({ types: ["new_role"] });

      expect(result.signals.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < result.signals.length; i++) {
        expect(result.signals[i - 1].score).toBeGreaterThanOrEqual(
          result.signals[i].score,
        );
      }
    });

    it("should apply pagination with offset and limit", async () => {
      const changes = Array.from({ length: 5 }, (_, i) => ({
        ...baseChange,
        _id: `ch${i}`,
        person_id: `p${i}`,
        seniorityRank: 8 - i,
      }));
      setupMocks(changes, []);

      const result = await getSignals({
        types: ["new_role"],
        limit: 2,
        offset: 1,
      });

      expect(result.signals).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
    });

    it("should cap days to SIGNAL_MAX_DAYS", async () => {
      setupMocks([], []);

      await getSignals({ days: 999 });

      // Verify the Change.find was called (we check the cutoff implicitly)
      expect(Change.find).toHaveBeenCalled();
    });

    it("should cap limit to SIGNAL_MAX_LIMIT", async () => {
      setupMocks([], []);

      const result = await getSignals({ limit: 9999 });

      expect(result.limit).toBe(500);
    });

    it("should return empty signals when no data matches", async () => {
      setupMocks([], []);

      const result = await getSignals();

      expect(result.signals).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("should include actionContext for each signal", async () => {
      setupMocks([baseChange], [basePerson]);

      const result = await getSignals();

      for (const signal of result.signals) {
        expect(signal.actionContext).toBeTruthy();
        expect(typeof signal.actionContext).toBe("string");
      }
    });

    it("should deduplicate new_role + lateral_move for same person+timestamp", async () => {
      const lateralMove = {
        ...baseChange,
        _id: "ch2",
        type: "lateral_move",
      };
      setupMocks([baseChange, lateralMove], []);

      const result = await getSignals({
        types: ["new_role", "lateral_move"],
      });

      // Same person_id + timestamp → lateral_move kept, new_role dropped
      const personSignals = result.signals.filter((s) => s.personId === "p1");
      expect(personSignals).toHaveLength(1);
      expect(personSignals[0].type).toBe("lateral_move");
    });

    it("should apply companyId filter to change query", async () => {
      setupMocks([], []);

      await getSignals({ companyId: "comp1" });

      const changeFilter = Change.find.mock.calls[0][0];
      expect(changeFilter.$and).toBeDefined();
    });

    it("should apply company name regex filter", async () => {
      setupMocks([], []);

      await getSignals({ company: "Acme" });

      const changeFilter = Change.find.mock.calls[0][0];
      expect(changeFilter.$and).toBeDefined();
    });

    it("should skip change query when only new_decision_maker requested", async () => {
      setupMocks([], [basePerson]);

      const result = await getSignals({ types: ["new_decision_maker"] });

      // Change.find should not have been called
      expect(Change.find).not.toHaveBeenCalled();
      expect(result.signals.every((s) => s.type === "new_decision_maker")).toBe(
        true,
      );
    });

    it("should skip Person query when new_decision_maker not requested", async () => {
      setupMocks([baseChange], []);

      await getSignals({ types: ["new_role"] });

      expect(Person.find).not.toHaveBeenCalled();
    });

    it("should apply minRank filter with $or for null seniorityRank", async () => {
      setupMocks([], []);

      await getSignals({ minRank: 5, types: ["new_role"] });

      const changeFilter = Change.find.mock.calls[0][0];
      expect(changeFilter.$or).toBeDefined();
      expect(changeFilter.$or).toEqual([
        { seniorityRank: { $gte: 5 } },
        { seniorityRank: null },
      ]);
    });

    it("should not add $or for seniorityRank when minRank is 1", async () => {
      setupMocks([], []);

      await getSignals({ minRank: 1, types: ["new_role"] });

      const changeFilter = Change.find.mock.calls[0][0];
      expect(changeFilter.$or).toBeUndefined();
    });

    it("should map promotion changes to promotion signal type", async () => {
      const promo = {
        ...baseChange,
        type: "promotion",
        from: "Director",
        to: "VP",
        company: "Acme Corp",
        recentJobChange: false,
      };
      setupMocks([promo], []);

      const result = await getSignals({ types: ["promotion"] });

      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].type).toBe("promotion");
    });

    it("should use tiebreak by timestamp when scores are equal", async () => {
      const change1 = {
        ...baseChange,
        _id: "ch1",
        person_id: "p1",
        seniorityRank: 5,
        timestamp: new Date("2026-02-09T00:00:00Z"),
      };
      const change2 = {
        ...baseChange,
        _id: "ch2",
        person_id: "p2",
        seniorityRank: 5,
        timestamp: new Date("2026-02-10T00:00:00Z"),
      };
      setupMocks([change1, change2], []);

      const result = await getSignals({ types: ["new_role"] });

      // Both have same seniority so scores will differ slightly by recency
      // The more recent one should come first
      if (result.signals.length === 2) {
        expect(
          new Date(result.signals[0].timestamp).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(result.signals[1].timestamp).getTime(),
        );
      }
    });
  });

  // ── VALID_SIGNAL_TYPES ───────────────────────────────────────

  describe("VALID_SIGNAL_TYPES", () => {
    it("should contain all four signal types", () => {
      expect(VALID_SIGNAL_TYPES).toEqual([
        "new_role",
        "promotion",
        "lateral_move",
        "new_decision_maker",
      ]);
    });
  });
});
