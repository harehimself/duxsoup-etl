jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/company", () => ({
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../src/utils/identityMatcher", () => ({
  resolveCompanyIdentity: jest.fn(),
}));

jest.mock("../../src/utils/aliasHelpers", () => ({
  dedupeAliases: jest.fn((arr) => arr),
}));

const {
  upsertCompanyFromObservation,
} = require("../../src/controllers/companyController");
const Company = require("../../src/models/company");
const { resolveCompanyIdentity } = require("../../src/utils/identityMatcher");
const { dedupeAliases } = require("../../src/utils/aliasHelpers");

/**
 * Helper: build a plain company document (simulates findOneAndUpdate return)
 */
function buildCompanyDoc(fields = {}) {
  return {
    _id: fields._id || "12345678",
    canonical_id: fields.canonical_id || "canonical-uuid",
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    ...fields,
  };
}

describe("CompanyController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe("upsertCompanyFromObservation()", () => {
    // ───────────────────────────────────────────
    // (a) New company created from observation with CompanyID
    // ───────────────────────────────────────────
    it("should create new company via atomic upsert with proper aliases", async () => {
      const observationDoc = {
        _id: "obs-1",
        rawData: {
          data: {
            Company: "Acme Inc",
            CompanyID: "12345678",
            Industry: "Technology",
            CompanyProfile: "https://linkedin.com/company/12345678",
            VisitTime: new Date("2024-06-15"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [
          { type: "numericId", value: "12345678" },
          { type: "name", value: "Acme Inc" },
        ],
        source: "numericId",
        primary_id_type: "numericId",
      });

      // Step 1: findOneAndUpdate (upsert) returns newly created doc
      const createdDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      // Step 2: findOneAndUpdate (update) returns updated doc
      const updatedDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [
          { type: "numericId", value: "12345678" },
          { type: "name", value: "Acme Inc" },
        ],
        snapshot: { name: "Acme Inc", industry: "Technology" },
        observations: { visits: ["obs-1"], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(createdDoc) // Step 1: upsert
        .mockResolvedValueOnce(updatedDoc); // Step 3: atomic update

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      // Verify step 1: atomic upsert with $setOnInsert
      expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [{ _id: "12345678" }, { canonical_id: "canonical-acme" }],
        }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            _id: "12345678",
            canonical_id: "canonical-acme",
          }),
        }),
        { upsert: true, returnDocument: "after" },
      );

      // Verify step 3: atomic update with $set + $push (capped) + $inc
      expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "12345678" },
        expect.objectContaining({
          $set: expect.objectContaining({
            "snapshot.name": "Acme Inc",
            "snapshot.industry": "Technology",
          }),
          $push: {
            "observations.visits": {
              $each: ["obs-1"],
              $slice: expect.any(Number),
            },
          },
          $inc: { "meta.observationsCount": 1 },
        }),
        { returnDocument: "after" },
      );

      expect(result).toBeTruthy();
      expect(result._id).toBe("12345678");
    });

    // ───────────────────────────────────────────
    // (b) Existing company updated
    // ───────────────────────────────────────────
    it("should update existing company snapshot and add observation atomically", async () => {
      const observationDoc = {
        _id: "obs-2",
        rawData: {
          data: {
            Company: "Acme Inc",
            CompanyID: "12345678",
            Industry: "SaaS",
            VisitTime: new Date("2024-07-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [{ type: "numericId", value: "12345678" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      // Step 1: existing doc returned from upsert (not newly created)
      const existingDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [{ type: "numericId", value: "12345678" }],
        snapshot: { name: "Acme Inc", industry: "Technology" },
        observations: { visits: ["obs-1"], scans: [] },
        meta: { observationsCount: 1 },
      });

      const updatedDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [{ type: "numericId", value: "12345678" }],
        snapshot: { name: "Acme Inc", industry: "SaaS" },
        observations: { visits: ["obs-1", "obs-2"], scans: [] },
        meta: { observationsCount: 2 },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(updatedDoc);

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      // $push (capped) in the atomic update
      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      expect(updateCall[1].$push).toEqual({
        "observations.visits": {
          $each: ["obs-2"],
          $slice: expect.any(Number),
        },
      });

      // observations count via $inc (not already linked, so +1)
      expect(updateCall[1].$inc).toEqual({ "meta.observationsCount": 1 });

      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (c) Empty values don't overwrite existing snapshot fields
    // ───────────────────────────────────────────
    it("should not overwrite existing snapshot fields with empty values", async () => {
      const observationDoc = {
        _id: "obs-3",
        rawData: {
          data: {
            Company: "", // Empty
            CompanyID: "12345678",
            Industry: null, // Null
            VisitTime: new Date("2024-07-15"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [{ type: "numericId", value: "12345678" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "12345678",
        snapshot: {
          name: "Acme Inc",
          industry: "Technology",
          _meta: {
            name: {
              value: "Acme Inc",
              observedAt: new Date("2024-06-01"),
              source: "visit",
              observationId: "obs-1",
            },
            industry: {
              value: "Technology",
              observedAt: new Date("2024-06-01"),
              source: "visit",
              observationId: "obs-1",
            },
          },
        },
        observations: { visits: ["obs-1"], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // Verify $set does NOT include snapshot.name or snapshot.industry
      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.name"]).toBeUndefined();
      expect($set["snapshot.industry"]).toBeUndefined();
    });

    // ───────────────────────────────────────────
    // (d) No separate E11000 handling needed (atomic upsert)
    // ───────────────────────────────────────────
    it("should use atomic upsert instead of separate create with E11000 catch", async () => {
      const observationDoc = {
        _id: "obs-4",
        rawData: {
          data: {
            Company: "RaceCorp",
            CompanyID: "99999999",
            VisitTime: new Date("2024-08-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "99999999",
        canonical_id: "canonical-race",
        aliases: [{ type: "numericId", value: "99999999" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const doc = buildCompanyDoc({
        _id: "99999999",
        canonical_id: "canonical-race",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      // Uses findOneAndUpdate with upsert, not separate findOne + create
      expect(Company.findOneAndUpdate.mock.calls[0][2]).toEqual(
        expect.objectContaining({ upsert: true, returnDocument: "after" }),
      );
      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (e) No stable company ID → returns null
    // ───────────────────────────────────────────
    it("should return null when no stable company ID is available", async () => {
      const observationDoc = {
        _id: "obs-5",
        rawData: {
          data: {
            Company: "Acme Inc",
            VisitTime: new Date("2024-08-15"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: null,
        canonical_id: null,
        aliases: [{ type: "name", value: "Acme Inc" }],
        source: null,
        primary_id_type: null,
      });

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      expect(result).toBeNull();
      expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (f) Provenance: _meta tracked on snapshot fields
    // ───────────────────────────────────────────
    it("should include _meta provenance in $set for newly set snapshot fields", async () => {
      const visitTime = new Date("2024-09-01");
      const observationDoc = {
        _id: "obs-prov",
        rawData: {
          data: {
            Company: "ProvCorp",
            CompanyID: "55555555",
            Industry: "Finance",
            VisitTime: visitTime,
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "55555555",
        canonical_id: "canonical-prov",
        aliases: [{ type: "numericId", value: "55555555" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const doc = buildCompanyDoc({
        _id: "55555555",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;

      expect($set["snapshot._meta.name"]).toEqual(
        expect.objectContaining({
          value: "ProvCorp",
          source: "visit",
          observationId: "obs-prov",
        }),
      );
      expect($set["snapshot._meta.industry"]).toEqual(
        expect.objectContaining({
          value: "Finance",
          source: "visit",
        }),
      );
    });

    // ───────────────────────────────────────────
    // (g) Precedence: visit beats scan for same field
    // ───────────────────────────────────────────
    it("should not let a scan overwrite a visit-sourced field", async () => {
      const observationDoc = {
        _id: "obs-scan",
        rawData: {
          data: {
            Company: "ScanCorp",
            CompanyID: "77777777",
            Industry: "Stale Industry",
            ScanTime: new Date("2024-10-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "77777777",
        canonical_id: "canonical-scan",
        aliases: [{ type: "numericId", value: "77777777" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "77777777",
        snapshot: {
          name: "VisitCorp",
          industry: "Fresh Industry",
          _meta: {
            name: {
              value: "VisitCorp",
              observedAt: new Date("2024-09-15"),
              source: "visit",
              observationId: "obs-visit",
            },
            industry: {
              value: "Fresh Industry",
              observedAt: new Date("2024-09-15"),
              source: "visit",
              observationId: "obs-visit",
            },
          },
        },
        observations: { visits: ["obs-visit"], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "scan");

      // Verify $set does NOT include snapshot.name or snapshot.industry
      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.name"]).toBeUndefined();
      expect($set["snapshot.industry"]).toBeUndefined();
    });

    // ───────────────────────────────────────────
    // (h) Precedence: visit overwrites scan-sourced field
    // ───────────────────────────────────────────
    it("should let a visit overwrite a scan-sourced field", async () => {
      const observationDoc = {
        _id: "obs-visit-new",
        rawData: {
          data: {
            Company: "VisitNewCorp",
            CompanyID: "88888888",
            Industry: "New Industry",
            VisitTime: new Date("2024-10-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "88888888",
        canonical_id: "canonical-visit-new",
        aliases: [{ type: "numericId", value: "88888888" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "88888888",
        snapshot: {
          name: "ScanOldCorp",
          industry: "Old Industry",
          _meta: {
            name: {
              value: "ScanOldCorp",
              observedAt: new Date("2024-09-01"),
              source: "scan",
              observationId: "obs-scan-old",
            },
            industry: {
              value: "Old Industry",
              observedAt: new Date("2024-09-01"),
              source: "scan",
              observationId: "obs-scan-old",
            },
          },
        },
        observations: { visits: [], scans: ["obs-scan-old"] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // Visit should overwrite scan-sourced values
      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.name"]).toBe("VisitNewCorp");
      expect($set["snapshot.industry"]).toBe("New Industry");
      expect($set["snapshot._meta.name"].source).toBe("visit");
    });

    // ───────────────────────────────────────────
    // (i) Same source: newer observation wins
    // ───────────────────────────────────────────
    it("should let newer same-source observation overwrite older one", async () => {
      const observationDoc = {
        _id: "obs-newer",
        rawData: {
          data: {
            Company: "NewerCorp",
            CompanyID: "66666666",
            VisitTime: new Date("2024-11-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "66666666",
        canonical_id: "canonical-newer",
        aliases: [{ type: "numericId", value: "66666666" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "66666666",
        snapshot: {
          name: "OlderCorp",
          _meta: {
            name: {
              value: "OlderCorp",
              observedAt: new Date("2024-10-01"),
              source: "visit",
              observationId: "obs-older",
            },
          },
        },
        observations: { visits: ["obs-older"], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.name"]).toBe("NewerCorp");
      expect($set["snapshot._meta.name"].observationId).toBe("obs-newer");
    });

    // ───────────────────────────────────────────
    // (j) Observations count computed correctly
    // ───────────────────────────────────────────
    it("should compute correct observations count for new observation", async () => {
      const observationDoc = {
        _id: "obs-count",
        rawData: {
          data: {
            Company: "CountCorp",
            CompanyID: "11111111",
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "11111111",
        canonical_id: "canonical-count",
        aliases: [{ type: "numericId", value: "11111111" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "11111111",
        observations: {
          visits: ["obs-prev-1", "obs-prev-2"],
          scans: ["obs-scan-1"],
        },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      // Not already linked, so $inc by 1
      expect(updateCall[1].$inc).toEqual({ "meta.observationsCount": 1 });
    });

    // ───────────────────────────────────────────
    // (k) HTTPS normalization: http:// website converted to https://
    // ───────────────────────────────────────────
    it("should convert http:// website to https:// during upsert", async () => {
      const observationDoc = {
        _id: "obs-https",
        rawData: {
          data: {
            Company: "HttpCorp",
            CompanyID: "44444444",
            CompanyWebsite: "http://www.httpcorp.com",
            CompanyProfile: "http://linkedin.com/company/44444444",
            VisitTime: new Date("2024-12-15"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "44444444",
        canonical_id: "canonical-https",
        aliases: [{ type: "numericId", value: "44444444" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const doc = buildCompanyDoc({
        _id: "44444444",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.website"]).toBe("https://www.httpcorp.com");
      expect($set["snapshot.companyProfileUrl"]).toBe(
        "https://linkedin.com/company/44444444",
      );
    });

    it("should preserve https:// website URLs during upsert", async () => {
      const observationDoc = {
        _id: "obs-already-https",
        rawData: {
          data: {
            Company: "SecureCorp",
            CompanyID: "33333333",
            CompanyWebsite: "https://www.securecorp.com",
            VisitTime: new Date("2024-12-15"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "33333333",
        canonical_id: "canonical-secure",
        aliases: [{ type: "numericId", value: "33333333" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const doc = buildCompanyDoc({
        _id: "33333333",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.website"]).toBe("https://www.securecorp.com");
    });

    it("should not double-count when observation already linked", async () => {
      const observationDoc = {
        _id: "obs-dup",
        rawData: {
          data: {
            Company: "DupCorp",
            CompanyID: "22222222",
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "22222222",
        canonical_id: "canonical-dup",
        aliases: [{ type: "numericId", value: "22222222" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "22222222",
        observations: { visits: ["obs-dup"], scans: [] }, // already linked
      });

      Company.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateCall = Company.findOneAndUpdate.mock.calls[1];
      // Already linked, so $inc by 0
      expect(updateCall[1].$inc).toEqual({ "meta.observationsCount": 0 });
    });
  });
});
