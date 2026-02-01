jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../src/models/company', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../src/utils/identityResolver', () => ({
  resolveCompanyIdentity: jest.fn(),
}));

jest.mock('../../src/utils/aliasHelpers', () => ({
  dedupeAliases: jest.fn((arr) => arr),
}));

const { upsertCompanyFromObservation } = require('../../src/controllers/companyController');
const Company = require('../../src/models/company');
const { resolveCompanyIdentity } = require('../../src/utils/identityResolver');
const { dedupeAliases } = require('../../src/utils/aliasHelpers');

/**
 * Helper: build a mock company document with save() and Mongoose-like behavior
 */
function buildCompanyDoc(fields = {}) {
  const doc = {
    _id: fields._id || '12345678',
    canonical_id: fields.canonical_id || 'canonical-uuid',
    aliases: fields.aliases || [],
    snapshot: fields.snapshot || {},
    observations: fields.observations || { visits: [], scans: [] },
    meta: fields.meta || {},
    save: jest.fn().mockResolvedValue(undefined),
    ...fields,
  };
  return doc;
}

describe('CompanyController', () => {
  beforeEach(() => {
    // Default: dedupeAliases returns its input
    dedupeAliases.mockImplementation((arr) => arr);
  });

  describe('upsertCompanyFromObservation()', () => {
    // ───────────────────────────────────────────
    // (a) New company created from observation with CompanyID
    // ───────────────────────────────────────────
    it('should create new company with numeric _id and proper aliases', async () => {
      const observationDoc = {
        _id: 'obs-1',
        rawData: {
          data: {
            Company: 'Acme Inc',
            CompanyID: '12345678',
            Industry: 'Technology',
            CompanyProfile: 'https://linkedin.com/company/12345678',
            VisitTime: new Date('2024-06-15'),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: '12345678',
        canonical_id: 'canonical-acme',
        aliases: [
          { type: 'numericId', value: '12345678' },
          { type: 'name', value: 'Acme Inc' },
        ],
        source: 'numericId',
        primary_id_type: 'numericId',
      });

      // No existing company
      Company.findOne.mockResolvedValue(null);

      const createdDoc = buildCompanyDoc({
        _id: '12345678',
        canonical_id: 'canonical-acme',
        aliases: [
          { type: 'numericId', value: '12345678' },
          { type: 'name', value: 'Acme Inc' },
        ],
      });
      Company.create.mockResolvedValue(createdDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Company.findById.mockResolvedValue(createdDoc);

      const result = await upsertCompanyFromObservation(observationDoc, 'visit');

      expect(Company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: '12345678',
          canonical_id: 'canonical-acme',
        }),
      );

      // Verify aliases include numericId and name
      const createCall = Company.create.mock.calls[0][0];
      expect(createCall.aliases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'numericId', value: '12345678' }),
          expect.objectContaining({ type: 'name', value: 'Acme Inc' }),
        ]),
      );

      expect(result).toBeTruthy();
      expect(createdDoc.save).toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (b) Existing company updated
    // ───────────────────────────────────────────
    it('should update existing company snapshot, add observation, and increment meta', async () => {
      const observationDoc = {
        _id: 'obs-2',
        rawData: {
          data: {
            Company: 'Acme Inc',
            CompanyID: '12345678',
            Industry: 'SaaS',
            VisitTime: new Date('2024-07-01'),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: '12345678',
        canonical_id: 'canonical-acme',
        aliases: [{ type: 'numericId', value: '12345678' }],
        source: 'numericId',
        primary_id_type: 'numericId',
      });

      const existingDoc = buildCompanyDoc({
        _id: '12345678',
        canonical_id: 'canonical-acme',
        aliases: [{ type: 'numericId', value: '12345678' }],
        snapshot: { name: 'Acme Inc', industry: 'Technology' },
        observations: { visits: ['obs-1'], scans: [] },
        meta: { observationsCount: 1 },
      });

      Company.findOne.mockResolvedValue(existingDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });

      // After reload, observations array has the new observation
      const reloadedDoc = buildCompanyDoc({
        ...existingDoc,
        observations: { visits: ['obs-1', 'obs-2'], scans: [] },
      });
      Company.findById.mockResolvedValue(reloadedDoc);

      const result = await upsertCompanyFromObservation(observationDoc, 'visit');

      // $addToSet used for atomic observation reference
      expect(Company.updateOne).toHaveBeenCalledWith(
        { _id: '12345678' },
        { $addToSet: { 'observations.visits': 'obs-2' } },
      );

      // Snapshot updated
      expect(reloadedDoc.snapshot.industry).toBe('SaaS');

      // Meta updated
      expect(reloadedDoc.meta.observationsCount).toBe(2);
      expect(reloadedDoc.save).toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (c) Empty values don't overwrite existing snapshot fields
    // ───────────────────────────────────────────
    it('should not overwrite existing snapshot fields with empty values', async () => {
      const observationDoc = {
        _id: 'obs-3',
        rawData: {
          data: {
            Company: '', // Empty
            CompanyID: '12345678',
            Industry: null, // Null
            VisitTime: new Date('2024-07-15'),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: '12345678',
        canonical_id: 'canonical-acme',
        aliases: [{ type: 'numericId', value: '12345678' }],
        source: 'numericId',
        primary_id_type: 'numericId',
      });

      const existingDoc = buildCompanyDoc({
        _id: '12345678',
        snapshot: { name: 'Acme Inc', industry: 'Technology' },
        observations: { visits: ['obs-1'], scans: [] },
      });

      Company.findOne.mockResolvedValue(existingDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });
      Company.findById.mockResolvedValue(existingDoc);

      await upsertCompanyFromObservation(observationDoc, 'visit');

      // applySnapshotValue guard: empty string and null should not overwrite
      expect(existingDoc.snapshot.name).toBe('Acme Inc');
      expect(existingDoc.snapshot.industry).toBe('Technology');
    });

    // ───────────────────────────────────────────
    // (d) E11000 race condition handled gracefully
    // ───────────────────────────────────────────
    it('should handle E11000 race condition by falling through to findById', async () => {
      const observationDoc = {
        _id: 'obs-4',
        rawData: {
          data: {
            Company: 'RaceCorp',
            CompanyID: '99999999',
            VisitTime: new Date('2024-08-01'),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: '99999999',
        canonical_id: 'canonical-race',
        aliases: [{ type: 'numericId', value: '99999999' }],
        source: 'numericId',
        primary_id_type: 'numericId',
      });

      // No existing company found initially
      Company.findOne.mockResolvedValue(null);

      // E11000 on create
      const dupError = new Error('E11000 duplicate key');
      dupError.code = 11000;
      Company.create.mockRejectedValue(dupError);

      // findById finds the existing document
      const existingDoc = buildCompanyDoc({
        _id: '99999999',
        canonical_id: 'canonical-race',
        aliases: [{ type: 'numericId', value: '99999999' }],
        snapshot: { name: 'RaceCorp' },
        observations: { visits: [], scans: [] },
      });
      Company.findById.mockResolvedValue(existingDoc);
      Company.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await upsertCompanyFromObservation(observationDoc, 'visit');

      expect(Company.findById).toHaveBeenCalledWith('99999999');
      expect(result).toBeTruthy();
      expect(existingDoc.save).toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (e) No stable company ID → returns null
    // ───────────────────────────────────────────
    it('should return null when no stable company ID is available', async () => {
      const observationDoc = {
        _id: 'obs-5',
        rawData: {
          data: {
            Company: 'Acme Inc',
            // No CompanyID, no CompanyProfile with numeric ID
            VisitTime: new Date('2024-08-15'),
          },
        },
      };

      resolveCompanyIdentity.mockReturnValue({
        company_id: null,
        canonical_id: null,
        aliases: [{ type: 'name', value: 'Acme Inc' }],
        source: null,
        primary_id_type: null,
      });

      const result = await upsertCompanyFromObservation(observationDoc, 'visit');

      expect(result).toBeNull();
      expect(Company.findOne).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });
  });
});
