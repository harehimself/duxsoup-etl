/**
 * Tests for CSV Enrichment Import — createPersonFromCsv()
 */

// Mock dependencies before requiring the module
jest.mock("../../src/models/person");
jest.mock("../../src/services/identityResolverService");
jest.mock("../../src/utils/database");
jest.mock("../../src/utils/logger");

const Person = require("../../src/models/person");
const identityResolverService = require("../../src/services/identityResolverService");

const {
  createPersonFromCsv,
  transformCsvRow,
  parseConnections,
  parseDegree,
} = require("../../scripts/importCsvEnrichment");

// Helper to build a minimal CSV row with a SalesProfile
function buildCsvRow(overrides = {}) {
  return {
    id: "row-123",
    Profile: "https://www.linkedin.com/in/janedoe/",
    SalesProfile:
      "https://www.linkedin.com/sales/people/ACwAAALwVAIBtest,NAME,xxxx",
    PublicProfile: "",
    RecruiterProfile: "",
    "First Name": "Jane",
    "Middle Name": "",
    "Last Name": "Doe",
    Title: "VP of Engineering",
    Company: "Acme Corp",
    Location: "San Francisco, California, United States",
    Industry: "Technology",
    Connections: "500+",
    Summary: "Experienced engineering leader",
    Email: "jane@example.com",
    Phone: "+1-555-0100",
    Twitter: "@janedoe",
    Degree: "1st",
    Picture: "https://media.licdn.com/photo.jpg",
    PersonalWebsite: "https://janedoe.com",
    CompanyWebsite: "https://acme.com",
    CompanyProfile: "",
    VisitTime: "2025-01-15T10:00:00Z",
    ...overrides,
  };
}

