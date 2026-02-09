jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  updateRolesTimeline,
  normalizeRoleText,
  findMatchingRole,
  mergeRoleFields,
} = require("../../src/controllers/personController");
const logger = require("../../src/utils/logger");

/**
 * Helper: build a minimal person-like object for updateRolesTimeline
 */
function buildPersonDoc(overrides = {}) {
  return {
    _id: overrides._id || "ACwAAATest123",
    snapshot: {
      roles: [],
      ...(overrides.snapshot || {}),
    },
  };
}

describe("PersonController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("updateRolesTimeline()", () => {
    it("should nullify endDate when endDate < startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Engineer",
              Company: "Acme Corp",
              From: "2024-06-01",
              To: "2023-01-01", // endDate before startDate
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2024-06-01"));
      expect(role.endDate).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "Role has endDate before startDate, nullifying endDate",
        expect.objectContaining({
          person_id: "ACwAAATest123",
          title: "Engineer",
          company: "Acme Corp",
        }),
      );
    });

    it("should keep valid endDate when endDate >= startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Manager",
              Company: "Globex",
              From: "2023-01-01",
              To: "2024-06-01",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2023-01-01"));
      expect(role.endDate).toEqual(new Date("2024-06-01"));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should handle endDate equal to startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Intern",
              Company: "StartupCo",
              From: "2024-03-15",
              To: "2024-03-15",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2024-03-15"));
      expect(role.endDate).toEqual(new Date("2024-03-15"));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // --- Role deduplication: null startDate handling ---

    it("should collapse undated roles with same title+company+isCurrent", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: null,
              endDate: null,
              isCurrent: true,
              location: null,
              description: null,
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            { Title: "Engineer", Company: "TechCorp", To: "Present" },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
    });

    it("should keep undated roles at same title+company when locations differ", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: null,
              endDate: null,
              isCurrent: true,
              location: "New York",
              description: null,
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "Engineer",
              Company: "TechCorp",
              Location: "San Francisco",
              To: "Present",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(2);
      expect(person.snapshot.roles[0].location).toBe("New York");
      expect(person.snapshot.roles[1].location).toBe("San Francisco");
    });

    it("should keep undated roles at same title+company when descriptions differ", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Consultant",
              companyName: "KPMG",
              startDate: null,
              endDate: null,
              isCurrent: false,
              location: null,
              description: "Advisory practice",
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "Consultant",
              Company: "KPMG",
              Description: "Tax practice",
              To: "2023-01-01",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(2);
    });

    it("should not match undated non-current incoming against dated existing role", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: new Date("2022-01-01"),
              endDate: new Date("2023-01-01"),
              isCurrent: false,
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            { Title: "Engineer", Company: "TechCorp", To: "2023-01-01" },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(2);
    });

    it("should match undated current incoming against dated current existing", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: new Date("2022-01-01"),
              endDate: null,
              isCurrent: true,
            },
          ],
        },
      });

      // Single current role path (no extended data, no dates)
      const observationData = {
        Title: "Engineer",
        Company: "TechCorp",
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
    });

    // --- Role deduplication: title/company normalization ---

    it("should dedup roles with different casing in title and company", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Software Engineer",
              companyName: "Google LLC",
              startDate: new Date("2022-01-01"),
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "software engineer",
              Company: "google llc",
              From: "2022-01-01",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
    });

    it("should dedup roles with extra whitespace in title and company", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "VP of Sales",
              companyName: "Acme Corp",
              startDate: new Date("2023-06-01"),
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "  VP  of  Sales ",
              Company: " Acme  Corp ",
              From: "2023-06-01",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
    });

    it("should dedup single current role with different casing", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "CEO",
              companyName: "StartupCo",
              startDate: null,
              isCurrent: true,
            },
          ],
        },
      });

      const observationData = {
        Title: "ceo",
        Company: "startupco",
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
    });

    // --- Role field merging on duplicate ---

    it("should backfill missing fields on existing role when duplicate brings new data", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: new Date("2022-01-01"),
              endDate: null,
              location: null,
              description: null,
              companyId: null,
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "Engineer",
              Company: "TechCorp",
              From: "2022-01-01",
              To: "2024-06-01",
              Location: "San Francisco",
              Description: "Built distributed systems",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);
      const role = person.snapshot.roles[0];
      expect(role.endDate).toEqual(new Date("2024-06-01"));
      expect(role.location).toBe("San Francisco");
      expect(role.description).toBe("Built distributed systems");
    });

    it("should not overwrite populated fields during merge", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: new Date("2022-01-01"),
              location: "New York",
              description: "Original description",
            },
          ],
        },
      });

      const observationData = {
        extended: {
          positions: [
            {
              Title: "Engineer",
              Company: "TechCorp",
              From: "2022-01-01",
              Location: "San Francisco",
              Description: "New description",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(false);
      expect(person.snapshot.roles).toHaveLength(1);
      expect(person.snapshot.roles[0].location).toBe("New York");
      expect(person.snapshot.roles[0].description).toBe("Original description");
    });

    it("should backfill companyId on matched single current role", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [
            {
              title: "CTO",
              companyName: "MegaCorp",
              startDate: null,
              isCurrent: true,
              companyId: null,
            },
          ],
        },
      });

      const observationData = {
        Title: "CTO",
        Company: "MegaCorp",
        CompanyID: "12345678",
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);
      expect(person.snapshot.roles[0].companyId).toBe("12345678");
    });
  });

  describe("normalizeRoleText()", () => {
    it("should trim and lowercase", () => {
      expect(normalizeRoleText("  Software Engineer ")).toBe(
        "software engineer",
      );
    });

    it("should collapse internal whitespace", () => {
      expect(normalizeRoleText("VP  of   Sales")).toBe("vp of sales");
    });

    it("should return empty string for null/undefined", () => {
      expect(normalizeRoleText(null)).toBe("");
      expect(normalizeRoleText(undefined)).toBe("");
    });

    it("should coerce numbers to string", () => {
      expect(normalizeRoleText(42)).toBe("42");
    });
  });

  describe("findMatchingRole()", () => {
    it("should match dated roles by title + company + startDate", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2022-01-01"),
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: new Date("2022-01-01"),
      };

      expect(findMatchingRole(existing, incoming)).toBe(existing[0]);
    });

    it("should not match dated roles with different startDate", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2022-01-01"),
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: new Date("2023-06-01"),
      };

      expect(findMatchingRole(existing, incoming)).toBeUndefined();
    });

    it("should match undated roles with same title + company + isCurrent", () => {
      const existing = [
        {
          title: "Manager",
          companyName: "Corp",
          startDate: null,
          isCurrent: true,
        },
      ];
      const incoming = {
        title: "Manager",
        companyName: "Corp",
        startDate: null,
        isCurrent: true,
        location: null,
        description: null,
      };

      expect(findMatchingRole(existing, incoming)).toBe(existing[0]);
    });

    it("should not match undated roles with different isCurrent", () => {
      const existing = [
        {
          title: "Manager",
          companyName: "Corp",
          startDate: null,
          isCurrent: true,
        },
      ];
      const incoming = {
        title: "Manager",
        companyName: "Corp",
        startDate: null,
        isCurrent: false,
        location: null,
        description: null,
      };

      expect(findMatchingRole(existing, incoming)).toBeUndefined();
    });

    it("should match undated current incoming against dated current existing", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2022-01-01"),
          isCurrent: true,
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: null,
        isCurrent: true,
      };

      expect(findMatchingRole(existing, incoming)).toBe(existing[0]);
    });

    it("should not match undated non-current incoming against dated non-current existing", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2022-01-01"),
          isCurrent: false,
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: null,
        isCurrent: false,
        location: null,
        description: null,
      };

      expect(findMatchingRole(existing, incoming)).toBeUndefined();
    });

    it("should match case-insensitively", () => {
      const existing = [
        {
          title: "VP of Sales",
          companyName: "Acme Corp",
          startDate: new Date("2022-01-01"),
        },
      ];
      const incoming = {
        title: "vp of sales",
        companyName: "acme corp",
        startDate: new Date("2022-01-01"),
      };

      expect(findMatchingRole(existing, incoming)).toBe(existing[0]);
    });

    it("should not match undated roles with different locations", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: null,
          isCurrent: true,
          location: "NYC",
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: null,
        isCurrent: true,
        location: "SF",
        description: null,
      };

      expect(findMatchingRole(existing, incoming)).toBeUndefined();
    });

    it("should match undated roles when only one has location", () => {
      const existing = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: null,
          isCurrent: true,
          location: null,
        },
      ];
      const incoming = {
        title: "Engineer",
        companyName: "Corp",
        startDate: null,
        isCurrent: true,
        location: "NYC",
        description: null,
      };

      expect(findMatchingRole(existing, incoming)).toBe(existing[0]);
    });
  });

  describe("mergeRoleFields()", () => {
    it("should backfill null fields from incoming data", () => {
      const existing = {
        title: "Engineer",
        companyId: null,
        location: null,
        description: null,
        startDate: null,
        endDate: null,
      };

      const merged = mergeRoleFields(existing, {
        companyId: "12345",
        location: "NYC",
        description: "Doing things",
        startDate: new Date("2022-01-01"),
        endDate: new Date("2024-01-01"),
      });

      expect(merged).toBe(true);
      expect(existing.companyId).toBe("12345");
      expect(existing.location).toBe("NYC");
      expect(existing.description).toBe("Doing things");
      expect(existing.startDate).toEqual(new Date("2022-01-01"));
      expect(existing.endDate).toEqual(new Date("2024-01-01"));
    });

    it("should not overwrite populated fields", () => {
      const existing = {
        title: "Engineer",
        companyId: "111",
        location: "SF",
        description: "Original",
        startDate: new Date("2022-01-01"),
        endDate: new Date("2023-01-01"),
      };

      const merged = mergeRoleFields(existing, {
        companyId: "222",
        location: "NYC",
        description: "Different",
        startDate: new Date("2020-01-01"),
        endDate: new Date("2025-01-01"),
      });

      expect(merged).toBe(false);
      expect(existing.companyId).toBe("111");
      expect(existing.location).toBe("SF");
    });

    it("should return false when incoming has no new data", () => {
      const existing = {
        title: "Engineer",
        companyId: "111",
        location: "SF",
        description: "Desc",
        startDate: new Date("2022-01-01"),
        endDate: null,
      };

      const merged = mergeRoleFields(existing, {
        companyId: null,
        endDate: null,
      });

      expect(merged).toBe(false);
    });
  });
});
