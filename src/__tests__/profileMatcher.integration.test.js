/**
 * Integration Tests for Profile Matching Logic
 *
 * Tests the complete matching flow with MongoDB
 * Includes case-insensitive matching and conflict detection
 */

const Person = require('../models/person');
const {
  findMatchingProfile,
  extractAllIdentifiers,
} = require('../utils/profileMatcher');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await clearDatabase();
});

describe('findMatchingProfile - Priority 1: salesNavId', () => {
  test('Matches by salesNavId (exact case)', async () => {
    // Create existing person
    await Person.create({
      _id: 'ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
      canonical_id: 'uuid-123',
      aliases: [
        {
          type: 'salesNavId',
          value: 'ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
        },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming data with same salesNavId
    const data = {
      SalesProfile:
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId');
    expect(result.priority).toBe(1);
    expect(result.person._id).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Matches by salesNavId (CASE-INSENSITIVE: lowercase URL, uppercase DB)', async () => {
    // DB has uppercase canonical format
    await Person.create({
      _id: 'person-1',
      canonical_id: 'uuid-123',
      aliases: [
        {
          type: 'salesNavId',
          value: 'ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
        },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming data has lowercase salesNavId in URL
    const data = {
      salesUrl:
        'www.linkedin.com/sales/lead/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya,name_search,z1jy',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId');
    expect(result.priority).toBe(1);
    expect(result.person._id).toBe('person-1');
  });

  test('Matches by salesNavId (CASE-INSENSITIVE: uppercase URL, lowercase DB)', async () => {
    // DB has lowercase (unusual but possible)
    await Person.create({
      _id: 'person-2',
      canonical_id: 'uuid-456',
      aliases: [
        {
          type: 'salesNavId',
          value: 'acwaaa0cm4mba9l9zimkopy1otohmypitrlogya',
        },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming data has uppercase (canonical)
    const data = {
      SalesProfile:
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId');
    expect(result.priority).toBe(1);
    expect(result.person._id).toBe('person-2');
    expect(result.canonicalId).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Extracts salesNavId from recruiterUrl and matches', async () => {
    await Person.create({
      _id: 'person-3',
      canonical_id: 'uuid-789',
      aliases: [
        {
          type: 'salesNavId',
          value: 'ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
        },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Data has recruiterUrl (not explicit salesNavId field)
    const data = {
      recruiterUrl:
        'https://www.linkedin.com/talent/profile/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId');
    expect(result.priority).toBe(1);
  });

  test('Extracts salesNavId from profileUrl with comma params and matches', async () => {
    await Person.create({
      _id: 'person-4',
      canonical_id: 'uuid-abc',
      aliases: [
        {
          type: 'salesNavId',
          value: 'ACoAAA0CM4MBva7a2Z-_uLwWoO2swdf5ye_nV2E',
        },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      profileUrl:
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId');
    expect(result.priority).toBe(1);
  });
});

describe('findMatchingProfile - Priority 2: duxsoupId', () => {
  test('Matches by duxsoupId when no salesNavId available', async () => {
    await Person.create({
      _id: 'person-duxsoup-1',
      canonical_id: 'uuid-duxsoup',
      aliases: [
        { type: 'duxsoupId', value: 'id.218248067' },
        { type: 'linkedInUsername', value: 'kayleighhogan' },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      id: 'id.218248067',
      Profile: 'www.linkedin.com/in/kayleighhogan',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('duxsoupId');
    expect(result.priority).toBe(2);
    expect(result.person._id).toBe('person-duxsoup-1');
  });

  test('Matches by numericId extracted from duxsoupId', async () => {
    await Person.create({
      _id: 'person-numeric-1',
      canonical_id: 'uuid-numeric',
      aliases: [{ type: 'numericId', value: '228579278' }],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      id: 'id.228579278',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('numericId');
    expect(result.priority).toBe(2);
  });

  test('Prefers salesNavId over duxsoupId', async () => {
    // Person has both identifiers
    await Person.create({
      _id: 'person-both',
      canonical_id: 'uuid-both',
      aliases: [
        { type: 'salesNavId', value: 'ACwAAA123' },
        { type: 'duxsoupId', value: 'id.218248067' },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming data has both
    const data = {
      SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA123',
      id: 'id.218248067',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('salesNavId'); // Should match by salesNavId (higher priority)
    expect(result.priority).toBe(1);
  });
});

describe('findMatchingProfile - Priority 3: linkedInUsername', () => {
  test('Matches by username when no ID available', async () => {
    await Person.create({
      _id: 'person-username-1',
      canonical_id: 'uuid-username',
      aliases: [{ type: 'linkedInUsername', value: 'adrianbivens' }],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      Profile: 'www.linkedin.com/in/adrianbivens',
      id: 'pid.adrianbivens',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('linkedInUsername');
    expect(result.priority).toBe(3);
    expect(result.person._id).toBe('person-username-1');
  });

  test('CONFLICT DETECTION: Username match but different salesNavId', async () => {
    // Existing person with username + salesNavId
    await Person.create({
      _id: 'person-old',
      canonical_id: 'uuid-old',
      aliases: [
        { type: 'linkedInUsername', value: 'johndoe' },
        { type: 'salesNavId', value: 'ACwAAA111' },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming data: same username, DIFFERENT salesNavId
    const data = {
      Profile: 'www.linkedin.com/in/johndoe',
      SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA999', // Different ID!
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('username_conflict');
    expect(result.conflict).toBeDefined();
    expect(result.conflict.username).toBe('johndoe');
    expect(result.conflict.existingSalesNavId).toBe('ACwAAA111');
    expect(result.conflict.incomingSalesNavId).toBe('ACwAAA999');
  });

  test('CONFLICT DETECTION: Username match but different salesNavId (case-insensitive)', async () => {
    // Existing person with lowercase salesNavId
    await Person.create({
      _id: 'person-conflict',
      canonical_id: 'uuid-conflict',
      aliases: [
        { type: 'linkedInUsername', value: 'janedoe' },
        { type: 'salesNavId', value: 'acwaaa222' }, // Lowercase
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Incoming: same username, different salesNavId (uppercase)
    const data = {
      Profile: 'www.linkedin.com/in/janedoe',
      SalesProfile: 'www.linkedin.com/sales/lead/ACWAAA333', // Different ID
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('username_conflict');
  });

  test('NO CONFLICT: Username match with same salesNavId (case-insensitive)', async () => {
    await Person.create({
      _id: 'person-safe',
      canonical_id: 'uuid-safe',
      aliases: [
        { type: 'linkedInUsername', value: 'sarahchen' },
        { type: 'salesNavId', value: 'ACwAAA444' }, // Uppercase
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    // Same username, same salesNavId (different case)
    const data = {
      Profile: 'www.linkedin.com/in/sarahchen',
      SalesProfile: 'www.linkedin.com/sales/lead/acwaaa444', // Lowercase
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    // Should match by salesNavId (Priority 1), not username
    expect(result.matchType).toBe('salesNavId');
    expect(result.person._id).toBe('person-safe');
  });

  test('Multiple username matches - requires merge', async () => {
    // Create duplicates (shouldn't happen but test the scenario)
    await Person.create({
      _id: 'person-dup-1',
      canonical_id: 'uuid-dup-1',
      aliases: [{ type: 'linkedInUsername', value: 'duplicateuser' }],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });
    await Person.create({
      _id: 'person-dup-2',
      canonical_id: 'uuid-dup-2',
      aliases: [{ type: 'linkedInUsername', value: 'duplicateuser' }],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      Profile: 'www.linkedin.com/in/duplicateuser',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.requiresMerge).toBe(true);
    expect(result.multipleMatches).toHaveLength(2);
  });
});

describe('findMatchingProfile - Priority 4: URL-based fallback', () => {
  test('Matches by profileUrl when no stable ID available', async () => {
    await Person.create({
      _id: 'person-url-1',
      canonical_id: 'uuid-url',
      aliases: [
        { type: 'profileUrl', value: 'www.linkedin.com/in/some-profile' },
      ],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      Profile: 'https://www.linkedin.com/in/some-profile/',
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(true);
    expect(result.matchType).toBe('profileUrl');
    expect(result.priority).toBe(4);
  });

  test('No match when no identifiers match', async () => {
    await Person.create({
      _id: 'person-other',
      canonical_id: 'uuid-other',
      aliases: [{ type: 'salesNavId', value: 'ACwAAA999' }],
      snapshot: {},
      observations: { visits: [], scans: [] },
    });

    const data = {
      SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA111', // Different ID
    };

    const result = await findMatchingProfile(data);

    expect(result.match).toBe(false);
    expect(result.reason).toBe('no_stable_id_match');
    expect(result.extractedIdentifiers).toBeDefined();
  });
});

describe('extractAllIdentifiers', () => {
  test('Extracts all identifiers from complete webhook data', () => {
    const data = {
      id: 'id.218248067',
      SalesProfile:
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',
      Profile: 'www.linkedin.com/in/kayleighhogan',
      PublicProfile: 'https://www.linkedin.com/in/kayleighhogan',
    };

    const aliases = extractAllIdentifiers(data);

    expect(aliases).toContainEqual({
      type: 'salesNavId',
      value: 'ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
    });
    expect(aliases).toContainEqual({
      type: 'duxsoupId',
      value: 'id.218248067',
    });
    expect(aliases).toContainEqual({
      type: 'numericId',
      value: '218248067',
    });
    expect(aliases).toContainEqual({
      type: 'linkedInUsername',
      value: 'kayleighhogan',
    });
  });

  test('Normalizes salesNavId to canonical case', () => {
    const data = {
      salesUrl:
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk',
    };

    const aliases = extractAllIdentifiers(data);

    const salesNavAlias = aliases.find((a) => a.type === 'salesNavId');
    expect(salesNavAlias.value).toBe(
      'ACoAAA0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e',
    );
  });
});