// Helper to build a fake Person document returned by resolveOrCreate
function buildFakePerson(overrides = {}) {
  return {
    _id: "ACwAAALwVAIBtest",
    canonical_id: "test-canonical-id",
    aliases: [{ type: "salesNavId", value: "ACwAAALwVAIBtest" }],
    snapshot: {},
    observations: { visits: [], scans: [] },
    meta: {},
    derived: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("importCsvEnrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createPersonFromCsv()", () => {
    it("should return { created: true } in dry-run without DB writes", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };

      const result = await createPersonFromCsv(row, csvData, identifiers, true);

      expect(result.created).toBe(true);
      expect(result.person_id).toBeTruthy();
      // No DB calls in dry-run
      expect(identityResolverService.resolveOrCreate).not.toHaveBeenCalled();
    });

    it("should return { created: false, error } when no stable identity", async () => {
      // Row with no SalesProfile and no usable Profile
      const row = buildCsvRow({
        SalesProfile: "",
        Profile: "",
        PublicProfile: "",
        RecruiterProfile: "",
        id: "",
      });
      const csvData = transformCsvRow(row);
      const identifiers = {};

      const result = await createPersonFromCsv(
        row,
        csvData,
        identifiers,
        false,
      );

      expect(result.created).toBe(false);
      expect(result.error).toBe("no_stable_identity");
    });

    it("should populate snapshot with correct _meta provenance", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      const result = await createPersonFromCsv(
        row,
        csvData,
        identifiers,
        false,
      );

      expect(result.created).toBe(true);
      expect(fakePerson.save).toHaveBeenCalled();

      // Check _meta provenance for a field
      expect(fakePerson.snapshot._meta.firstName).toEqual(
        expect.objectContaining({
          value: "Jane",
          source: "csv",
          observationId: null,
        }),
      );
      expect(fakePerson.snapshot._meta.email).toEqual(
        expect.objectContaining({
          value: "jane@example.com",
          source: "csv",
          observationId: null,
        }),
      );
    });

    it("should compute fullName from name parts", async () => {
      const row = buildCsvRow({
        "First Name": "Jane",
        "Middle Name": "Marie",
        "Last Name": "Doe",
      });
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.snapshot.fullName).toBe("Jane Marie Doe");
      expect(fakePerson.snapshot._meta.fullName.value).toBe("Jane Marie Doe");
    });

    it("should compute fullName without middle name when absent", async () => {
      const row = buildCsvRow({ "Middle Name": "" });
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.snapshot.fullName).toBe("Jane Doe");
    });

    it("should parse and set structured location fields", async () => {
      const row = buildCsvRow({
        Location: "San Francisco, California, United States",
      });
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.snapshot.location).toBe(
        "San Francisco, California, United States",
      );
      expect(fakePerson.snapshot.city).toBe("San Francisco");
      expect(fakePerson.snapshot.country).toBe("United States");
    });

    it("should populate roles with seniority from parseTitle", async () => {
      const row = buildCsvRow();
      // Add position data
      row["Position-0-Company"] = "Acme Corp";
      row["Position-0-Title"] = "VP of Engineering";
      row["Position-0-From"] = "Jan 2020";
      row["Position-0-To"] = "Present";

      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.snapshot.roles).toHaveLength(1);
      expect(fakePerson.snapshot.roles[0].title).toBe("VP of Engineering");
      expect(fakePerson.snapshot.roles[0].companyName).toBe("Acme Corp");
      expect(fakePerson.snapshot.roles[0].seniority).toBe("VP");
      expect(fakePerson.snapshot.roles[0].seniorityRank).toBe(5);
    });

    it("should set _enrichment.createdFromCsv: true", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.snapshot._enrichment).toEqual(
        expect.objectContaining({
          createdFromCsv: true,
        }),
      );
    });

    it("should handle E11000 duplicate key with enrichment fallback", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };

      const fakePerson = buildFakePerson();
      const duplicateError = new Error("E11000 duplicate key");
      duplicateError.code = 11000;
      fakePerson.save.mockRejectedValue(duplicateError);

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      // When E11000 fires, we look up the existing person
      const existingPerson = buildFakePerson({
        snapshot: {
          firstName: "Jane",
          email: null,
          skills: [],
          roles: [],
          education: [],
          _meta: {},
        },
      });
      Person.findById.mockResolvedValue(existingPerson);

      const result = await createPersonFromCsv(
        row,
        csvData,
        identifiers,
        false,
      );

      expect(result.created).toBe(false);
      expect(result.enriched).toBe(true);
      expect(Person.findById).toHaveBeenCalledWith(fakePerson._id);
    });

    it("should set meta.observationsCount to 0", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      expect(fakePerson.meta.observationsCount).toBe(0);
      expect(fakePerson.meta.lastObservation).toBeNull();
    });

    it("should compute derived metrics from roles", async () => {
      const row = buildCsvRow();
      row["Position-0-Company"] = "Acme Corp";
      row["Position-0-Title"] = "VP of Engineering";
      row["Position-0-From"] = "Jan 2020";
      row["Position-0-To"] = "Present";

      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };
      const fakePerson = buildFakePerson();

      identityResolverService.resolveOrCreate.mockResolvedValue(fakePerson);

      await createPersonFromCsv(row, csvData, identifiers, false);

      // derived should be computed from roles
      expect(fakePerson.derived).toBeDefined();
      expect(fakePerson.derived.highestSeniority).toBe("VP");
      expect(fakePerson.derived.highestSeniorityRank).toBe(5);
    });

    it("should fall back to enrichPerson when snapshot already populated", async () => {
      const row = buildCsvRow();
      const csvData = transformCsvRow(row);
      const identifiers = { salesNavId: csvData.salesNavId };

      const alreadyPopulated = buildFakePerson({
        snapshot: {
          firstName: "Jane",
          lastName: "Doe",
          email: null,
          skills: [],
          roles: [],
          education: [],
          _meta: {},
        },
      });

      identityResolverService.resolveOrCreate.mockResolvedValue(
        alreadyPopulated,
      );

      const result = await createPersonFromCsv(
        row,
        csvData,
        identifiers,
        false,
      );

      expect(result.created).toBe(false);
      expect(result.enriched).toBe(true);
      expect(result.person_id).toBe(alreadyPopulated._id);
    });
  });

  describe("parseConnections()", () => {
    it('should parse "500+" to 500', () => {
      expect(parseConnections("500+")).toBe(500);
    });

    it("should parse plain number strings", () => {
      expect(parseConnections("1234")).toBe(1234);
    });

    it("should return null for empty/null", () => {
      expect(parseConnections(null)).toBeNull();
      expect(parseConnections("")).toBeNull();
    });
  });

  describe("parseDegree()", () => {
    it('should parse "1st" to 1', () => {
      expect(parseDegree("1st")).toBe(1);
    });

    it('should parse "2" to 2', () => {
      expect(parseDegree("2")).toBe(2);
    });

    it("should return null for out-of-range values", () => {
      expect(parseDegree("5")).toBeNull();
    });

    it("should return null for null/empty", () => {
      expect(parseDegree(null)).toBeNull();
      expect(parseDegree("")).toBeNull();
    });
  });
});
