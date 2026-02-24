jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/location", () => ({
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
 * Helper: build a plain location document (simulates findOneAndUpdate return)
 */
function buildLocationDoc(fields = {}) {
  return {
    _id: fields._id || "san-francisco-california-united-states",
    canonical_id: fields.canonical_id || "loc-canonical-uuid",
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    ...fields,
  };
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
    it("should create new location via atomic upsert with parsed city/state/country", async () => {
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

      // Step 1: newly created doc from atomic upsert
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
        observations: { visits: [], scans: [] },
      });

      // Step 3: updated doc
      const updatedDoc = buildLocationDoc({
        ...createdDoc,
        observations: { visits: ["obs-loc-1"], scans: [] },
      });

      Location.findOneAndUpdate
        .mockResolvedValueOnce(createdDoc)
        .mockResolvedValueOnce(updatedDoc);

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      // Verify step 1: atomic upsert with $setOnInsert including parsed snapshot
      expect(Location.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [
            { _id: "san-francisco-california-united-states" },
            { canonical_id: "loc-canonical-sf" },
          ],
        }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            _id: "san-francisco-california-united-states",
            canonical_id: "loc-canonical-sf",
            snapshot: expect.objectContaining({
              city: "San Francisco",
              state: "California",
              country: "United States",
            }),
          }),
        }),
        { upsert: true, returnDocument: "after" },
      );

      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (b) Existing location updated
    // ───────────────────────────────────────────
    it("should update existing location with merged aliases and linked observation atomically", async () => {
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

      const updatedDoc = buildLocationDoc({
        ...existingDoc,
        observations: { visits: ["obs-loc-1"], scans: ["obs-loc-2"] },
        meta: { observationsCount: 2 },
      });

      Location.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(updatedDoc);

      const result = await upsertLocationFromObservation(
        observationDoc,
        "scan",
      );

      // Observation linked via $push (capped) in atomic update
      const updateCall = Location.findOneAndUpdate.mock.calls[1];
      expect(updateCall[1].$push).toEqual({
        "observations.scans": {
          $each: ["obs-loc-2"],
          $slice: expect.any(Number),
        },
      });

      // observations count via $inc (not already linked, so +1)
      expect(updateCall[1].$inc).toEqual({ "meta.observationsCount": 1 });

      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // (c) Null/empty location → returns null
    // ───────────────────────────────────────────
    it("should return null when location value is empty", async () => {
      const observationDoc = {
        _id: "obs-loc-3",
        rawData: {
          data: {
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
      expect(Location.findOneAndUpdate).not.toHaveBeenCalled();
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
    // E11000 handled by atomic upsert
    // ───────────────────────────────────────────
    it("should use atomic upsert instead of separate create with E11000 catch", async () => {
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

      const doc = buildLocationDoc({
        _id: "new-york-new-york-united-states",
        canonical_id: "loc-canonical-ny",
        snapshot: { name: "New York, New York, United States" },
        observations: { visits: [], scans: [] },
      });

      Location.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      const result = await upsertLocationFromObservation(
        observationDoc,
        "visit",
      );

      // Uses findOneAndUpdate with upsert, not separate findOne + create
      expect(Location.findOneAndUpdate.mock.calls[0][2]).toEqual(
        expect.objectContaining({ upsert: true, returnDocument: "after" }),
      );
      expect(result).toBeTruthy();
    });

    // ───────────────────────────────────────────
    // Provenance: _meta tracked on snapshot fields
    // ───────────────────────────────────────────
    it("should include _meta provenance in $set for newly set snapshot fields", async () => {
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

      Location.findOneAndUpdate
        .mockResolvedValueOnce(doc)
        .mockResolvedValueOnce(doc);

      await upsertLocationFromObservation(observationDoc, "visit");

      const updateCall = Location.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;

      expect($set["snapshot._meta.city"]).toEqual(
        expect.objectContaining({
          value: "Austin",
          source: "visit",
          observationId: "obs-prov-loc",
        }),
      );
      expect($set["snapshot._meta.country"]).toEqual(
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

      Location.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertLocationFromObservation(observationDoc, "scan");

      // Visit-sourced values should NOT be overwritten by scan
      const updateCall = Location.findOneAndUpdate.mock.calls[1];
      const $set = updateCall[1].$set;
      expect($set["snapshot.city"]).toBeUndefined();
      expect($set["snapshot.state"]).toBeUndefined();
    });

    // ───────────────────────────────────────────
    // Observations count computed correctly
    // ───────────────────────────────────────────
    it("should compute correct observations count for new observation", async () => {
      const observationDoc = {
        _id: "obs-count-loc",
        rawData: {
          data: {
            Location: "Seattle, Washington, United States",
            VisitTime: new Date("2024-12-01"),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: "seattle-washington-united-states",
        canonical_id: "loc-canonical-sea",
        aliases: [{ type: "raw", value: "Seattle, Washington, United States" }],
        source: "normalized",
        primary_id_type: "location",
        normalized: "Seattle, Washington, United States",
        parsed: {
          city: "Seattle",
          state: "Washington",
          country: "United States",
          locationType: "city_state_country",
        },
      });

      const existingDoc = buildLocationDoc({
        _id: "seattle-washington-united-states",
        observations: { visits: ["obs-a"], scans: ["obs-b", "obs-c"] },
      });

      Location.findOneAndUpdate
        .mockResolvedValueOnce(existingDoc)
        .mockResolvedValueOnce(existingDoc);

      await upsertLocationFromObservation(observationDoc, "visit");

      const updateCall = Location.findOneAndUpdate.mock.calls[1];
      // Not already linked, so $inc by 1
      expect(updateCall[1].$inc).toEqual({ "meta.observationsCount": 1 });
    });
  });
});
