jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  extractIdentifiers,
  getPrimaryIdentifier,
  isSamePerson,
} = require('../../src/utils/identityMatcher');
const { resolvePersonIdentity } = require('../../src/utils/identityResolver');
const fixtures = require('../fixtures/webhookPayloads');

describe('Identity Resolution (fixture-based)', () => {
  // ───────────────────────────────────────────
  // extractIdentifiers + getPrimaryIdentifier on each fixture
  // ───────────────────────────────────────────
  describe('extractIdentifiers()', () => {
    it('should extract salesNavId from visitWithSalesNav fixture', () => {
      const identifiers = extractIdentifiers(fixtures.visitWithSalesNav.data);

      expect(identifiers.salesNavId).toBe('ACwAAALwVAIBtest123');
      expect(identifiers.linkedInUsername).toBe('mike-hare');
      expect(identifiers.vanityName).toBe('mike-hare');
      expect(identifiers.duxsoupId).toBe('pid.mike-hare');
    });

    it('should extract linkedInUsername from scanWithProfileOnly fixture', () => {
      const identifiers = extractIdentifiers(fixtures.scanWithProfileOnly.data);

      expect(identifiers.salesNavId).toBeNull();
      expect(identifiers.linkedInUsername).toBe('mike-hare');
      expect(identifiers.vanityName).toBe('mike-hare');
      expect(identifiers.duxsoupId).toBe('pid.mike-hare');
    });

    it('should extract numericId from visitWithNumericId fixture', () => {
      const identifiers = extractIdentifiers(fixtures.visitWithNumericId.data);

      expect(identifiers.salesNavId).toBe('ACoAAABE0YMBexample456');
      expect(identifiers.linkedInUsername).toBe('jane-smith-99887766');
      expect(identifiers.duxsoupId).toBe('12345678');
    });

    it('should extract username from scanWithDuxsoupPid fixture', () => {
      const identifiers = extractIdentifiers(fixtures.scanWithDuxsoupPid.data);

      expect(identifiers.linkedInUsername).toBe('mike-hare');
      expect(identifiers.duxsoupId).toBe('pid.mike-hare');
    });
  });

  describe('getPrimaryIdentifier()', () => {
    it('should prioritize salesNavId for visitWithSalesNav', () => {
      const identifiers = extractIdentifiers(fixtures.visitWithSalesNav.data);
      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe('salesNavId');
      expect(primary.value).toBe('ACwAAALwVAIBtest123');
    });

    it('should use linkedInUsername for scanWithProfileOnly (no salesNavId)', () => {
      const identifiers = extractIdentifiers(fixtures.scanWithProfileOnly.data);
      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe('linkedInUsername');
      expect(primary.value).toBe('mike-hare');
    });

    it('should use salesNavId for visitWithNumericId', () => {
      const identifiers = extractIdentifiers(fixtures.visitWithNumericId.data);
      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe('salesNavId');
    });
  });

  // ───────────────────────────────────────────
  // Same-person fixtures produce overlapping aliases
  // ───────────────────────────────────────────
  describe('alias overlap for same-person fixtures', () => {
    it('should have overlapping alias values between visitWithSalesNav and scanWithProfileOnly', () => {
      const visitIds = extractIdentifiers(fixtures.visitWithSalesNav.data);
      const scanIds = extractIdentifiers(fixtures.scanWithProfileOnly.data);

      // Collect all non-null identifier values into sets
      const visitValues = new Set(Object.values(visitIds).filter(Boolean));
      const scanValues = new Set(Object.values(scanIds).filter(Boolean));

      // At least one alias value should overlap (linkedInUsername, vanityName, duxsoupId, or profileUrl)
      const overlap = [...visitValues].filter((v) => scanValues.has(v));
      expect(overlap.length).toBeGreaterThan(0);
    });

    it('should have overlapping alias values between visitWithSalesNav and scanWithDuxsoupPid', () => {
      const visitIds = extractIdentifiers(fixtures.visitWithSalesNav.data);
      const scanIds = extractIdentifiers(fixtures.scanWithDuxsoupPid.data);

      const visitValues = new Set(Object.values(visitIds).filter(Boolean));
      const scanValues = new Set(Object.values(scanIds).filter(Boolean));

      const overlap = [...visitValues].filter((v) => scanValues.has(v));
      expect(overlap.length).toBeGreaterThan(0);
    });

    it('should have overlapping alias values between scanWithProfileOnly and scanWithSalesNav', () => {
      const ids1 = extractIdentifiers(fixtures.scanWithProfileOnly.data);
      const ids2 = extractIdentifiers(fixtures.scanWithSalesNav.data);

      const values1 = new Set(Object.values(ids1).filter(Boolean));
      const values2 = new Set(Object.values(ids2).filter(Boolean));

      const overlap = [...values1].filter((v) => values2.has(v));
      expect(overlap.length).toBeGreaterThan(0);
    });

    it('should NOT have overlapping alias values between Mike Hare and Jane Smith fixtures', () => {
      const mikeIds = extractIdentifiers(fixtures.visitWithSalesNav.data);
      const janeIds = extractIdentifiers(fixtures.visitWithNumericId.data);

      // These are different people — shared values should be empty
      // (except possibly generic things like profileUrl domain, but real IDs should differ)
      const mikeValues = new Set([
        mikeIds.salesNavId,
        mikeIds.linkedInUsername,
        mikeIds.vanityName,
        mikeIds.duxsoupId,
      ].filter(Boolean));
      const janeValues = new Set([
        janeIds.salesNavId,
        janeIds.linkedInUsername,
        janeIds.vanityName,
        janeIds.duxsoupId,
      ].filter(Boolean));

      const overlap = [...mikeValues].filter((v) => janeValues.has(v));
      expect(overlap).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────
  // isSamePerson()
  // ───────────────────────────────────────────
  describe('isSamePerson()', () => {
    it('should return true for visitWithSalesNav and scanWithProfileOnly (same person)', () => {
      // Both have linkedInUsername "mike-hare" via Profile URL and pid
      expect(
        isSamePerson(fixtures.visitWithSalesNav.data, fixtures.scanWithProfileOnly.data),
      ).toBe(true);
    });

    it('should return true for visitWithSalesNav and scanWithSalesNav (same salesNavId)', () => {
      expect(
        isSamePerson(fixtures.visitWithSalesNav.data, fixtures.scanWithSalesNav.data),
      ).toBe(true);
    });

    it('should return true for scanWithProfileOnly and scanWithDuxsoupPid (same username)', () => {
      expect(
        isSamePerson(fixtures.scanWithProfileOnly.data, fixtures.scanWithDuxsoupPid.data),
      ).toBe(true);
    });

    it('should return true for visitWithProfileOnly and scanWithDuxsoupPid (same username)', () => {
      expect(
        isSamePerson(fixtures.visitWithProfileOnly.data, fixtures.scanWithDuxsoupPid.data),
      ).toBe(true);
    });

    it('should return false for different people (Mike Hare vs Jane Smith)', () => {
      expect(
        isSamePerson(fixtures.visitWithSalesNav.data, fixtures.visitWithNumericId.data),
      ).toBe(false);
    });
  });

  // ───────────────────────────────────────────
  // resolvePersonIdentity() consistency
  // ───────────────────────────────────────────
  describe('resolvePersonIdentity()', () => {
    it('should produce overlapping aliases for visit and scan of the same person', () => {
      const visitIdentity = resolvePersonIdentity(fixtures.visitWithSalesNav.data);
      const scanIdentity = resolvePersonIdentity(fixtures.scanWithProfileOnly.data);

      // Extract alias values into sets
      const visitAliasValues = new Set(visitIdentity.aliases.map((a) => a.value));
      const scanAliasValues = new Set(scanIdentity.aliases.map((a) => a.value));

      // At least one alias value should overlap
      const overlap = [...visitAliasValues].filter((v) => scanAliasValues.has(v));
      expect(overlap.length).toBeGreaterThan(0);

      // Specifically, both should have mike-hare as a value
      expect(visitAliasValues.has('mike-hare')).toBe(true);
      expect(scanAliasValues.has('mike-hare')).toBe(true);
    });

    it('should resolve person_id as salesNavId when SalesProfile is present', () => {
      const identity = resolvePersonIdentity(fixtures.visitWithSalesNav.data);

      expect(identity.person_id).toBe('ACwAAALwVAIBtest123');
      expect(identity.primary_id_type).toBe('salesNavId');
      expect(identity.source).toBe('salesNavId');
    });

    it('should resolve person_id as linkedInUsername when only Profile URL is present', () => {
      const identity = resolvePersonIdentity(fixtures.scanWithProfileOnly.data);

      expect(identity.person_id).toBe('mike-hare');
      expect(identity.primary_id_type).toBe('linkedInUsername');
    });

    it('should produce canonical_id for each fixture', () => {
      const visitIdentity = resolvePersonIdentity(fixtures.visitWithSalesNav.data);
      const scanIdentity = resolvePersonIdentity(fixtures.scanWithProfileOnly.data);

      expect(visitIdentity.canonical_id).toBeTruthy();
      expect(scanIdentity.canonical_id).toBeTruthy();
      expect(typeof visitIdentity.canonical_id).toBe('string');
      expect(typeof scanIdentity.canonical_id).toBe('string');
    });
  });
});
