jest.mock("../../src/services/personReadService", () => ({
  findPersonById: jest.fn(),
}));

jest.mock("../../src/models/visit", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/scan", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/change", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { findPersonById } = require("../../src/services/personReadService");
const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");
const Change = require("../../src/models/change");
const { getPersonTimeline } = require("../../src/services/timelineService");

function leanChain(docs) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(docs),
    }),
  };
}

describe("timelineService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPersonTimeline()", () => {
    it("should return null when person is not found", async () => {
      findPersonById.mockResolvedValue(null);

      const result = await getPersonTimeline("no-such-id");

      expect(result).toBeNull();
    });

    it("should return empty timeline for person with no observations or changes", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: [], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      expect(result.timeline).toHaveLength(1); // only first_seen
      expect(result.timeline[0].type).toBe("first_seen");
      expect(result.metadata.totalEvents).toBe(1);
    });

    it("should merge visits and scans in chronological order (descending)", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: ["s1"] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          {
            _id: "v1",
            VisitTime: new Date("2025-03-01"),
            Title: "VP Sales",
            Company: "Acme",
            Location: "NYC",
          },
        ]),
      );
      Scan.find.mockReturnValue(
        leanChain([
          {
            _id: "s1",
            ScanTime: new Date("2025-02-01"),
            Title: "Dir Sales",
            Company: "Globex",
            Location: "LA",
          },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      // Order: visit (Mar) > scan (Feb) > first_seen (Jan 2024)
      expect(result.timeline[0].type).toBe("visit");
      expect(result.timeline[1].type).toBe("scan");
      expect(result.timeline[2].type).toBe("first_seen");
    });

    it("should include change records at correct positions", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          {
            _id: "v1",
            VisitTime: new Date("2025-01-15"),
            Title: "VP Sales",
            Company: "Acme",
            Location: "NYC",
          },
        ]),
      );
      Change.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "c1",
            type: "company_change",
            timestamp: new Date("2025-02-01"),
            from: "Acme",
            to: "Globex",
            tenureDaysAtPreviousRole: 730,
          },
        ]),
      });

      const result = await getPersonTimeline("ACwAAABCDEF");

      expect(result.timeline[0].type).toBe("company_change");
      expect(result.timeline[0].detail.from).toBe("Acme");
      expect(result.timeline[0].detail.to).toBe("Globex");
      expect(result.timeline[0].detail.tenureDays).toBe(730);
      expect(result.timeline[1].type).toBe("visit");
    });

    it("should add first_seen event from person.createdAt", async () => {
      const createdAt = new Date("2023-06-15");
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: [], scans: [] },
          createdAt,
          snapshot: {
            currentTitle: "Engineer",
            currentCompany: "Acme",
            location: "SF",
          },
        },
      });
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      const firstSeen = result.timeline.find((e) => e.type === "first_seen");
      expect(firstSeen).toBeDefined();
      expect(firstSeen.timestamp).toEqual(createdAt);
      expect(firstSeen.snapshot.currentTitle).toBe("Engineer");
      expect(firstSeen.snapshot.currentCompany).toBe("Acme");
      expect(firstSeen.snapshot.location).toBe("SF");
    });

    it("should apply date range filter with 'from'", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1", "v2"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "A" },
          { _id: "v2", VisitTime: new Date("2025-06-01"), Title: "B" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF", {
        from: "2025-03-01",
      });

      // Only v2 (June) passes the from filter; first_seen (Jan 2024) and v1 (Jan 2025) filtered out
      expect(result.timeline).toHaveLength(1);
      expect(result.timeline[0].source.id).toBe("v2");
    });

    it("should apply date range filter with 'to'", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1", "v2"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "A" },
          { _id: "v2", VisitTime: new Date("2025-06-01"), Title: "B" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF", {
        to: "2025-03-01",
      });

      // first_seen (Jan 2024) and v1 (Jan 2025) pass; v2 (June) filtered out
      expect(result.timeline).toHaveLength(2);
      expect(result.timeline.every((e) => e.type !== "scan")).toBe(true);
    });

    it("should apply date range filter with both 'from' and 'to'", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1", "v2", "v3"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "A" },
          { _id: "v2", VisitTime: new Date("2025-03-15"), Title: "B" },
          { _id: "v3", VisitTime: new Date("2025-06-01"), Title: "C" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF", {
        from: "2025-02-01",
        to: "2025-04-01",
      });

      expect(result.timeline).toHaveLength(1);
      expect(result.timeline[0].source.id).toBe("v2");
    });

    it("should paginate with offset and limit", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1", "v2", "v3"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "A" },
          { _id: "v2", VisitTime: new Date("2025-02-01"), Title: "B" },
          { _id: "v3", VisitTime: new Date("2025-03-01"), Title: "C" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      // 4 total events (3 visits + first_seen), get the 2nd page of 2
      const result = await getPersonTimeline("ACwAAABCDEF", {
        limit: 2,
        offset: 2,
      });

      expect(result.timeline).toHaveLength(2);
      expect(result.metadata.totalEvents).toBe(4);
    });

    it("should return correct totalEvents before pagination", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1", "v2"], scans: ["s1"] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "A" },
          { _id: "v2", VisitTime: new Date("2025-02-01"), Title: "B" },
        ]),
      );
      Scan.find.mockReturnValue(
        leanChain([
          { _id: "s1", ScanTime: new Date("2025-03-01"), Title: "C" },
        ]),
      );
      Change.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "c1",
            type: "promotion",
            timestamp: new Date("2025-04-01"),
            from: "Dir",
            to: "VP",
          },
        ]),
      });

      const result = await getPersonTimeline("ACwAAABCDEF", { limit: 2 });

      // 2 visits + 1 scan + 1 change + 1 first_seen = 5
      expect(result.metadata.totalEvents).toBe(5);
      expect(result.timeline).toHaveLength(2);
    });

    it("should handle person with only visits (no scans)", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          {
            _id: "v1",
            VisitTime: new Date("2025-01-01"),
            Title: "Eng",
            Company: "Co",
            Location: "NY",
          },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      expect(result.timeline).toHaveLength(2); // visit + first_seen
      expect(result.timeline[0].type).toBe("visit");
      expect(result.timeline[0].snapshot.currentTitle).toBe("Eng");
    });

    it("should handle person with only changes (no observations)", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: [], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Change.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "c1",
            type: "title_change",
            timestamp: new Date("2025-05-01"),
            from: "Eng",
            to: "Sr Eng",
          },
        ]),
      });

      const result = await getPersonTimeline("ACwAAABCDEF");

      expect(result.timeline).toHaveLength(2); // change + first_seen
      expect(result.timeline[0].type).toBe("title_change");
      expect(result.timeline[1].type).toBe("first_seen");
    });

    it("should handle person with no createdAt (no first_seen event)", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: [] },
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "Eng" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      expect(result.timeline).toHaveLength(1);
      expect(result.timeline[0].type).toBe("visit");
    });

    it("should include all change types (company_change, promotion, title_change, lateral_move)", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: [], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Change.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "c1",
            type: "company_change",
            timestamp: new Date("2025-01-01"),
            from: "A",
            to: "B",
          },
          {
            _id: "c2",
            type: "promotion",
            timestamp: new Date("2025-02-01"),
            from: "Eng",
            to: "Sr Eng",
          },
          {
            _id: "c3",
            type: "title_change",
            timestamp: new Date("2025-03-01"),
            from: "Sr Eng",
            to: "Staff Eng",
          },
          {
            _id: "c4",
            type: "lateral_move",
            timestamp: new Date("2025-04-01"),
            from: "B",
            to: "C",
          },
        ]),
      });

      const result = await getPersonTimeline("ACwAAABCDEF");

      const types = result.timeline.map((e) => e.type);
      expect(types).toContain("company_change");
      expect(types).toContain("promotion");
      expect(types).toContain("title_change");
      expect(types).toContain("lateral_move");
      expect(types).toContain("first_seen");
    });

    it("should return correct dateRange in metadata", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: [] },
          createdAt: new Date("2024-06-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-02-01"), Title: "Eng" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF");

      // to = most recent (visit Feb 2025), from = oldest (first_seen Jun 2024)
      expect(new Date(result.metadata.dateRange.to).toISOString()).toBe(
        new Date("2025-02-01").toISOString(),
      );
      expect(new Date(result.metadata.dateRange.from).toISOString()).toBe(
        new Date("2024-06-01").toISOString(),
      );
    });

    it("should return null dateRange when timeline is empty after filtering", async () => {
      findPersonById.mockResolvedValue({
        person: {
          _id: "ACwAAABCDEF",
          observations: { visits: ["v1"], scans: [] },
          createdAt: new Date("2024-01-01"),
          snapshot: {},
        },
      });

      Visit.find.mockReturnValue(
        leanChain([
          { _id: "v1", VisitTime: new Date("2025-01-01"), Title: "Eng" },
        ]),
      );
      Change.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      const result = await getPersonTimeline("ACwAAABCDEF", {
        from: "2026-01-01",
      });

      expect(result.timeline).toHaveLength(0);
      expect(result.metadata.dateRange.from).toBeNull();
      expect(result.metadata.dateRange.to).toBeNull();
    });
  });
});
