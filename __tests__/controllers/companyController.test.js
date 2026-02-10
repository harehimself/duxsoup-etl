jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/company", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
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
 * Helper: build a mock company document
 */
function buildCompanyDoc(fields = {}) {
  const doc = {
    _id: fields._id || "12345678",
    canonical_id: fields.canonical_id || "canonical-uuid",
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    ...fields,
  };
  return doc;
}

describe("CompanyController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: dedupeAliases returns its input
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe("upsertCompanyFromObservation()", () => {
    // ───────────────────────────────────────────
    // (a) New company created from observation with CompanyID
    // ───────────────────────────────────────────
    it("should create new company with numeric _id and proper aliases", async () => {
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

      // No existing company
      Company.findOne.mockResolvedValue(null);

      const createdDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [
          { type: "numericId", value: "12345678" },
          { type: "name", value: "Acme Inc" },
        ],
      });
      Company.create.mockResolvedValue(createdDoc);

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
      Company.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      expect(Company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "12345678",
          canonical_id: "canonical-acme",
        }),
      );

      // Verify aliases include numericId and name
      const createCall = Company.create.mock.calls[0][0];
      expect(createCall.aliases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "numericId", value: "12345678" }),
          expect.objectContaining({ type: "name", value: "Acme Inc" }),
        ]),
      );

      // Atomic update used instead of separate updateOne + findById + save
      expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "12345678" },
        expect.objectContaining({
          $addToSet: { "observations.visits": "obs-1" },
        }),
        { new: true },
      );

      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (b) Existing company updated
    // ───────────────────────────────────────────
    it("should update existing company snapshot, add observation, and set meta atomically", async () => {
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

      const existingDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        aliases: [{ type: "numericId", value: "12345678" }],
        snapshot: { name: "Acme Inc", industry: "Technology" },
        observations: { visits: ["obs-1"], scans: [] },
        meta: { observationsCount: 1 },
      });

      Company.findOne.mockResolvedValue(existingDoc);

      const updatedDoc = buildCompanyDoc({
        _id: "12345678",
        canonical_id: "canonical-acme",
        snapshot: { name: "Acme Inc", industry: "SaaS" },
        observations: { visits: ["obs-1", "obs-2"], scans: [] },
        meta: { observationsCount: 2 },
      });
      Company.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      // Single atomic update with $set + $addToSet
      expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "12345678" },
        expect.objectContaining({
          $set: expect.objectContaining({
            "meta.observationsCount": 2,
          }),
          $addToSet: { "observations.visits": "obs-2" },
        }),
        { new: true },
      );

      // Snapshot includes updated industry
      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot.industry).toBe("SaaS");

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

      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // shouldOverwrite guard: empty string and null should not overwrite
      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot.name).toBe("Acme Inc");
      expect(updateArg.$set.snapshot.industry).toBe("Technology");
    });

    // ───────────────────────────────────────────
    // (d) E11000 race condition handled gracefully
    // ───────────────────────────────────────────
    it("should handle E11000 race condition by falling through to findById", async () => {
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

      // No existing company found initially
      Company.findOne.mockResolvedValue(null);

      // E11000 on create
      const dupError = new Error("E11000 duplicate key");
      dupError.code = 11000;
      Company.create.mockRejectedValue(dupError);

      // findById finds the existing document
      const existingDoc = buildCompanyDoc({
        _id: "99999999",
        canonical_id: "canonical-race",
        aliases: [{ type: "numericId", value: "99999999" }],
        snapshot: { name: "RaceCorp" },
        observations: { visits: [], scans: [] },
      });
      Company.findById.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      const result = await upsertCompanyFromObservation(
        observationDoc,
        "visit",
      );

      expect(Company.findById).toHaveBeenCalledWith("99999999");
      expect(Company.findOneAndUpdate).toHaveBeenCalled();
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
            // No CompanyID, no CompanyProfile with numeric ID
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
      expect(Company.findOne).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (f) Provenance: _meta tracked on snapshot fields
    // ───────────────────────────────────────────
    it("should store _meta provenance on newly set snapshot fields", async () => {
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
      Company.findOne.mockResolvedValue(doc);
      Company.findOneAndUpdate.mockResolvedValue(doc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // Check the snapshot sent to findOneAndUpdate includes _meta provenance
      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      const snapshot = updateArg.$set.snapshot;

      expect(snapshot._meta.name).toEqual(
        expect.objectContaining({
          value: "ProvCorp",
          source: "visit",
          observationId: "obs-prov",
        }),
      );
      expect(snapshot._meta.industry).toEqual(
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

      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "scan");

      // Visit-sourced values should NOT be overwritten by scan
      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot.name).toBe("VisitCorp");
      expect(updateArg.$set.snapshot.industry).toBe("Fresh Industry");
      expect(updateArg.$set.snapshot._meta.name.source).toBe("visit");
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

      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // Visit should overwrite scan-sourced values
      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot.name).toBe("VisitNewCorp");
      expect(updateArg.$set.snapshot.industry).toBe("New Industry");
      expect(updateArg.$set.snapshot._meta.name.source).toBe("visit");
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

      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot.name).toBe("NewerCorp");
      expect(updateArg.$set.snapshot._meta.name.observationId).toBe(
        "obs-newer",
      );
    });

    // ───────────────────────────────────────────
    // (j) Legacy records: null incoming should not erase existing data
    // ───────────────────────────────────────────
    it("should not erase existing fields when incoming value is null (legacy record without _meta)", async () => {
      const observationDoc = {
        _id: "obs-legacy",
        rawData: {
          data: {
            Company: null, // Null company name
            CompanyID: "33333333",
            Industry: null, // Null industry
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "33333333",
        canonical_id: "canonical-legacy",
        aliases: [{ type: "numericId", value: "33333333" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      // Legacy record: has snapshot data but no _meta
      const existingDoc = buildCompanyDoc({
        _id: "33333333",
        snapshot: {
          name: "LegacyCorp",
          industry: "Technology",
          // No _meta — legacy record created before provenance tracking
        },
        observations: { visits: [], scans: [] },
      });

      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      // Null incoming values should NOT erase existing snapshot fields
      expect(updateArg.$set.snapshot.name).toBe("LegacyCorp");
      expect(updateArg.$set.snapshot.industry).toBe("Technology");
    });

    // ───────────────────────────────────────────
    // (k) Atomic update: no separate save() call
    // ───────────────────────────────────────────
    it("should use findOneAndUpdate instead of separate updateOne+findById+save", async () => {
      const observationDoc = {
        _id: "obs-atomic",
        rawData: {
          data: {
            Company: "AtomicCorp",
            CompanyID: "11111111",
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: "11111111",
        canonical_id: "canonical-atomic",
        aliases: [{ type: "numericId", value: "11111111" }],
        source: "numericId",
        primary_id_type: "numericId",
      });

      const existingDoc = buildCompanyDoc({
        _id: "11111111",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });
      Company.findOne.mockResolvedValue(existingDoc);

      const updatedDoc = buildCompanyDoc({
        _id: "11111111",
        observations: { visits: ["obs-atomic"], scans: [] },
      });
      Company.findOneAndUpdate.mockResolvedValue(updatedDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      // findOneAndUpdate is called with $set and $addToSet in a single operation
      expect(Company.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, opts] = Company.findOneAndUpdate.mock.calls[0];

      expect(filter).toEqual({ _id: "11111111" });
      expect(update.$set).toBeDefined();
      expect(update.$addToSet).toEqual({
        "observations.visits": "obs-atomic",
      });
      expect(opts).toEqual({ new: true });

      // Verify $set includes all required fields
      expect(update.$set.aliases).toBeDefined();
      expect(update.$set.snapshot).toBeDefined();
      expect(update.$set["meta.lastObservedAt"]).toBeDefined();
      expect(update.$set["meta.lastObservation"]).toBeDefined();
      expect(update.$set["meta.observationsCount"]).toBe(1);
    });

    // ───────────────────────────────────────────
    // (l) Duplicate observation does not increment count
    // ───────────────────────────────────────────
    it("should not increment observation count for duplicate observation", async () => {
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

      // Observation already in the array
      const existingDoc = buildCompanyDoc({
        _id: "22222222",
        snapshot: {},
        observations: { visits: ["obs-dup"], scans: [] },
        meta: { observationsCount: 1 },
      });
      Company.findOne.mockResolvedValue(existingDoc);
      Company.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, "visit");

      const updateArg = Company.findOneAndUpdate.mock.calls[0][1];
      // Count should remain 1 since observation is a duplicate
      expect(updateArg.$set["meta.observationsCount"]).toBe(1);
    });
  });
});
