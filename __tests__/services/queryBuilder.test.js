jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return {
    ...actualMongoose,
    model: jest.fn().mockReturnValue({}),
    connect: jest.fn(),
    Schema: actualMongoose.Schema,
  };
});

jest.mock('../../src/models/person', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  queryPeople,
  queryCompanies,
  buildSeniorityFilter,
  buildConnectionsFilter,
} = require('../../src/services/queryBuilder');
const Person = require('../../src/models/person');

/**
 * Helper: chainable query mock
 */
function buildQueryMock(resolvedValue = []) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe('QueryBuilder', () => {
  // ───────────────────────────────────────────
  // queryPeople()
  // ───────────────────────────────────────────
  describe('queryPeople()', () => {
    it('should execute query with validated filters', async () => {
      const mockDocs = [{ _id: 'p1' }, { _id: 'p2' }];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(2);

      const result = await queryPeople({
        filters: { 'snapshot.currentCompany': 'Google' },
      });

      expect(Person.find).toHaveBeenCalledWith(
        expect.objectContaining({ 'snapshot.currentCompany': 'Google' }),
      );
      expect(result.results).toEqual(mockDocs);
      expect(result.metadata.count).toBe(2);
      expect(result.metadata.totalCount).toBe(2);
    });

    it('should apply custom sort when provided', async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await queryPeople({
        filters: {},
        sort: { 'snapshot.connections': -1 },
      });

      expect(queryMock.sort).toHaveBeenCalledWith({ 'snapshot.connections': -1 });
    });

    it('should default to meta.lastObservedAt sort when no sort provided', async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await queryPeople({ filters: {} });

      expect(queryMock.sort).toHaveBeenCalledWith({ 'meta.lastObservedAt': -1 });
    });

    it('should apply skip and limit', async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await queryPeople({ filters: {}, skip: 10, limit: 25 });

      expect(queryMock.skip).toHaveBeenCalledWith(10);
      expect(queryMock.limit).toHaveBeenCalledWith(25);
    });

    it('should set hasMore=true and nextSkip when more results exist', async () => {
      const queryMock = buildQueryMock([{ _id: 'p1' }]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(50);

      const result = await queryPeople({ filters: {}, skip: 0, limit: 1 });

      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.nextSkip).toBe(1);
    });

    it('should set hasMore=false when results are exhausted', async () => {
      const queryMock = buildQueryMock([{ _id: 'p1' }]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(1);

      const result = await queryPeople({ filters: {}, skip: 0, limit: 10 });

      expect(result.metadata.hasMore).toBe(false);
      expect(result.metadata.nextSkip).toBeNull();
    });

    it('should apply field projection when fields param provided', async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await queryPeople({
        filters: {},
        fields: ['snapshot.fullName', 'snapshot.currentTitle'],
      });

      expect(queryMock.select).toHaveBeenCalledWith('snapshot.fullName snapshot.currentTitle');
    });
  });

  // ───────────────────────────────────────────
  // queryCompanies()
  // ───────────────────────────────────────────
  describe('queryCompanies()', () => {
    it('should build aggregation pipeline and return results', async () => {
      const mockResults = [
        { companyName: 'Google', employeeCount: 5, employees: [] },
      ];
      Person.aggregate.mockResolvedValue(mockResults);

      const result = await queryCompanies({ filters: {}, limit: 100 });

      expect(Person.aggregate).toHaveBeenCalled();
      expect(result.results).toEqual(mockResults);
      expect(result.metadata.count).toBe(1);
    });

    it('should include $match stage when filters provided', async () => {
      Person.aggregate.mockResolvedValue([]);

      await queryCompanies({
        filters: { 'snapshot.industry': 'Technology' },
        limit: 50,
      });

      const pipeline = Person.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({ $match: { 'snapshot.industry': 'Technology' } });
    });

    it('should not include $match when filters are empty', async () => {
      Person.aggregate.mockResolvedValue([]);

      await queryCompanies({ filters: {}, limit: 10 });

      const pipeline = Person.aggregate.mock.calls[0][0];
      // First stage should be $group, not $match
      expect(pipeline[0]).toHaveProperty('$group');
    });

    it('should limit employee list to 10 in projection', async () => {
      Person.aggregate.mockResolvedValue([]);

      await queryCompanies({ filters: {} });

      const pipeline = Person.aggregate.mock.calls[0][0];
      const projectStage = pipeline.find((s) => s.$project);
      expect(projectStage.$project.employees).toEqual({ $slice: ['$employees', 10] });
    });

    it('should sort by employeeCount descending', async () => {
      Person.aggregate.mockResolvedValue([]);

      await queryCompanies({ filters: {} });

      const pipeline = Person.aggregate.mock.calls[0][0];
      const sortStage = pipeline.find((s) => s.$sort);
      expect(sortStage.$sort).toEqual({ employeeCount: -1 });
    });
  });

  // ───────────────────────────────────────────
  // buildSeniorityFilter()
  // ───────────────────────────────────────────
  describe('buildSeniorityFilter()', () => {
    it('should return regex filter for c-level', () => {
      const filter = buildSeniorityFilter('c-level');
      expect(filter['snapshot.currentTitle'].$regex).toContain('Chief');
      expect(filter['snapshot.currentTitle'].$options).toBe('i');
    });

    it('should return regex filter for vp', () => {
      const filter = buildSeniorityFilter('vp');
      expect(filter['snapshot.currentTitle'].$regex).toContain('VP');
    });

    it('should return regex filter for director', () => {
      const filter = buildSeniorityFilter('director');
      expect(filter['snapshot.currentTitle'].$regex).toContain('Director');
    });

    it('should return regex filter for senior', () => {
      const filter = buildSeniorityFilter('senior');
      expect(filter['snapshot.currentTitle'].$regex).toContain('Senior');
    });

    it('should return regex filter for manager', () => {
      const filter = buildSeniorityFilter('manager');
      expect(filter['snapshot.currentTitle'].$regex).toContain('Manager');
    });

    it('should return regex filter for individual', () => {
      const filter = buildSeniorityFilter('individual');
      expect(filter['snapshot.currentTitle'].$regex).toContain('Engineer');
    });

    it('should be case-insensitive for level input', () => {
      const filter = buildSeniorityFilter('VP');
      expect(filter['snapshot.currentTitle'].$regex).toContain('VP');
    });

    it('should throw for invalid seniority level', () => {
      expect(() => buildSeniorityFilter('intern')).toThrow('Invalid seniority level');
    });
  });

  // ───────────────────────────────────────────
  // buildConnectionsFilter()
  // ───────────────────────────────────────────
  describe('buildConnectionsFilter()', () => {
    it('should return $gte: 1000 for influencer', () => {
      const filter = buildConnectionsFilter('influencer');
      expect(filter['snapshot.connections']).toEqual({ $gte: 1000 });
    });

    it('should return range 500-1000 for well-connected', () => {
      const filter = buildConnectionsFilter('well-connected');
      expect(filter['snapshot.connections']).toEqual({ $gte: 500, $lt: 1000 });
    });

    it('should return range 100-500 for connected', () => {
      const filter = buildConnectionsFilter('connected');
      expect(filter['snapshot.connections']).toEqual({ $gte: 100, $lt: 500 });
    });

    it('should return $lt: 100 for new', () => {
      const filter = buildConnectionsFilter('new');
      expect(filter['snapshot.connections']).toEqual({ $lt: 100 });
    });

    it('should throw for invalid range', () => {
      expect(() => buildConnectionsFilter('mega')).toThrow('Invalid connections range');
    });
  });
});
