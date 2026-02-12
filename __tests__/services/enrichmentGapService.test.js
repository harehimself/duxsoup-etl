jest.mock("../../src/models/person", () => ({
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Person = require("../../src/models/person");
const {
  getEnrichmentGaps,
  getRevisitList,
  GAP_FIELDS,
  _calculateGapScore,
  _calculateContactValue,
  _calculatePriorityScore,
  _getMissingFields,
  _extractProfileUrl,
} = require("../../src/services/enrichmentGapService");

// ── Helper builders ─────────────────────────────────────────

function buildPerson(overrides = {}) {
  const {
    snapshot: snapshotOverrides,
    derived: derivedOverrides,
    meta: metaOverrides,
    ...rest
  } = overrides;
  return {
    _id: "ACwAAABCDEF",
    aliases: [
      { type: "salesNavId", value: "ACwAAABCDEF" },
      { type: "publicUrl", value: "https://www.linkedin.com/in/janedoe" },
    ],
    snapshot: {
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      currentTitle: "VP Engineering",
      currentCompany: "Acme Corp",
      currentCompanyId: "12345",
      email: "jane@acme.com",
      phone: "+15551234567",
      industry: "Technology",
      location: "San Francisco, CA",
      roles: [{ title: "VP Engineering", companyName: "Acme Corp" }],
      education: [{ school: "MIT", degree: "BS" }],
      skills: ["JavaScript", "Leadership"],
      connections: 500,
      parsedSeniority: "VP",
      ...snapshotOverrides,
    },
    derived: {
      highestSeniorityRank: 5,
      ...derivedOverrides,
    },
    meta: {
      lastObservedAt: new Date("2026-02-10"),
      ...metaOverrides,
    },
    ...rest,
  };
}

function buildEmptyPerson(overrides = {}) {
  const { snapshot: snapshotOverrides, ...rest } = overrides;
  return {
    _id: "ACwAAAEmpty",
    aliases: [],
    snapshot: {
      firstName: "Unknown",
      ...snapshotOverrides,
    },
    derived: {},
    meta: {},
    ...rest,
  };
}

function personFindChain(docs) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(docs),
    }),
  };
}

