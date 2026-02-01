jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/models/location', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../src/utils/identityResolver', () => ({
  resolveLocationIdentity: jest.fn(),
}));

jest.mock('../../src/utils/aliasHelpers', () => ({
  dedupeAliases: jest.fn((arr) => arr),
}));

const { upsertLocationFromObservation } = require('../../src/controllers/locationController');
const Location = require('../../src/models/location');
const { resolveLocationIdentity } = require('../../src/utils/identityResolver');
const { dedupeAliases } = require('../../src/utils/aliasHelpers');

/**
 * Helper: build a mock location document
 */
function buildLocationDoc(fields = {}) {
  const doc = {
    _id: fields._id || 'san-francisco-california-united-states',
    canonical_id: fields.canonical_id || 'loc-canonical-uuid',
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    save: jest.fn().mockResolvedValue(undefined),
    ...fields,
  };
  return doc;
}

describe('LocationController', () => {
  beforeEach(() => {
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe('upsertLocationFromObservation()', () => {
    // ───────────────────────────────────────────
    // (a) New location with parsed components
    // ───────────────────────────────────────────
    it('should create new location with slugified _id and parsed city/state/country', async () => {
      const observationDoc = {
        _id: 'obs-loc-1',
        rawData: {
          data: {
            Location: 'San Francisco, California, United States',
            VisitTime: new Date('2024-06-15'),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: 'san-francisco-california-united-states',
        canonical_id: 'loc-canonical-sf',
        aliases: [
          { type: 'raw', value: 'San Francisco, California, United States' },
          { type: 'normalized', value: 'San Francisco, California, United States' },
        ],
        source: 'normalized',
        primary_id_type: 'location',
        normalized: 'San Francisco, California, United States',
        parsed: {
          city: 'San Francisco',
          state: 'California',
          stateCode: 'CA',
          country: 'United States',
          countryCode: 'US',
          province: null,
          region: null,
          locationType: 'city_state_country',
        },
      });

      // No existing location
      Location.findOne.mockResolvedValue(null);

      const createdDoc = buildLocationDoc({
        _id: 'san-francisco-california-united-states',
        canonical_id: 'loc-canonical-sf',
        snapshot: {
          name: 'San Francisco, California, United States',
          normalized: 'San Francisco, California, United States',
          city: 'San Francisco',
          state: 'California',
          stateCode: 'CA',
          country: 'United States',
          countryCode: 'US',
          province: null,
          region: null,
          locationType: 'city_state_country',
        },
      });
      Location.create.mockResolvedValue(createdDoc);
      Location.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Location.findById.mockResolvedValue(createdDoc);

      const result = await upsertLocationFromObservation(observationDoc, 'visit');

      // Location created with slugified _id
      expect(Location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: 'san-francisco-california-united-states',
          canonical_id: 'loc-canonical-sf',
        }),
      );

      // Snapshot includes parsed fields
      const createCall = Location.create.mock.calls[0][0];
      expect(createCall.snapshot.city).toBe('San Francisco');
      expect(createCall.snapshot.state).toBe('California');
      expect(createCall.snapshot.country).toBe('United States');

      expect(result).toBeTruthy();
      expect(createdDoc.save).toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (b) Existing location updated
    // ───────────────────────────────────────────
    it('should update existing location with merged aliases and linked observation', async () => {
      const observationDoc = {
        _id: 'obs-loc-2',
        rawData: {
          data: {
            Location: 'San Francisco, California, United States',
            ScanTime: new Date('2024-07-01'),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: 'san-francisco-california-united-states',
        canonical_id: 'loc-canonical-sf',
        aliases: [
          { type: 'raw', value: 'San Francisco, California, United States' },
          { type: 'normalized', value: 'San Francisco, California, United States' },
        ],
        source: 'normalized',
        primary_id_type: 'location',
        normalized: 'San Francisco, California, United States',
        parsed: {
          city: 'San Francisco',
          state: 'California',
          country: 'United States',
          locationType: 'city_state_country',
        },
      });

      const existingDoc = buildLocationDoc({
        _id: 'san-francisco-california-united-states',
        aliases: [{ type: 'raw', value: 'San Francisco, California, United States' }],
        snapshot: {
          name: 'San Francisco, California, United States',
          city: 'San Francisco',
          state: 'California',
          country: 'United States',
        },
        observations: { visits: ['obs-loc-1'], scans: [] },
        meta: { observationsCount: 1 },
      });

      Location.findOne.mockResolvedValue(existingDoc);
      Location.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const reloadedDoc = buildLocationDoc({
        ...existingDoc,
        observations: { visits: ['obs-loc-1'], scans: ['obs-loc-2'] },
      });
      Location.findById.mockResolvedValue(reloadedDoc);

      const result = await upsertLocationFromObservation(observationDoc, 'scan');

      // Observation linked via $addToSet
      expect(Location.updateOne).toHaveBeenCalledWith(
        { _id: 'san-francisco-california-united-states' },
        { $addToSet: { 'observations.scans': 'obs-loc-2' } },
      );

      // Meta updated
      expect(reloadedDoc.meta.observationsCount).toBe(2);
      expect(reloadedDoc.save).toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (c) Null/empty location → returns null
    // ───────────────────────────────────────────
    it('should return null when location value is empty', async () => {
      const observationDoc = {
        _id: 'obs-loc-3',
        rawData: {
          data: {
            // No Location field
            VisitTime: new Date('2024-08-01'),
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

      const result = await upsertLocationFromObservation(observationDoc, 'visit');

      expect(result).toBeNull();
      expect(Location.findOne).not.toHaveBeenCalled();
      expect(Location.create).not.toHaveBeenCalled();
    });

    it('should return null when location value is null', async () => {
      const observationDoc = {
        _id: 'obs-loc-4',
        rawData: {
          data: {
            Location: null,
            VisitTime: new Date('2024-08-15'),
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

      const result = await upsertLocationFromObservation(observationDoc, 'visit');

      expect(result).toBeNull();
    });

    // ───────────────────────────────────────────
    // E11000 race condition
    // ───────────────────────────────────────────
    it('should handle E11000 race condition by falling through to findById', async () => {
      const observationDoc = {
        _id: 'obs-loc-5',
        rawData: {
          data: {
            Location: 'New York, New York, United States',
            VisitTime: new Date('2024-09-01'),
          },
        },
      };

      resolveLocationIdentity.mockReturnValue({
        location_id: 'new-york-new-york-united-states',
        canonical_id: 'loc-canonical-ny',
        aliases: [
          { type: 'raw', value: 'New York, New York, United States' },
          { type: 'normalized', value: 'New York, New York, United States' },
        ],
        source: 'normalized',
        primary_id_type: 'location',
        normalized: 'New York, New York, United States',
        parsed: {
          city: 'New York',
          state: 'New York',
          country: 'United States',
          locationType: 'city_state_country',
        },
      });

      Location.findOne.mockResolvedValue(null);

      const dupError = new Error('E11000 duplicate key');
      dupError.code = 11000;
      Location.create.mockRejectedValue(dupError);

      const existingDoc = buildLocationDoc({
        _id: 'new-york-new-york-united-states',
        canonical_id: 'loc-canonical-ny',
        snapshot: { name: 'New York, New York, United States' },
        observations: { visits: [], scans: [] },
      });
      Location.findById.mockResolvedValue(existingDoc);
      Location.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await upsertLocationFromObservation(observationDoc, 'visit');

      expect(Location.findById).toHaveBeenCalledWith('new-york-new-york-united-states');
      expect(result).toBeTruthy();
      expect(existingDoc.save).toHaveBeenCalled();
    });
  });
});
