jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/location", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../src/utils/identityMatcher", () => ({
  resolveLocationIdentity: jest.fn(),
}));

jest.mock("../../src/utils/aliasHelpers", () => ({
  dedupeAliases: jest.fn((arr) => arr),
}));

const {
  upsertLocationFromObservation,
} = require("../../src/controllers/locationController");
const Location = require("../../src/models/location");
const { resolveLocationIdentity } = require("../../src/utils/identityMatcher");
const { dedupeAliases } = require("../../src/utils/aliasHelpers");

/**
 * Helper: build a mock location document
 */
function buildLocationDoc(fields = {}) {
  const doc = {
    _id: fields._id || "san-francisco-california-united-states",
    canonical_id: fields.canonical_id || "loc-canonical-uuid",
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    ...fields,
  };
  return doc;
}

describe("LocationController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe("upsertLocationFromObservation()", () => {
    // ───────────────────────────────────────────
    // (a) New location with parsed components
    // ───────────────────────────────────────────
    it("should create new location with slugified _id and parsed city/state/country", async () => {
      const observationDoc = {
        _id: "obs-loc-1",
        rawData: {
          data: {
            Location: "San Francisco, California, United States",
            VisitTime: new Date("2024-06-15"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "san-francisco-california-united-states",
        canonical_id: "loc-canonical-sf",
        aliases: [
          { type: "raw", value: "San Francisco, California, United States" },
          {
            type: "normalized",
            value: "San Francisco, California, United States",
          },
        ],
        source: "normalized",
        primary_id_type: "location",
        normalized: "San Francisco, California, United States",
        parsed: {
          city: "San Francisco",
          state: "California",
          stateCode: "CA",
          country: "United States",
          countryCode: "US",
          province: null,
          region: null,
          locationType: "city_state_country",
        },
      });

      // No existing location
      Location.findOne.mockResolvedValue(null);

      const createdDoc = buildLocationDoc({
        _id: "san-francisco-california-united-states",
        canonical_id: "loc-canonical-sf",
        snapshot: {
          name: "San Francisco, California, United States",
          normalized: "San Francisco, California, United States",
          city: "San Francisco",
          state: "California",
          stateCode: "CA",
          country: "United States",
          countryCode: "US",
          province: null,
          region: null,
          locationType: "city_state_country",
        },
      });
      Location.create.mockResolvedValue(createdDoc);

      const updatedDoc = buildLocationDoc({
        _id: "san-francisco-california-united-states",
        canonical_id: "loc-canonical-sf",
        observations: { visits: ["obs-loc-1"], scans: [] },
      });
      Location.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      // Location created with slugified _id
      expect(Location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "san-francisco-california-united-states",
          canonical_id: "loc-canonical-sf",
        }),
      );

      // Snapshot includes parsed fields
      const createCall = Location.create.mock.calls[0][0];
      expect(createCall.snapshot.city).toBe("San Francisco");
      expect(createCall.snapshot.state).toBe("California");
      expect(createCall.snapshot.country).toBe("United States");

      // Atomic update used
      expect(Location.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "san-francisco-california-united-states" },
        expect.objectContaining({
          $addToSet: { "observations.visits": "obs-loc-1" },
        }),
        { new: true },
      );

      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (b) Existing location updated
    // ───────────────────────────────────────────
    it("should update existing location with merged aliases and linked observation", async () => {
      const observationDoc = {
        _id: "obs-loc-2",
        rawData: {
          data: {
            Location: "San Francisco, California, United States",
            ScanTime: new Date("2024-07-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "san-francisco-california-united-states",
        canonical_id: "loc-canonical-sf",
        aliases: [
          { type: "raw", value: "San Francisco, California, United States" },
          {
            type: "normalized",
            value: "San Francisco, California, United States",
          },
        ],
        source: "normalized",
        primary_id_type: "location",
        normalized: "San Francisco, California, United States",
        parsed: {
          city: "San Francisco",
          state: "California",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const existingDoc = buildLocationDoc({
        _id: "san-francisco-california-united-states",
        aliases: [
          { type: "raw", value: "San Francisco, California, United States" },
        ],
        snapshot: {
          name: "San Francisco, California, United States",
          city: "San Francisco",
          state: "California",
          country: "United States",
        },
        observations: { visits: ["obs-loc-1"], scans: [] },
        meta: { observationsCount: 1 },
      });

      Location.findOne.mockResolvedValue(existingDoc);

      const updatedDoc = buildLocationDoc({
        ...existingDoc,
        observations: { visits: ["obs-loc-1"], scans: ["obs-loc-2"] },
        meta: { observationsCount: 2 },
      });
      Location.findOneAndUpdate.mockResolvedValue(updatedDoc);

      await upsertLocationFromObservation(observationDoc, "scan");

      // Observation linked via $addToSet in atomic update
      expect(Location.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "san-francisco-california-united-states" },
        expect.objectContaining({
          $addToSet: { "observations.scans": "obs-loc-2" },
          $set: expect.objectContaining({
            "meta.observationsCount": 2,
          }),
        }),
        { new: true },
      );
    });

    // ───────────────────────────────────────────
    // (c) Null/empty location → returns null
    // ───────────────────────────────────────────
    it("should return null when location value is empty", async () => {
      const observationDoc = {
        _id: "obs-loc-3",
        rawData: {
          data: {
            // No Location field
            VisitTime: new Date("2024-08-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: null,
        canonical_id: null,
        aliases: [],
        source: null,
        primary_id_type: null,
        parsed: null,
      });

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      expect(result).toBeNull();
      expect(Location.findOne).not.toHaveBeenCalled();
      expect(Location.create).not.toHaveBeenCalled();
    });

    it("should return null when location value is null", async () => {
      const observationDoc = {
        _id: "obs-loc-4",
        rawData: {
          data: {
            Location: null,
            VisitTime: new Date("2024-08-15"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: null,
        canonical_id: null,
        aliases: [],
        source: null,
        primary_id_type: null,
        parsed: null,
      });

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      expect(result).toBeNull();
    });

    // ───────────────────────────────────────────
    // E11000 race condition
    // ───────────────────────────────────────────
    it("should handle E11000 race condition by falling through to findById", async () => {
      const observationDoc = {
        _id: "obs-loc-5",
        rawData: {
          data: {
            Location: "New York, New York, United States",
            VisitTime: new Date("2024-09-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "new-york-new-york-united-states",
        canonical_id: "loc-canonical-ny",
        aliases: [
          { type: "raw", value: "New York, New York, United States" },
          { type: "normalized", value: "New York, New York, United States" },
        ],
        source: "normalized",
        primary_id_type: "location",
        normalized: "New York, New York, United States",
        parsed: {
          city: "New York",
          state: "New York",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      Location.findOne.mockResolvedValue(null);

      const dupError = new Error("E11000 duplicate key");
      dupError.code = 11000;
      Location.create.mockRejectedValue(dupError);

      const existingDoc = buildLocationDoc({
        _id: "new-york-new-york-united-states",
        canonical_id: "loc-canonical-ny",
        snapshot: { name: "New York, New York, United States" },
        observations: { visits: [], scans: [] },
      });
      Location.findById.mockResolvedValue(existingDoc);
      Location.findOneAndUpdate.mockResolvedValue(existingDoc);

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      expect(Location.findById).toHaveBeenCalledWith(
        "new-york-new-york-united-states",
      );
      expect(Location.findOneAndUpdate).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // Provenance: _meta tracked on snapshot fields
    // ───────────────────────────────────────────
    it("should store _meta provenance on newly set snapshot fields", async () => {
      const visitTime = new Date("2024-09-01");
      const observationDoc = {
        _id: "obs-prov-loc",
        rawData: {
          data: {
            Location: "Austin, Texas, United States",
            VisitTime: visitTime,
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "austin-texas-united-states",
        canonical_id: "loc-canonical-atx",
        aliases: [{ type: "raw", value: "Austin, Texas, United States" }],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Austin, Texas, United States",
        parsed: {
          city: "Austin",
          state: "Texas",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const doc = buildLocationDoc({
        _id: "austin-texas-united-states",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });
      Location.findOne.mockResolvedValue(doc);
      Location.findOneAndUpdate.mockResolvedValue(doc);

      await upsertLocationFromObservation(observationDoc, "visit");

      // Check the snapshot sent to findOneAndUpdate includes _meta provenance
      const updateArg = Location.findOneAndUpdate.mock.calls[0][1];
      const snapshot = updateArg.$set.snapshot;

      expect(snapshot._meta.city).toEqual(
        expect.objectContaining({
          value: "Austin",
          source: "visit",
          observationId: "obs-prov-loc",
        }),
      );
      expect(snapshot._meta.country).toEqual(
        expect.objectContaining({
          value: "United States",
          source: "visit",
        }),
      );
    });

    // ───────────────────────────────────────────
    // Precedence: visit beats scan
    // ───────────────────────────────────────────
    it("should not let a scan overwrite a visit-sourced field", async () => {
      const observationDoc = {
        _id: "obs-scan-loc",
        rawData: {
          data: {
            Location: "Denver, Colorado, United States",
            ScanTime: new Date("2024-10-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "denver-colorado-united-states",
        canonical_id: "loc-canonical-den",
        aliases: [{ type: "raw", value: "Denver, Colorado, United States" }],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Denver, Colorado, United States",
        parsed: {
          city: "Denver",
          state: "Colorado",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const existingDoc = buildLocationDoc({
        _id: "denver-colorado-united-states",
        snapshot: {
          city: "Denver",
          state: "Colorado",
          _meta: {
            city: {
              value: "Denver",
              observedAt: new Date("2024-09-15"),
              source: "visit",
              observationId: "obs-visit-loc",
            },
            state: {
              value: "Colorado",
              observedAt: new Date("2024-09-15"),
              source: "visit",
              observationId: "obs-visit-loc",
            },
          },
        },
        observations: { visits: ["obs-visit-loc"], scans: [] },
      });

      Location.findOne.mockResolvedValue(existingDoc);
      Location.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertLocationFromObservation(observationDoc, "scan");

      // Visit-sourced values should NOT be overwritten by scan
      const updateArg = Location.findOneAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.snapshot._meta.city.source).toBe("visit");
    });

    // ───────────────────────────────────────────
    // Legacy records: null parsed fields should not erase existing data
    // ───────────────────────────────────────────
    it("should not erase existing fields when incoming parsed value is null (legacy record without _meta)", async () => {
      const observationDoc = {
        _id: "obs-legacy-loc",
        rawData: {
          data: {
            Location: "Denver, Colorado",
            VisitTime: new Date("2024-11-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "denver-colorado",
        canonical_id: "loc-canonical-den2",
        aliases: [{ type: "raw", value: "Denver, Colorado" }],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Denver, Colorado",
        parsed: {
          city: "Denver",
          state: "Colorado",
          stateCode: null, // Parser couldn't determine stateCode
          country: null, // Parser couldn't determine country
          countryCode: null,
          province: null,
          region: null,
          locationType: "city",
        },
      });

      // Legacy record: has snapshot data but no _meta
      const existingDoc = buildLocationDoc({
        _id: "denver-colorado",
        snapshot: {
          city: "Denver",
          state: "Colorado",
          stateCode: "CO",
          country: "United States",
          countryCode: "US",
          // No _meta — legacy record created before provenance tracking
        },
        observations: { visits: [], scans: [] },
      });

      Location.findOne.mockResolvedValue(existingDoc);
      Location.findOneAndUpdate.mockResolvedValue(existingDoc);

      await upsertLocationFromObservation(observationDoc, "visit");

      const updateArg = Location.findOneAndUpdate.mock.calls[0][1];
      const snapshot = updateArg.$set.snapshot;

      // Null parsed fields should NOT erase existing values
      expect(snapshot.stateCode).toBe("CO");
      expect(snapshot.country).toBe("United States");
      expect(snapshot.countryCode).toBe("US");

      // Non-null parsed fields should be applied
      expect(snapshot.city).toBe("Denver");
      expect(snapshot.state).toBe("Colorado");
    });

    // ───────────────────────────────────────────
    // Atomic update: no separate save() call
    // ───────────────────────────────────────────
    it("should use findOneAndUpdate instead of separate updateOne+findById+save", async () => {
      const observationDoc = {
        _id: "obs-atomic-loc",
        rawData: {
          data: {
            Location: "Boston, Massachusetts, United States",
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "boston-massachusetts-united-states",
        canonical_id: "loc-canonical-bos",
        aliases: [
          { type: "raw", value: "Boston, Massachusetts, United States" },
        ],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Boston, Massachusetts, United States",
        parsed: {
          city: "Boston",
          state: "Massachusetts",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const existingDoc = buildLocationDoc({
        _id: "boston-massachusetts-united-states",
        snapshot: {},
        observations: { visits: [], scans: [] },
      });
      Location.findOne.mockResolvedValue(existingDoc);

      const updatedDoc = buildLocationDoc({
        _id: "boston-massachusetts-united-states",
        observations: { visits: ["obs-atomic-loc"], scans: [] },
      });
      Location.findOneAndUpdate.mockResolvedValue(updatedDoc);

      await upsertLocationFromObservation(observationDoc, "visit");

      // findOneAndUpdate is called with $set and $addToSet in a single operation
      expect(Location.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, opts] = Location.findOneAndUpdate.mock.calls[0];

      expect(filter).toEqual({
        _id: "boston-massachusetts-united-states",
      });
      expect(update.$set).toBeDefined();
      expect(update.$addToSet).toEqual({
        "observations.visits": "obs-atomic-loc",
      });
      expect(opts).toEqual({ new: true });

      // Verify $set includes all required fields
      expect(update.$set.aliases).toBeDefined();
      expect(update.$set.snapshot).toBeDefined();
      expect(update.$set["meta.lastObservedAt"]).toBeDefined();
      expect(update.$set["meta.lastObservation"]).toBeDefined();
      expect(update.$set["meta.observationsCount"]).toBe(1);
    });
  });
});
