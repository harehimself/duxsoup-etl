jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../models/company", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock("../models/location", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock("../utils/identityMatcher", () => ({
  resolveCompanyIdentity: jest.fn(),
  resolveLocationIdentity: jest.fn(),
}));

jest.mock("../utils/aliasHelpers", () => ({
  dedupeAliases: jest.fn((arr) => arr),
}));

const {
  upsertCompanyFromObservation,
} = require("../controllers/companyController");
const {
  upsertLocationFromObservation,
} = require("../controllers/locationController");
const Company = require("../models/company");
const Location = require("../models/location");
const {
  resolveCompanyIdentity,
  resolveLocationIdentity,
} = require("../utils/identityMatcher");
const { dedupeAliases } = require("../utils/aliasHelpers");

function buildDoc(fields = {}) {
  return {
    _id: fields._id || "test-id",
    canonical_id: fields.canonical_id || "canonical-uuid",
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    save: jest.fn().mockResolvedValue(undefined),
    ...fields,
  };
}

describe("Entity Upsert Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe("Company: create and update lifecycle", () => {
    it("should create company from visit, then update snapshot when scan arrives", async () => {
      const visitTime = new Date("2024-06-01");
      const scanTime = new Date("2024-06-15");

      // Step 1: Visit creates the company
      const visitObs = {
        _id: "obs-visit",
        rawData: {
          data: {
            Company: "VisitCorp",
            CompanyID: "11111111",
            Industry: "Tech",
            CompanyProfile: "https://linkedin.com/company/11111111",
            VisitTime: visitTime,
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "11111111",
        canonical_id: "canonical-vc",
        aliases: [
          { type: "numericId", value: "11111111" },
          { type: "name", value: "VisitCorp" },
        ],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const companyDoc = buildDoc({
        _id: "11111111",
        canonical_id: "canonical-vc",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOne.mockResolvedValue(null);
      Company.create.mockResolvedValue(companyDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Company.findById.mockResolvedValue(companyDoc);

      await upsertCompanyFromObservation(visitObs, "visit");

      expect(companyDoc.snapshot.name).toBe("VisitCorp");
      expect(companyDoc.snapshot.industry).toBe("Tech");
      expect(companyDoc.save).toHaveBeenCalled();

      // Step 2: Scan arrives with different data — should update (no precedence on master)
      const scanObs = {
        _id: "obs-scan",
        rawData: {
          data: {
            Company: "ScanCorp",
            CompanyID: "11111111",
            Industry: "SaaS",
            ScanTime: scanTime,
          },
        },
      };

      jest.clearAllMocks();
      Company.findOne.mockResolvedValue(companyDoc);
      Company.findById.mockResolvedValue(companyDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await upsertCompanyFromObservation(scanObs, "scan");

      // Scan with non-empty different values overwrites on master
      expect(companyDoc.snapshot.name).toBe("ScanCorp");
      expect(companyDoc.snapshot.industry).toBe("SaaS");
    });

    it("should not overwrite existing fields with empty/null values", async () => {
      resolveCompanyIdentity.mockReturnValue({
        company_id: "33333333",
        canonical_id: "canonical-empty",
        aliases: [{ type: "numericId", value: "33333333" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildDoc({
        _id: "33333333",
        snapshot: { name: "Existing Corp", industry: "Finance" },
        observations: { visits: ["obs-1"], scans: [] },
      });

      Company.findOne.mockResolvedValue(existingDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Company.findById.mockResolvedValue(existingDoc);

      const obs = {
        _id: "obs-empty",
        rawData: {
          data: {
            Company: "", // empty string
            CompanyID: "33333333",
            Industry: null, // null
            VisitTime: new Date("2024-07-01"),
          },
        },
      };

      await upsertCompanyFromObservation(obs, "visit");

      // Empty/null values should not overwrite
      expect(existingDoc.snapshot.name).toBe("Existing Corp");
      expect(existingDoc.snapshot.industry).toBe("Finance");
    });

    it("should handle E11000 race condition by falling through to findById", async () => {
      resolveCompanyIdentity.mockReturnValue({
        company_id: "99999999",
        canonical_id: "canonical-race",
        aliases: [{ type: "numericId", value: "99999999" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      Company.findOne.mockResolvedValue(null);

      const dupError = new Error("E11000 duplicate key");
      dupError.code = 11000;
      Company.create.mockRejectedValue(dupError);

      const existingDoc = buildDoc({
        _id: "99999999",
        canonical_id: "canonical-race",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });
      Company.findById.mockResolvedValue(existingDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const obs = {
        _id: "obs-race",
        rawData: {
          data: {
            Company: "RaceCorp",
            CompanyID: "99999999",
            VisitTime: new Date("2024-08-01"),
          },
        },
      };

      const result = await upsertCompanyFromObservation(obs, "visit");

      expect(Company.findById).toHaveBeenCalledWith("99999999");
      expect(result).toBeTruthy();
      expect(existingDoc.save).toHaveBeenCalled();
    });
  });

  describe("Company: scan then visit sequence", () => {
    it("should create company from scan, then update when visit arrives", async () => {
      const scanObs = {
        _id: "obs-scan-first",
        rawData: {
          data: {
            Company: "ScanFirst",
            CompanyID: "22222222",
            Industry: "Retail",
            ScanTime: new Date("2024-05-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "22222222",
        canonical_id: "canonical-sf",
        aliases: [{ type: "numericId", value: "22222222" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const doc = buildDoc({
        _id: "22222222",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOne.mockResolvedValue(null);
      Company.create.mockResolvedValue(doc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Company.findById.mockResolvedValue(doc);

      await upsertCompanyFromObservation(scanObs, "scan");

      expect(doc.snapshot.name).toBe("ScanFirst");
      expect(doc.snapshot.industry).toBe("Retail");

      // Visit arrives later — should overwrite scan data
      const visitObs = {
        _id: "obs-visit-later",
        rawData: {
          data: {
            Company: "VisitUpgrade",
            CompanyID: "22222222",
            Industry: "E-Commerce",
            VisitTime: new Date("2024-06-01"),
          },
        },
      };

      jest.clearAllMocks();
      Company.findOne.mockResolvedValue(doc);
      Company.findById.mockResolvedValue(doc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await upsertCompanyFromObservation(visitObs, "visit");

      expect(doc.snapshot.name).toBe("VisitUpgrade");
      expect(doc.snapshot.industry).toBe("E-Commerce");
    });
  });

  describe("Location: full upsert lifecycle", () => {
    it("should create location from visit with parsed fields", async () => {
      const obs = {
        _id: "obs-loc",
        rawData: {
          data: {
            Location: "Austin, Texas, United States",
            VisitTime: new Date("2024-07-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "austin-texas-united-states",
        canonical_id: "loc-canonical-atx",
        aliases: [
          { type: "raw", value: "Austin, Texas, United States" },
          { type: "normalized", value: "Austin, Texas, United States" },
        ],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Austin, Texas, United States",
        parsed: {
          city: "Austin",
          state: "Texas",
          stateCode: "TX",
          country: "United States",
          countryCode: "US",
          province: null,
          region: null,
          locationType: "city_state_country",
        },
      });

      const locDoc = buildDoc({
        _id: "austin-texas-united-states",
        canonical_id: "loc-canonical-atx",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Location.findOne.mockResolvedValue(null);
      Location.create.mockResolvedValue(locDoc);
      Location.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Location.findById.mockResolvedValue(locDoc);

      const result = await upsertLocationFromObservation(obs, "visit");

      expect(result).toBeTruthy();
      expect(locDoc.snapshot.city).toBe("Austin");
      expect(locDoc.snapshot.state).toBe("Texas");
      expect(locDoc.snapshot.country).toBe("United States");
      expect(locDoc.meta.lastObservation.type).toBe("visit");
      expect(locDoc.save).toHaveBeenCalled();
    });

    it("should update location snapshot when scan arrives with new parsed data", async () => {
      resolveLocationIdentity.mockReturnValue({
        location_id: "denver-colorado-united-states",
        canonical_id: "loc-den",
        aliases: [{ type: "raw", value: "Denver, CO, US" }],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Denver, Colorado, United States",
        parsed: {
          city: "Denver Updated",
          state: "Colorado Updated",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const existingLoc = buildDoc({
        _id: "denver-colorado-united-states",
        snapshot: {
          city: "Denver",
          state: "Colorado",
          name: "Denver, Colorado, United States",
          normalized: "Denver, Colorado, United States",
        },
        observations: { visits: ["obs-v"], scans: [] },
      });

      Location.findOne.mockResolvedValue(existingLoc);
      Location.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Location.findById.mockResolvedValue(existingLoc);

      const scanObs = {
        _id: "obs-scan-loc",
        rawData: {
          data: {
            Location: "Denver, CO, US",
            ScanTime: new Date("2024-07-01"),
          },
        },
      };

      await upsertLocationFromObservation(scanObs, "scan");

      // On master, scan data can overwrite visit data (no precedence)
      expect(existingLoc.snapshot.city).toBe("Denver Updated");
      expect(existingLoc.snapshot.state).toBe("Colorado Updated");
      expect(existingLoc.save).toHaveBeenCalled();
    });
  });

  describe("Missing identity: graceful null return", () => {
    it("should return null for company without stable ID", async () => {
      resolveCompanyIdentity.mockReturnValue({
        company_id: null,
        canonical_id: null,
        aliases: [],
        source: null,
      });

      const result = await upsertCompanyFromObservation(
        { _id: "obs", rawData: { data: { Company: "NoID Corp" } } },
        "visit",
      );

      expect(result).toBeNull();
      expect(Company.findOne).not.toHaveBeenCalled();
    });

    it("should return null for location without stable ID", async () => {
      resolveLocationIdentity.mockReturnValue({
        location_id: null,
        canonical_id: null,
        aliases: [],
        source: null,
      });

      const result = await upsertLocationFromObservation(
        { _id: "obs", rawData: { data: {} } },
        "visit",
      );

      expect(result).toBeNull();
      expect(Location.findOne).not.toHaveBeenCalled();
    });
  });
});
