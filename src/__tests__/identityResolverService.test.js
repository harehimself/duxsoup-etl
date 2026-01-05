const identityResolverService = require('../services/identityResolverService');
const Person = require('../models/person');
const Merge = require('../models/merge');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');

describe('IdentityResolverService', () => {
  beforeAll(async () => {
    await connect();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('findByAnyAlias()', () => {
    it('should find person by Sales Navigator ID alias', async () => {
      // Arrange
      const person = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAABCDEF' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        ],
        snapshot: {},
      });

      const aliases = [{ type: 'salesNavId', value: 'ACwAAABCDEF' }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe(person._id);
    });

    it('should find person by numeric ID alias', async () => {
      // Arrange
      await Person.create({
        _id: '12345678',
        person_id: '12345678',
        aliases: [
          { type: 'numericId', value: '12345678' },
          { type: 'publicUrl', value: 'linkedin.com/in/janedoe' },
        ],
        snapshot: {},
      });

      const aliases = [{ type: 'numericId', value: '12345678' }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe('12345678');
    });

    it('should find person by public URL alias', async () => {
      // Arrange
      await Person.create({
        _id: 'ACwAAAXYZ',
        person_id: 'ACwAAAXYZ',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAAXYZ' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        ],
        snapshot: {},
      });

      const aliases = [{ type: 'publicUrl', value: 'linkedin.com/in/johndoe' }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].aliases).toContainEqual(
        expect.objectContaining({ type: 'publicUrl', value: 'linkedin.com/in/johndoe' })
      );
    });

    it('should find multiple people when aliases match different persons', async () => {
      // Arrange
      await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        snapshot: {},
      });

      await Person.create({
        _id: 'ACwAAAXYZ',
        person_id: 'ACwAAAXYZ',
        aliases: [{ type: 'salesNavId', value: 'ACwAAAXYZ' }],
        snapshot: {},
      });

      const aliases = [
        { type: 'salesNavId', value: 'ACwAAABCDEF' },
        { type: 'salesNavId', value: 'ACwAAAXYZ' },
      ];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(2);
    });

    it('should return empty array when no aliases match', async () => {
      // Arrange
      const aliases = [{ type: 'salesNavId', value: 'ACwAAA_NONEXISTENT' }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe('mergeAliases()', () => {
    it('should add new aliases to person without duplicates', async () => {
      // Arrange
      const person = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        snapshot: {},
      });

      const newAliases = [
        { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        { type: 'numericId', value: '12345678' },
      ];

      // Act
      const updated = await identityResolverService.mergeAliases(person, newAliases);

      // Assert
      expect(updated.aliases).toHaveLength(3);
      expect(updated.aliases).toContainEqual(
        expect.objectContaining({ type: 'publicUrl', value: 'linkedin.com/in/johndoe' })
      );
    });

    it('should not add duplicate aliases', async () => {
      // Arrange
      const person = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAABCDEF' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        ],
        snapshot: {},
      });

      const newAliases = [
        { type: 'publicUrl', value: 'linkedin.com/in/johndoe' }, // Duplicate
      ];

      // Act
      const updated = await identityResolverService.mergeAliases(person, newAliases);

      // Assert
      expect(updated.aliases).toHaveLength(2); // No new aliases added
    });
  });

  describe('determineWinner()', () => {
    it('should prefer person with Sales Navigator ID format', () => {
      // Arrange
      const personWithSalesNav = {
        _id: 'ACwAAABCDEF',
        observations: { visits: [], scans: [] },
        updatedAt: new Date('2024-01-01'),
      };

      const personWithoutSalesNav = {
        _id: '12345678',
        observations: { visits: [], scans: [] },
        updatedAt: new Date('2024-01-02'), // More recent
      };

      // Act
      const winner = identityResolverService.determineWinner([
        personWithoutSalesNav,
        personWithSalesNav,
      ]);

      // Assert
      expect(winner._id).toBe('ACwAAABCDEF');
    });

    it('should prefer person with most observations', () => {
      // Arrange
      const personWithMoreObs = {
        _id: '12345678',
        observations: { visits: ['v1', 'v2'], scans: ['s1'] },
        updatedAt: new Date('2024-01-01'),
      };

      const personWithLessObs = {
        _id: '87654321',
        observations: { visits: ['v1'], scans: [] },
        updatedAt: new Date('2024-01-02'),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        personWithLessObs,
        personWithMoreObs,
      ]);

      // Assert
      expect(winner._id).toBe('12345678');
    });

    it('should prefer most recently updated when observations equal', () => {
      // Arrange
      const olderPerson = {
        _id: '12345678',
        observations: { visits: ['v1'], scans: [] },
        updatedAt: new Date('2024-01-01'),
      };

      const newerPerson = {
        _id: '87654321',
        observations: { visits: ['v1'], scans: [] },
        updatedAt: new Date('2024-01-15'),
      };

      // Act
      const winner = identityResolverService.determineWinner([olderPerson, newerPerson]);

      // Assert
      expect(winner._id).toBe('87654321');
    });

    it('should use lexical tie-breaker when all else equal', () => {
      // Arrange
      const personA = {
        _id: 'linkedin.com/in/b-person',
        observations: { visits: [], scans: [] },
        updatedAt: new Date('2024-01-01'),
      };

      const personB = {
        _id: 'linkedin.com/in/a-person',
        observations: { visits: [], scans: [] },
        updatedAt: new Date('2024-01-01'),
      };

      // Act
      const winner = identityResolverService.determineWinner([personA, personB]);

      // Assert
      expect(winner._id).toBe('linkedin.com/in/a-person');
    });
  });

  describe('mergePeople()', () => {
    it('should merge two people and create audit record', async () => {
      // Arrange
      const winner = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        snapshot: { fullName: 'John Doe' },
        observations: { visits: [], scans: [] },
      });

      const loser = await Person.create({
        _id: 'linkedin.com/in/johndoe',
        person_id: 'linkedin.com/in/johndoe',
        aliases: [{ type: 'publicUrl', value: 'linkedin.com/in/johndoe' }],
        snapshot: { fullName: 'John Doe' },
        observations: { visits: [], scans: [] },
      });

      // Act
      const result = await identityResolverService.mergePeople(winner, [loser], {
        reason: 'alias_conflict',
      });

      // Assert
      expect(result._id).toBe('ACwAAABCDEF');
      expect(result.aliases).toHaveLength(2);

      // Verify loser was deleted
      const deletedPerson = await Person.findById('linkedin.com/in/johndoe');
      expect(deletedPerson).toBeNull();

      // Verify audit record
      const mergeRecord = await Merge.findOne({ winner_id: 'ACwAAABCDEF' });
      expect(mergeRecord).toBeTruthy();
      expect(mergeRecord.loser_ids).toContain('linkedin.com/in/johndoe');
    });

    it('should combine observations from all merged people', async () => {
      // Arrange
      const winner = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        snapshot: {},
        observations: { visits: ['visit1'], scans: ['scan1'] },
      });

      const loser = await Person.create({
        _id: '12345678',
        person_id: '12345678',
        aliases: [{ type: 'numericId', value: '12345678' }],
        snapshot: {},
        observations: { visits: ['visit2'], scans: ['scan2'] },
      });

      // Act
      const result = await identityResolverService.mergePeople(winner, [loser]);

      // Assert
      expect(result.observations.visits).toHaveLength(2);
      expect(result.observations.scans).toHaveLength(2);
      expect(result.observations.visits).toContain('visit1');
      expect(result.observations.visits).toContain('visit2');
    });
  });

  describe('resolveOrCreate()', () => {
    it('should return existing person when exact _id matches', async () => {
      // Arrange
      const existing = await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        snapshot: {},
      });

      const identity = {
        person_id: 'ACwAAABCDEF',
        aliases: [{ type: 'salesNavId', value: 'ACwAAABCDEF' }],
        source: 'salesNavId',
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert
      expect(result._id).toBe(existing._id);
    });

    it('should create new person when no matches found', async () => {
      // Arrange
      const identity = {
        person_id: 'ACwAAANEW',
        aliases: [{ type: 'salesNavId', value: 'ACwAAANEW' }],
        source: 'salesNavId',
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert
      expect(result._id).toBe('ACwAAANEW');
      expect(result.aliases).toHaveLength(1);

      // Verify it was saved to DB
      const saved = await Person.findById('ACwAAANEW');
      expect(saved).toBeTruthy();
    });

    it('should merge when multiple people share an alias', async () => {
      // Arrange: Two people with different primary IDs but overlapping aliases
      await Person.create({
        _id: 'ACwAAABCDEF',
        person_id: 'ACwAAABCDEF',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAABCDEF' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        ],
        snapshot: {},
        observations: { visits: ['v1'], scans: [] },
        updatedAt: new Date('2024-01-15'),
      });

      await Person.create({
        _id: '12345678',
        person_id: '12345678',
        aliases: [
          { type: 'numericId', value: '12345678' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' }, // Same public URL!
        ],
        snapshot: {},
        observations: { visits: [], scans: [] },
        updatedAt: new Date('2024-01-01'),
      });

      const identity = {
        person_id: 'linkedin.com/in/johndoe',
        aliases: [{ type: 'publicUrl', value: 'linkedin.com/in/johndoe' }],
        source: 'publicUrl',
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert: Winner should be ACwAAABCDEF (Sales Nav ID preferred)
      expect(result._id).toBe('ACwAAABCDEF');

      // Verify only one person exists now
      const allPeople = await Person.find({});
      expect(allPeople).toHaveLength(1);

      // Verify merge audit record
      const mergeRecord = await Merge.findOne({ winner_id: 'ACwAAABCDEF' });
      expect(mergeRecord).toBeTruthy();
      expect(mergeRecord.loser_ids).toContain('12345678');
    });
  });
});