describe("enrichmentGapService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── _calculateGapScore ──────────────────────────────────────

  describe("_calculateGapScore()", () => {
    it("should return 0 when all fields are present", () => {
      const person = buildPerson();
      expect(_calculateGapScore(person)).toBe(0);
    });

    it("should return 100 when all fields are missing", () => {
      const person = buildEmptyPerson();
      expect(_calculateGapScore(person)).toBe(100);
    });

    it("should score email weight (30) when only email is missing", () => {
      const person = buildPerson({ snapshot: { email: null } });
      expect(_calculateGapScore(person)).toBe(30);
    });

    it("should score phone weight (20) when only phone is missing", () => {
      const person = buildPerson({ snapshot: { phone: "" } });
      expect(_calculateGapScore(person)).toBe(20);
    });

    it("should score currentCompanyId weight (15) when missing", () => {
      const person = buildPerson({ snapshot: { currentCompanyId: null } });
      expect(_calculateGapScore(person)).toBe(15);
    });

    it("should detect empty arrays as missing for roles", () => {
      const person = buildPerson({ snapshot: { roles: [] } });
      expect(_calculateGapScore(person)).toBe(15);
    });

    it("should detect empty arrays as missing for education", () => {
      const person = buildPerson({ snapshot: { education: [] } });
      expect(_calculateGapScore(person)).toBe(10);
    });

    it("should detect empty arrays as missing for skills", () => {
      const person = buildPerson({ snapshot: { skills: [] } });
      expect(_calculateGapScore(person)).toBe(5);
    });

    it("should handle undefined snapshot gracefully", () => {
      expect(_calculateGapScore({ snapshot: undefined })).toBe(100);
    });

    it("should sum multiple missing field weights correctly", () => {
      const person = buildPerson({
        snapshot: { email: null, phone: null, industry: null },
      });
      expect(_calculateGapScore(person)).toBe(30 + 20 + 3);
    });
  });

  // ── _calculateContactValue ──────────────────────────────────

  describe("_calculateContactValue()", () => {
    const now = new Date("2026-02-12T00:00:00Z");

    it("should score 50 for highest seniority (Owner, rank 8)", () => {
      const person = buildPerson({ derived: { highestSeniorityRank: 8 } });
      const score = _calculateContactValue(person, now);
      // 50 seniority + 30 recency (2 days) + 20 connections (500)
      expect(score).toBe(100);
    });

    it("should score 0 seniority for missing rank", () => {
      const person = {
        _id: "test",
        aliases: [],
        snapshot: { connections: 0 },
        derived: {},
        meta: {},
      };
      const score = _calculateContactValue(person, now);
      expect(score).toBe(0);
    });

    it("should score 30 recency for observation within 7 days", () => {
      const person = buildPerson({
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: new Date("2026-02-11") },
        snapshot: { connections: 0 },
      });
      const score = _calculateContactValue(person, now);
      expect(score).toBe(5 + 30); // rank 1 = 5 + recency 30
    });

    it("should score 25 recency for observation within 30 days", () => {
      const person = buildPerson({
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: new Date("2026-01-20") },
        snapshot: { connections: 0 },
      });
      const score = _calculateContactValue(person, now);
      expect(score).toBe(5 + 25);
    });

    it("should score 15 recency for observation within 90 days", () => {
      const person = buildPerson({
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: new Date("2025-12-01") },
        snapshot: { connections: 0 },
      });
      const score = _calculateContactValue(person, now);
      expect(score).toBe(5 + 15);
    });

    it("should score 20 connections for 500+ connections", () => {
      const person = buildPerson({
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: null },
        snapshot: { connections: 600 },
      });
      const score = _calculateContactValue(person, now);
      expect(score).toBe(5 + 20);
    });

    it("should score 10 connections for 100-199 connections", () => {
      const person = buildPerson({
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: null },
        snapshot: { connections: 150 },
      });
      const score = _calculateContactValue(person, now);
      expect(score).toBe(5 + 10);
    });

    it("should handle missing meta gracefully", () => {
      const person = {
        _id: "test",
        aliases: [],
        snapshot: { connections: 0 },
        derived: {},
      };
      const score = _calculateContactValue(person, now);
      expect(score).toBe(0);
    });
  });

  // ── _calculatePriorityScore ─────────────────────────────────

  describe("_calculatePriorityScore()", () => {
    it("should sum gap score and contact value", () => {
      expect(_calculatePriorityScore(75, 80)).toBe(155);
    });

    it("should return 0 for zero inputs", () => {
      expect(_calculatePriorityScore(0, 0)).toBe(0);
    });

    it("should return 200 for max inputs", () => {
      expect(_calculatePriorityScore(100, 100)).toBe(200);
    });

    it("should round to integer", () => {
      expect(_calculatePriorityScore(33.3, 66.6)).toBe(100);
    });
  });

  // ── _getMissingFields ───────────────────────────────────────

  describe("_getMissingFields()", () => {
    it("should return empty array when person is complete", () => {
      const person = buildPerson();
      expect(_getMissingFields(person)).toEqual([]);
    });

    it("should return all gap fields for empty person", () => {
      const person = buildEmptyPerson();
      const missing = _getMissingFields(person);
      expect(missing).toEqual(expect.arrayContaining(GAP_FIELDS));
      expect(missing.length).toBe(GAP_FIELDS.length);
    });

    it("should detect specific missing fields", () => {
      const person = buildPerson({ snapshot: { email: null, phone: "" } });
      const missing = _getMissingFields(person);
      expect(missing).toContain("email");
      expect(missing).toContain("phone");
      expect(missing).not.toContain("industry");
    });

    it("should detect empty array fields", () => {
      const person = buildPerson({
        snapshot: { roles: [], education: [], skills: [] },
      });
      const missing = _getMissingFields(person);
      expect(missing).toContain("roles");
      expect(missing).toContain("education");
      expect(missing).toContain("skills");
    });
  });

  // ── _extractProfileUrl ──────────────────────────────────────

  describe("_extractProfileUrl()", () => {
    it("should prefer publicUrl alias", () => {
      const person = buildPerson({
        aliases: [
          { type: "publicUrl", value: "https://www.linkedin.com/in/janedoe" },
          { type: "salesUrl", value: "https://www.linkedin.com/sales/lead/X" },
          { type: "salesNavId", value: "ACwAAABCDEF" },
        ],
      });
      expect(_extractProfileUrl(person)).toBe(
        "https://www.linkedin.com/in/janedoe",
      );
    });

    it("should fallback to salesUrl when publicUrl missing", () => {
      const person = buildPerson({
        aliases: [
          { type: "salesUrl", value: "https://www.linkedin.com/sales/lead/X" },
          { type: "salesNavId", value: "ACwAAABCDEF" },
        ],
      });
      expect(_extractProfileUrl(person)).toBe(
        "https://www.linkedin.com/sales/lead/X",
      );
    });

    it("should construct URL from salesNavId when no URL aliases", () => {
      const person = buildPerson({
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
      });
      expect(_extractProfileUrl(person)).toBe(
        "https://www.linkedin.com/sales/lead/ACwAAABCDEF",
      );
    });

    it("should construct URL from linkedInUsername as last resort", () => {
      const person = buildPerson({
        aliases: [{ type: "linkedInUsername", value: "janedoe" }],
      });
      expect(_extractProfileUrl(person)).toBe(
        "https://www.linkedin.com/in/janedoe",
      );
    });

    it("should return empty string when no aliases", () => {
      const person = buildPerson({ aliases: [] });
      expect(_extractProfileUrl(person)).toBe("");
    });

    it("should return empty string when aliases array is undefined", () => {
      const person = { _id: "test" };
      expect(_extractProfileUrl(person)).toBe("");
    });
  });

  // ── getEnrichmentGaps ───────────────────────────────────────

  describe("getEnrichmentGaps()", () => {
    it("should return field gap counts and percentages", async () => {
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: null,
          emailCount: 50,
          phoneCount: 80,
          currentCompanyIdCount: 20,
          rolesCount: 30,
          educationCount: 60,
          skillsCount: 40,
          industryCount: 10,
          locationCount: 5,
          total: 100,
        },
      ]);
      Person.countDocuments.mockResolvedValue(100);
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: "VP",
          count: 40,
          missingEmail: 15,
          missingPhone: 25,
          missingRoles: 10,
        },
        {
          _id: "Manager",
          count: 60,
          missingEmail: 35,
          missingPhone: 55,
          missingRoles: 20,
        },
      ]);

      const result = await getEnrichmentGaps();

      expect(result.summary.totalPeople).toBe(100);
      expect(result.summary.fieldsAnalyzed).toBe(8);
      expect(result.fieldGaps).toHaveLength(8);
      expect(result.fieldGaps[0].missingPercent).toBeGreaterThanOrEqual(
        result.fieldGaps[1].missingPercent,
      );
      expect(result.seniorityBreakdown).toHaveLength(2);
    });

    it("should handle zero records gracefully", async () => {
      Person.aggregate.mockResolvedValueOnce([]);
      Person.countDocuments.mockResolvedValue(0);
      Person.aggregate.mockResolvedValueOnce([]);

      const result = await getEnrichmentGaps();

      expect(result.summary.totalPeople).toBe(0);
      expect(result.summary.avgGapPercent).toBe(0);
      expect(result.fieldGaps.every((f) => f.missingPercent === 0)).toBe(true);
    });

    it("should filter by seniority when provided", async () => {
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: null,
          total: 10,
          emailCount: 5,
          phoneCount: 3,
          currentCompanyIdCount: 2,
          rolesCount: 1,
          educationCount: 4,
          skillsCount: 2,
          industryCount: 1,
          locationCount: 0,
        },
      ]);
      Person.countDocuments.mockResolvedValue(10);
      Person.aggregate.mockResolvedValueOnce([]);

      await getEnrichmentGaps({ seniority: "VP" });

      const matchStage = Person.aggregate.mock.calls[0][0][0].$match;
      expect(matchStage["snapshot.parsedSeniority"]).toBe("VP");
    });

    it("should filter by minRank when provided", async () => {
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: null,
          total: 5,
          emailCount: 2,
          phoneCount: 1,
          currentCompanyIdCount: 1,
          rolesCount: 0,
          educationCount: 1,
          skillsCount: 0,
          industryCount: 0,
          locationCount: 0,
        },
      ]);
      Person.countDocuments.mockResolvedValue(5);
      Person.aggregate.mockResolvedValueOnce([]);

      await getEnrichmentGaps({ minRank: 5 });

      const matchStage = Person.aggregate.mock.calls[0][0][0].$match;
      expect(matchStage["derived.highestSeniorityRank"]).toEqual({ $gte: 5 });
    });

    it("should filter by company name when provided", async () => {
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: null,
          total: 3,
          emailCount: 1,
          phoneCount: 1,
          currentCompanyIdCount: 0,
          rolesCount: 0,
          educationCount: 1,
          skillsCount: 0,
          industryCount: 0,
          locationCount: 0,
        },
      ]);
      Person.countDocuments.mockResolvedValue(3);
      Person.aggregate.mockResolvedValueOnce([]);

      await getEnrichmentGaps({ company: "Acme" });

      const matchStage = Person.aggregate.mock.calls[0][0][0].$match;
      expect(matchStage["snapshot.currentCompany"]).toBeInstanceOf(RegExp);
    });

    it("should filter by companyId when provided", async () => {
      Person.aggregate.mockResolvedValueOnce([
        {
          _id: null,
          total: 2,
          emailCount: 1,
          phoneCount: 0,
          currentCompanyIdCount: 0,
          rolesCount: 0,
          educationCount: 0,
          skillsCount: 0,
          industryCount: 0,
          locationCount: 0,
        },
      ]);
      Person.countDocuments.mockResolvedValue(2);
      Person.aggregate.mockResolvedValueOnce([]);

      await getEnrichmentGaps({ companyId: "comp123" });

      const matchStage = Person.aggregate.mock.calls[0][0][0].$match;
      expect(matchStage["snapshot.currentCompanyId"]).toBe("comp123");
    });

    it("should report only specified fields when fields filter provided", async () => {
      Person.aggregate.mockResolvedValueOnce([
        { _id: null, total: 50, emailCount: 20, phoneCount: 30 },
      ]);
      Person.countDocuments.mockResolvedValue(50);
      Person.aggregate.mockResolvedValueOnce([]);

      const result = await getEnrichmentGaps({ fields: ["email", "phone"] });

      expect(result.fieldGaps).toHaveLength(2);
      expect(result.fieldGaps.map((f) => f.field)).toEqual(
        expect.arrayContaining(["email", "phone"]),
      );
    });

    it("should always exclude merged records", async () => {
      Person.aggregate.mockResolvedValueOnce([{ _id: null, total: 0 }]);
      Person.countDocuments.mockResolvedValue(0);
      Person.aggregate.mockResolvedValueOnce([]);

      await getEnrichmentGaps();

      const matchStage = Person.aggregate.mock.calls[0][0][0].$match;
      expect(matchStage.mergedInto).toEqual({ $exists: false });
    });
  });

  // ── getRevisitList ──────────────────────────────────────────

  describe("getRevisitList()", () => {
    it("should return results sorted by priority descending", async () => {
      const p1 = buildPerson({
        _id: "p1",
        snapshot: { email: null, phone: null, fullName: "Low Priority" },
        derived: { highestSeniorityRank: 1 },
      });
      const p2 = buildPerson({
        _id: "p2",
        snapshot: { email: null, fullName: "High Priority" },
        derived: { highestSeniorityRank: 7 },
      });
      Person.find.mockReturnValue(personFindChain([p1, p2]));

      const results = await getRevisitList();

      expect(results.length).toBe(2);
      expect(results[0].priorityScore).toBeGreaterThanOrEqual(
        results[1].priorityScore,
      );
    });

    it("should apply limit", async () => {
      const people = Array.from({ length: 5 }, (_, i) =>
        buildPerson({
          _id: `p${i}`,
          snapshot: { email: null, fullName: `Person ${i}` },
        }),
      );
      Person.find.mockReturnValue(personFindChain(people));

      const results = await getRevisitList({ limit: 2 });

      expect(results.length).toBe(2);
    });

    it("should filter by minScore", async () => {
      const lowGap = buildPerson({
        _id: "low",
        snapshot: { industry: null, fullName: "Low Gap" }, // only 3 points
        derived: { highestSeniorityRank: 1 },
        meta: { lastObservedAt: null },
      });
      const highGap = buildPerson({
        _id: "high",
        snapshot: { email: null, phone: null, fullName: "High Gap" },
        derived: { highestSeniorityRank: 7 },
      });
      Person.find.mockReturnValue(personFindChain([lowGap, highGap]));

      const results = await getRevisitList({ minScore: 50 });

      // Low gap person should be filtered out
      expect(results.every((r) => r.priorityScore >= 50)).toBe(true);
    });

    it("should skip people with zero gap score", async () => {
      const complete = buildPerson({ _id: "complete" });
      const incomplete = buildPerson({
        _id: "incomplete",
        snapshot: { email: null, fullName: "Missing Email" },
      });
      Person.find.mockReturnValue(personFindChain([complete, incomplete]));

      const results = await getRevisitList();

      expect(results.length).toBe(1);
      expect(results[0].personId).toBe("incomplete");
    });

    it("should include correct missing fields in results", async () => {
      const person = buildPerson({
        _id: "p1",
        snapshot: { email: null, phone: "", roles: [], fullName: "Test" },
      });
      Person.find.mockReturnValue(personFindChain([person]));

      const results = await getRevisitList();

      expect(results[0].missingFields).toEqual(
        expect.arrayContaining(["email", "phone", "roles"]),
      );
    });

    it("should extract profile URL for results", async () => {
      const person = buildPerson({
        _id: "p1",
        snapshot: { email: null, fullName: "Test" },
        aliases: [
          {
            type: "publicUrl",
            value: "https://www.linkedin.com/in/testuser",
          },
        ],
      });
      Person.find.mockReturnValue(personFindChain([person]));

      const results = await getRevisitList();

      expect(results[0].profileUrl).toBe(
        "https://www.linkedin.com/in/testuser",
      );
    });

    it("should build name from firstName/lastName when fullName missing", async () => {
      const person = buildPerson({
        _id: "p1",
        snapshot: {
          email: null,
          fullName: undefined,
          firstName: "Jane",
          lastName: "Doe",
        },
      });
      Person.find.mockReturnValue(personFindChain([person]));

      const results = await getRevisitList();

      expect(results[0].name).toBe("Jane Doe");
    });
  });
});
