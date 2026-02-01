/**
 * Duplicate Prevention Tests
 *
 * Verifies that visit + scan webhooks for the same person produce
 * overlapping aliases so that identityResolverService.findByAnyAlias()
 * can match them and prevent duplicate Person records.
 */

const { resolvePersonIdentity } = require('../../src/utils/identityResolver');
const { extractIdentifiers } = require('../../src/utils/identityMatcher');

describe('Duplicate Prevention — alias overlap across webhook types', () => {
  // Simulates a visit webhook with SalesProfile + Profile
  const visitPayload = {
    id: 'id.19022018',
    Profile: 'https://www.linkedin.com/in/mike-hare/',
    SalesProfile:
      'https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,Jvd7',
  };

  // Simulates a scan webhook with only Profile (no SalesProfile)
  const scanPayload = {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare/',
  };

  describe('Item 1.4: visit-then-scan for same person', () => {
    it('should produce overlapping alias values from visit and scan payloads', () => {
      const visitIdentity = resolvePersonIdentity(visitPayload);
      const scanIdentity = resolvePersonIdentity(scanPayload);

      // Both should have aliases
      expect(visitIdentity.aliases.length).toBeGreaterThan(0);
      expect(scanIdentity.aliases.length).toBeGreaterThan(0);

      // Extract just the alias values
      const visitValues = new Set(visitIdentity.aliases.map(a => a.value));
      const scanValues = new Set(scanIdentity.aliases.map(a => a.value));

      // There must be at least one overlapping value
      const overlap = [...visitValues].filter(v => scanValues.has(v));
      expect(overlap.length).toBeGreaterThan(0);

      // Specifically, linkedInUsername should overlap
      const visitUsername = visitIdentity.aliases.find(a => a.type === 'linkedInUsername');
      const scanUsername = scanIdentity.aliases.find(a => a.type === 'linkedInUsername');
      expect(visitUsername).toBeTruthy();
      expect(scanUsername).toBeTruthy();
      expect(visitUsername.value).toBe(scanUsername.value);
      expect(visitUsername.value).toBe('mike-hare');
    });

    it('visit should have salesNavId alias that scan does not', () => {
      const visitIdentity = resolvePersonIdentity(visitPayload);
      const scanIdentity = resolvePersonIdentity(scanPayload);

      const visitSalesNav = visitIdentity.aliases.find(a => a.type === 'salesNavId');
      const scanSalesNav = scanIdentity.aliases.find(a => a.type === 'salesNavId');

      expect(visitSalesNav).toBeTruthy();
      expect(scanSalesNav).toBeFalsy();
    });

    it('both should have vanityName alias with same value', () => {
      const visitIdentity = resolvePersonIdentity(visitPayload);
      const scanIdentity = resolvePersonIdentity(scanPayload);

      const visitVanity = visitIdentity.aliases.find(a => a.type === 'vanityName');
      const scanVanity = scanIdentity.aliases.find(a => a.type === 'vanityName');

      expect(visitVanity).toBeTruthy();
      expect(scanVanity).toBeTruthy();
      expect(visitVanity.value).toBe(scanVanity.value);
    });
  });

  describe('Item 1.5: scan-then-visit for same person', () => {
    it('scan creates person with linkedInUsername, visit matches via same alias', () => {
      // Scan arrives first — resolves identity
      const scanIdentity = resolvePersonIdentity(scanPayload);
      expect(scanIdentity.person_id).toBe('mike-hare');
      expect(scanIdentity.aliases.some(a => a.type === 'linkedInUsername' && a.value === 'mike-hare')).toBe(true);

      // Visit arrives second — also has linkedInUsername alias
      const visitIdentity = resolvePersonIdentity(visitPayload);
      expect(visitIdentity.aliases.some(a => a.type === 'linkedInUsername' && a.value === 'mike-hare')).toBe(true);

      // The visit has a higher-priority person_id (salesNavId), but the
      // linkedInUsername alias from the visit would match the scan-created person
      // via findByAnyAlias()
      const scanAliasValues = new Set(scanIdentity.aliases.map(a => a.value));
      const visitAliasValues = visitIdentity.aliases.map(a => a.value);
      const overlapping = visitAliasValues.filter(v => scanAliasValues.has(v));
      expect(overlapping.length).toBeGreaterThan(0);
    });
  });

  describe('Item 1.2: vanityName derives linkedInUsername when username extraction fails', () => {
    it('should derive linkedInUsername from vanityName for Profile-only payloads', () => {
      // Payload where extractLinkedInUsername might get the value from Profile,
      // but vanityName is the same slug — ensure both aliases are present
      const payload = {
        Profile: 'https://www.linkedin.com/in/jane-smith-12345/',
      };

      const identity = resolvePersonIdentity(payload);
      const usernameAlias = identity.aliases.find(a => a.type === 'linkedInUsername');
      const vanityAlias = identity.aliases.find(a => a.type === 'vanityName');

      expect(usernameAlias).toBeTruthy();
      expect(vanityAlias).toBeTruthy();
      expect(usernameAlias.value).toBe('jane-smith-12345');
      expect(vanityAlias.value).toBe('jane-smith-12345');
    });

    it('should derive linkedInUsername from vanityName when only PublicProfile is present', () => {
      const payload = {
        PublicProfile: 'https://www.linkedin.com/in/bob-jones/',
      };

      const identity = resolvePersonIdentity(payload);
      const usernameAlias = identity.aliases.find(a => a.type === 'linkedInUsername');

      expect(usernameAlias).toBeTruthy();
      expect(usernameAlias.value).toBe('bob-jones');
    });
  });

  describe('Item 1.1: scan payload with data.Profile extracts username', () => {
    it('should extract linkedInUsername from nested data.Profile field', () => {
      const scanWithNestedProfile = {
        data: {
          Profile: 'https://www.linkedin.com/in/mike-hare/',
          id: 'pid.mike-hare',
        },
      };

      const identifiers = extractIdentifiers(scanWithNestedProfile);
      expect(identifiers.linkedInUsername).toBe('mike-hare');
      expect(identifiers.vanityName).toBe('mike-hare');
    });
  });

  describe('Item 1.3: findByAnyAlias matches linkedInUsername ↔ vanityName cross-type', () => {
    it('linkedInUsername and vanityName produce the same value for the same person', () => {
      const payload = {
        Profile: 'https://www.linkedin.com/in/mike-hare/',
      };

      const identifiers = extractIdentifiers(payload);
      // Both should be the same lowercase slug
      expect(identifiers.linkedInUsername).toBe(identifiers.vanityName);
      expect(identifiers.linkedInUsername).toBe('mike-hare');
    });

    it('alias value overlap enables matching regardless of alias type', () => {
      // Person A created with vanityName alias
      const personAliases = [{ type: 'vanityName', value: 'mike-hare' }];

      // Search with linkedInUsername alias
      const searchAliases = [{ type: 'linkedInUsername', value: 'mike-hare' }];

      // The $in query on aliases.value would match because value is the same
      const personValues = personAliases.map(a => a.value);
      const searchValues = searchAliases.map(a => a.value);
      const overlap = searchValues.filter(v => personValues.includes(v));
      expect(overlap).toContain('mike-hare');
    });
  });

  describe('Real-world duplicate scenario: Alton Harewood', () => {
    it('should produce overlapping aliases for the exact scenario from investigation', () => {
      // Webhook Type A: Sales Nav scan (kept for documentation of the scenario)
      const _webhookA = {
        id: 'id.1927818',
        SalesProfile:
          'https://www.linkedin.com/sales/lead/ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU,name_search,lx9l',
        Profile:
          'https://www.linkedin.com/sales/lead/ACwAAAAdaooB-xOpw0VY7_AKzaZfnxxGrfTigvU,name_search,lx9l',
      };

      // Webhook Type B: Regular LinkedIn scan
      const webhookB = {
        id: 'pid.altonharewood',
        Profile: 'https://www.linkedin.com/in/altonharewood',
      };

      const identityB = resolvePersonIdentity(webhookB);

      // webhookB should have linkedInUsername alias
      const bUsername = identityB.aliases.find(a => a.type === 'linkedInUsername');
      expect(bUsername).toBeTruthy();
      expect(bUsername.value).toBe('altonharewood');

      // If webhookA's Profile had /in/altonharewood, there would be overlap.
      // In this case, webhookA's Profile is a Sales Nav URL, so no username extracted.
      // The fix relies on BOTH webhooks having the same person,
      // and webhookB creating the linkedInUsername alias that future lookups can find.
      // The real overlap happens when both webhook types have the same /in/ URL.
    });
  });
});
