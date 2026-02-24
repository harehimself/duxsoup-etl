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
  normalizeField,
  cleanString,
  normalizeEmail,
  normalizePhone,
  updateSkills,
  updateEducation,
  FIELD_MAPPINGS,
  LOCATION_FIELDS,
  SKIP_CLEAN_FIELDS,
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
              companyName: "Google",
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

  describe("FIELD_MAPPINGS", () => {
    const EXPECTED_FIELDS = [
      "firstName",
      "middleName",
      "lastName",
      "currentTitle",
      "currentCompany",
      "currentCompanyId",
      "currentCompanyProfile",
      "location",
      "industry",
      "connections",
      "summary",
      "degree",
      "email",
      "phone",
      "twitter",
      "profilePicture",
      "thumbnail",
      "personalWebsite",
      "companyWebsite",
    ];

    it("should contain all expected snapshot fields", () => {
      const mappedFields = FIELD_MAPPINGS.map((m) => m.field);
      for (const field of EXPECTED_FIELDS) {
        expect(mappedFields).toContain(field);
      }
    });

    it("should have no duplicate field names", () => {
      const fields = FIELD_MAPPINGS.map((m) => m.field);
      expect(new Set(fields).size).toBe(fields.length);
    });

    it("should have a string or array source for every mapping", () => {
      for (const mapping of FIELD_MAPPINGS) {
        const validSource =
          typeof mapping.source === "string" || Array.isArray(mapping.source);
        expect(validSource).toBe(true);
      }
    });

    it("should apply transform for connections field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "connections");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("500+")).toBe(500);
      expect(mapping.transform(null)).toBeNull();
    });

    it("should apply transform for degree field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "degree");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("2nd")).toBe(2);
      expect(mapping.transform(null)).toBeNull();
    });

    it("should use fallback sources for degree field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "degree");
      expect(Array.isArray(mapping.source)).toBe(true);
      expect(mapping.source).toEqual(["Degree", "Connection Degree"]);
    });

    it("should resolve first non-null value from fallback sources", () => {
      const snapshot = { _meta: {} };
      const meta = {
        observedAt: new Date(),
        source: "visit",
        observationId: "obs1",
      };

      // Simulate the loop logic for degree with first source present
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "degree");
      const webhookData = { Degree: "1st" };
      let value;
      for (const key of mapping.source) {
        if (webhookData[key] != null) {
          value = webhookData[key];
          break;
        }
      }
      value = mapping.transform(value);
      normalizeField(snapshot, mapping.field, value, meta);
      expect(snapshot.degree).toBe(1);
    });

    it("should resolve fallback source when primary is missing", () => {
      const snapshot = { _meta: {} };
      const meta = {
        observedAt: new Date(),
        source: "visit",
        observationId: "obs1",
      };

      const mapping = FIELD_MAPPINGS.find((m) => m.field === "degree");
      const webhookData = { "Connection Degree": "3rd" };
      let value;
      for (const key of mapping.source) {
        if (webhookData[key] != null) {
          value = webhookData[key];
          break;
        }
      }
      value = mapping.transform(value);
      normalizeField(snapshot, mapping.field, value, meta);
      expect(snapshot.degree).toBe(3);
    });
  });

  describe("LOCATION_FIELDS", () => {
    const EXPECTED_LOCATION_FIELDS = [
      "city",
      "state",
      "stateCode",
      "country",
      "countryCode",
      "province",
      "region",
      "locationType",
    ];

    it("should contain all expected location sub-fields", () => {
      for (const field of EXPECTED_LOCATION_FIELDS) {
        expect(LOCATION_FIELDS).toContain(field);
      }
    });

    it("should have no duplicate field names", () => {
      expect(new Set(LOCATION_FIELDS).size).toBe(LOCATION_FIELDS.length);
    });

    it("should match the parseLocation() result shape", () => {
      // parseLocation returns an object with these exact keys
      const { parseLocation } = require("../../src/utils/location-parser");
      const result = parseLocation("San Francisco, California, United States");
      for (const field of LOCATION_FIELDS) {
        expect(field in result).toBe(true);
      }
    });
  });

  // ── Data Cleansing Tests ────────────────────────────────────────

  describe("cleanString()", () => {
    it("should return null for null input", () => {
      expect(cleanString(null)).toBeNull();
    });

    it("should return undefined for undefined input", () => {
      expect(cleanString(undefined)).toBeUndefined();
    });

    it("should pass non-strings through unchanged", () => {
      expect(cleanString(42)).toBe(42);
      expect(cleanString(true)).toBe(true);
    });

    it("should trim leading and trailing whitespace", () => {
      expect(cleanString("  John  ")).toBe("John");
    });

    it("should collapse internal multi-spaces to single space", () => {
      expect(cleanString("Vice   President  of  Sales")).toBe(
        "Vice President of Sales",
      );
    });

    it("should handle empty string after trim", () => {
      expect(cleanString("   ")).toBe("");
    });

    it("should handle tabs and newlines", () => {
      expect(cleanString("\tSoftware\n  Engineer\r")).toBe("Software Engineer");
    });
  });

  describe("normalizeEmail()", () => {
    it("should lowercase and trim email", () => {
      expect(normalizeEmail("  John@Gmail.COM  ")).toBe("john@gmail.com");
    });

    it("should return null for null input", () => {
      expect(normalizeEmail(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(normalizeEmail(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(normalizeEmail("")).toBeNull();
      expect(normalizeEmail("   ")).toBeNull();
    });

    it("should warn on invalid email format but still return it", () => {
      const result = normalizeEmail("not-an-email");
      expect(result).toBe("not-an-email");
      expect(logger.warn).toHaveBeenCalledWith(
        "Email fails basic format validation",
        { email: "not-an-email" },
      );
    });

    it("should not warn on valid email format", () => {
      normalizeEmail("user@example.com");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("SKIP_CLEAN_FIELDS", () => {
    it("should skip URL and ID fields", () => {
      expect(SKIP_CLEAN_FIELDS.has("currentCompanyId")).toBe(true);
      expect(SKIP_CLEAN_FIELDS.has("currentCompanyProfile")).toBe(true);
      expect(SKIP_CLEAN_FIELDS.has("profilePicture")).toBe(true);
      expect(SKIP_CLEAN_FIELDS.has("thumbnail")).toBe(true);
      expect(SKIP_CLEAN_FIELDS.has("personalWebsite")).toBe(true);
      expect(SKIP_CLEAN_FIELDS.has("companyWebsite")).toBe(true);
    });

    it("should skip email (has its own normalizeEmail transform)", () => {
      expect(SKIP_CLEAN_FIELDS.has("email")).toBe(true);
    });

    it("should not skip text fields like firstName or currentTitle", () => {
      expect(SKIP_CLEAN_FIELDS.has("firstName")).toBe(false);
      expect(SKIP_CLEAN_FIELDS.has("currentTitle")).toBe(false);
    });

    it("should skip currentCompany (has its own normalizeCompanyName transform)", () => {
      expect(SKIP_CLEAN_FIELDS.has("currentCompany")).toBe(true);
    });
  });

  describe("FIELD_MAPPINGS whitespace cleaning", () => {
    it("should apply normalizeEmail transform for email field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "email");
      expect(mapping.transform).toBe(normalizeEmail);
    });

    it("should clean firstName through FIELD_MAPPINGS loop simulation", () => {
      const snapshot = { _meta: {} };
      const meta = {
        observedAt: new Date(),
        source: "visit",
        observationId: "obs1",
      };

      // Simulate the FIELD_MAPPINGS loop logic
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "firstName");
      let value = "  John  ";
      if (mapping.transform) value = mapping.transform(value);
      if (!SKIP_CLEAN_FIELDS.has(mapping.field)) value = cleanString(value);
      normalizeField(snapshot, mapping.field, value, meta);

      expect(snapshot.firstName).toBe("John");
    });

    it("should NOT apply cleanString to URL fields but ensureHttps trims whitespace", () => {
      const snapshot = { _meta: {} };
      const meta = {
        observedAt: new Date(),
        source: "visit",
        observationId: "obs1",
      };

      const mapping = FIELD_MAPPINGS.find((m) => m.field === "profilePicture");
      let value = "  https://example.com/pic.jpg  ";
      if (mapping.transform) value = mapping.transform(value);
      if (!SKIP_CLEAN_FIELDS.has(mapping.field)) value = cleanString(value);
      normalizeField(snapshot, mapping.field, value, meta);

      // URL fields skip cleanString but ensureHttps trims whitespace
      expect(snapshot.profilePicture).toBe("https://example.com/pic.jpg");
    });
  });

  describe("Role whitespace cleaning", () => {
    it("should clean title, company, location, and description in extended positions", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "  Software  Engineer ",
              Company: " Google  LLC ",
              Location: "  San Francisco ",
              Description: " Built  stuff ",
              From: "2022-01-01",
            },
          ],
        },
      };

      updateRolesTimeline(person, observationData, {});

      const role = person.snapshot.roles[0];
      expect(role.title).toBe("Software Engineer");
      expect(role.companyName).toBe("Google");
      expect(role.location).toBe("San Francisco");
      expect(role.description).toBe("Built stuff");
    });

    it("should clean title and company in single current-role path", () => {
      const person = buildPersonDoc();
      const observationData = {
        Title: "  VP  of  Sales ",
        Company: " Acme  Corp ",
        Location: "  New York ",
      };

      updateRolesTimeline(person, observationData, {});

      const role = person.snapshot.roles[0];
      expect(role.title).toBe("VP of Sales");
      expect(role.companyName).toBe("Acme Corp");
      expect(role.location).toBe("New York");
    });
  });

  describe("Education whitespace and case-insensitive dedup", () => {
    it("should clean school, degree, and field before storage", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], education: [] },
      });

      updateEducation(person, [
        { Name: "  MIT  ", Degree: " BS ", Field: " CS " },
      ]);

      expect(person.snapshot.education[0].school).toBe("MIT");
      expect(person.snapshot.education[0].degree).toBe("BS");
      expect(person.snapshot.education[0].field).toBe("CS");
    });

    it("should deduplicate education entries case-insensitively", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [],
          education: [{ school: "MIT", degree: "BS", field: "CS" }],
        },
      });

      updateEducation(person, [{ Name: "mit", Degree: "bs", Field: "cs" }]);

      expect(person.snapshot.education).toHaveLength(1);
    });

    it("should deduplicate education with whitespace differences", () => {
      const person = buildPersonDoc({
        snapshot: {
          roles: [],
          education: [
            {
              school: "Harvard University",
              degree: "MBA",
              field: "Business",
            },
          ],
        },
      });

      updateEducation(person, [
        {
          Name: "  Harvard  University  ",
          Degree: "  MBA ",
          Field: " Business ",
        },
      ]);

      expect(person.snapshot.education).toHaveLength(1);
    });
  });

  describe("Phone normalization in FIELD_MAPPINGS", () => {
    it("should have normalizePhone transform for phone field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "phone");
      expect(mapping.transform).toBe(normalizePhone);
    });

    it("should include phone in SKIP_CLEAN_FIELDS", () => {
      expect(SKIP_CLEAN_FIELDS.has("phone")).toBe(true);
    });

    it("should normalize phone through FIELD_MAPPINGS loop simulation", () => {
      const snapshot = { _meta: {} };
      const meta = {
        observedAt: new Date(),
        source: "visit",
        observationId: "obs1",
      };

      const mapping = FIELD_MAPPINGS.find((m) => m.field === "phone");
      let value = "+1 (555) 123-4567";
      if (mapping.transform) value = mapping.transform(value);
      if (!SKIP_CLEAN_FIELDS.has(mapping.field)) value = cleanString(value);
      normalizeField(snapshot, mapping.field, value, meta);

      expect(snapshot.phone).toBe("+15551234567");
    });

    it("should not apply cleanString to phone field", () => {
      // cleanString would strip the leading + and collapse digits
      // SKIP_CLEAN_FIELDS prevents this
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "phone");
      expect(SKIP_CLEAN_FIELDS.has(mapping.field)).toBe(true);
    });
  });

  describe("Skill case-insensitive deduplication", () => {
    it("should deduplicate skills case-insensitively", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], skills: ["JavaScript"] },
      });

      updateSkills(person, ["javascript", "JAVASCRIPT"]);

      expect(person.snapshot.skills).toHaveLength(1);
      expect(person.snapshot.skills[0]).toBe("JavaScript"); // first-seen casing
    });

    it("should store first-seen casing for new skills", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], skills: [] },
      });

      updateSkills(person, ["React", "react", "REACT"]);

      expect(person.snapshot.skills).toHaveLength(1);
      expect(person.snapshot.skills[0]).toBe("React");
    });

    it("should trim and clean incoming skills", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], skills: [] },
      });

      updateSkills(person, ["  Machine  Learning  "]);

      expect(person.snapshot.skills[0]).toBe("Machine Learning");
    });

    it("should skip null and empty skills after cleaning", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], skills: [] },
      });

      const result = updateSkills(person, [null, "", "   ", "Python"]);

      expect(result).toBe(true);
      expect(person.snapshot.skills).toHaveLength(1);
      expect(person.snapshot.skills[0]).toBe("Python");
    });

    it("should preserve existing skills with different casing in lookups", () => {
      const person = buildPersonDoc({
        snapshot: { roles: [], skills: ["TypeScript", "Python"] },
      });

      updateSkills(person, ["typescript", "python", "Go"]);

      expect(person.snapshot.skills).toHaveLength(3);
      expect(person.snapshot.skills).toEqual(["TypeScript", "Python", "Go"]);
    });
  });

  describe("ensureHttps transform in FIELD_MAPPINGS", () => {
    it("should have ensureHttps transform for companyWebsite field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "companyWebsite");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("http://example.com")).toBe(
        "https://example.com",
      );
    });

    it("should have ensureHttps transform for personalWebsite field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "personalWebsite");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("http://mysite.com")).toBe("https://mysite.com");
    });

    it("should have ensureHttps transform for profilePicture field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "profilePicture");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("http://cdn.linkedin.com/photo.jpg")).toBe(
        "https://cdn.linkedin.com/photo.jpg",
      );
    });

    it("should have ensureHttps transform for thumbnail field", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "thumbnail");
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("http://cdn.linkedin.com/thumb.jpg")).toBe(
        "https://cdn.linkedin.com/thumb.jpg",
      );
    });

    it("should have ensureHttps transform for currentCompanyProfile field", () => {
      const mapping = FIELD_MAPPINGS.find(
        (m) => m.field === "currentCompanyProfile",
      );
      expect(mapping.transform).toBeDefined();
      expect(mapping.transform("http://linkedin.com/company/12345")).toBe(
        "https://linkedin.com/company/12345",
      );
    });

    it("should preserve https URLs through ensureHttps transform", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "companyWebsite");
      expect(mapping.transform("https://already-secure.com")).toBe(
        "https://already-secure.com",
      );
    });

    it("should pass null through ensureHttps transform unchanged", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "companyWebsite");
      expect(mapping.transform(null)).toBeNull();
    });

    it("should convert http:// to https:// through FIELD_MAPPINGS loop simulation", () => {
      const mapping = FIELD_MAPPINGS.find((m) => m.field === "companyWebsite");
      const webhookData = { CompanyWebsite: "http://www.acme.com" };
      let value = webhookData[mapping.source];
      if (mapping.transform) {
        value = mapping.transform(value);
      }
      expect(value).toBe("https://www.acme.com");
    });
  });
});
