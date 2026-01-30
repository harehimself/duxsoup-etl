jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return {
    ...actualMongoose,
    model: jest.fn().mockReturnValue({}),
    connect: jest.fn(),
    Schema: actualMongoose.Schema,
  };
});

jest.mock('../../src/models/change', () => ({
  create: jest.fn(),
  find: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  detectChanges,
  getRecentChanges,
  getPersonChanges,
} = require('../../src/services/changeDetectionService');
const Change = require('../../src/models/change');

/**
 * Helper: chainable query mock
 */
function buildQueryMock(resolvedValue = []) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe('ChangeDetectionService', () => {
  // ───────────────────────────────────────────
  // detectChanges()
  // ───────────────────────────────────────────
  describe('detectChanges()', () => {
    const basePerson = {
      _id: 'ACwAABCDEF',
      aliases: [],
    };

    beforeEach(() => {
      Change.create.mockResolvedValue({
        _id: 'change-1',
        type: 'company_change',
      });
    });

    it('should return empty array when oldSnapshot is null (first observation)', async () => {
      const result = await detectChanges(basePerson, null, { currentCompany: 'Google' }, 'obs-1');
      expect(result).toEqual([]);
    });

    it('should detect company_change when currentCompany differs', async () => {
      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'Meta', currentTitle: 'Engineer' };

      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      expect(Change.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'company_change',
          person_id: 'ACwAABCDEF',
          from: 'Google',
          to: 'Meta',
        }),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT detect company change when companies match (case-insensitive)', async () => {
      const oldSnapshot = { currentCompany: 'Google LLC', currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'google llc', currentTitle: 'Engineer' };

      Change.create.mockClear();
      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      // No company change should be recorded
      const companyChangeCalls = Change.create.mock.calls.filter(
        (call) => call[0].type === 'company_change',
      );
      expect(companyChangeCalls).toHaveLength(0);
    });

    it('should detect promotion when title changes with seniority upgrade at same company', async () => {
      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'Google', currentTitle: 'Senior Engineer' };

      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      const promotionCall = Change.create.mock.calls.find(
        (call) => call[0].type === 'promotion',
      );
      expect(promotionCall).toBeDefined();
      expect(promotionCall[0].from).toBe('Engineer');
      expect(promotionCall[0].to).toBe('Senior Engineer');
      expect(promotionCall[0].company).toBe('Google');
    });

    it('should NOT record both promotion AND title_change for same event', async () => {
      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Manager' };
      const newSnapshot = { currentCompany: 'Google', currentTitle: 'Director' };

      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      const titleChangeCalls = Change.create.mock.calls.filter(
        (call) => call[0].type === 'title_change',
      );
      // title_change should be suppressed when promotion is detected
      expect(titleChangeCalls).toHaveLength(0);
    });

    it('should detect title_change when title changes without seniority upgrade', async () => {
      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Product Manager' };
      const newSnapshot = { currentCompany: 'Google', currentTitle: 'Program Manager' };

      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      const titleChangeCall = Change.create.mock.calls.find(
        (call) => call[0].type === 'title_change',
      );
      expect(titleChangeCall).toBeDefined();
      expect(titleChangeCall[0].from).toBe('Product Manager');
      expect(titleChangeCall[0].to).toBe('Program Manager');
    });

    it('should skip detection when company fields are null', async () => {
      const oldSnapshot = { currentCompany: null, currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };

      Change.create.mockClear();
      await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      const companyChangeCalls = Change.create.mock.calls.filter(
        (call) => call[0].type === 'company_change',
      );
      expect(companyChangeCalls).toHaveLength(0);
    });

    it('should skip title detection when title fields are null', async () => {
      const oldSnapshot = { currentCompany: 'Google', currentTitle: null };
      const newSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };

      Change.create.mockClear();
      await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      const titleCalls = Change.create.mock.calls.filter(
        (call) => call[0].type === 'title_change' || call[0].type === 'promotion',
      );
      expect(titleCalls).toHaveLength(0);
    });

    it('should handle duplicate key error (code 11000) gracefully', async () => {
      const dupError = new Error('Duplicate key');
      dupError.code = 11000;
      Change.create.mockRejectedValue(dupError);

      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'Meta', currentTitle: 'Engineer' };

      // Should not throw
      const result = await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');
      expect(result).toEqual([]);
    });

    it('should log error for non-11000 database errors', async () => {
      const logger = require('../../src/utils/logger');
      const dbError = new Error('Connection lost');
      dbError.code = 9999;
      Change.create.mockRejectedValue(dbError);

      const oldSnapshot = { currentCompany: 'Google', currentTitle: 'Engineer' };
      const newSnapshot = { currentCompany: 'Meta', currentTitle: 'Engineer' };

      await detectChanges(basePerson, oldSnapshot, newSnapshot, 'obs-1');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record'),
        expect.objectContaining({ error: 'Connection lost' }),
      );
    });
  });

  // ───────────────────────────────────────────
  // getRecentChanges()
  // ───────────────────────────────────────────
  describe('getRecentChanges()', () => {
    it('should query with type filter when provided', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getRecentChanges({ type: 'promotion', days: 7, limit: 50 });

      const query = Change.find.mock.calls[0][0];
      expect(query.type).toBe('promotion');
      expect(query.timestamp.$gte).toBeInstanceOf(Date);
      expect(queryMock.limit).toHaveBeenCalledWith(50);
    });

    it('should default to 30 days and 100 limit', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getRecentChanges();

      const query = Change.find.mock.calls[0][0];
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      expect(query.timestamp.$gte.getDate()).toBe(thirtyDaysAgo.getDate());
      expect(queryMock.limit).toHaveBeenCalledWith(100);
    });

    it('should sort by timestamp descending', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getRecentChanges();

      expect(queryMock.sort).toHaveBeenCalledWith({ timestamp: -1 });
    });

    it('should not include type filter when not provided', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getRecentChanges({ days: 10 });

      const query = Change.find.mock.calls[0][0];
      expect(query.type).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────
  // getPersonChanges()
  // ───────────────────────────────────────────
  describe('getPersonChanges()', () => {
    it('should query by person_id', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getPersonChanges('ACwAABCDEF');

      expect(Change.find).toHaveBeenCalledWith({ person_id: 'ACwAABCDEF' });
    });

    it('should sort by timestamp descending', async () => {
      const queryMock = buildQueryMock([]);
      Change.find.mockReturnValue(queryMock);

      await getPersonChanges('ACwAABCDEF');

      expect(queryMock.sort).toHaveBeenCalledWith({ timestamp: -1 });
    });

    it('should return change records', async () => {
      const mockChanges = [
        { type: 'promotion', from: 'Engineer', to: 'Senior Engineer' },
      ];
      const queryMock = buildQueryMock(mockChanges);
      Change.find.mockReturnValue(queryMock);

      const result = await getPersonChanges('person-1');

      expect(result).toEqual(mockChanges);
    });
  });
});
