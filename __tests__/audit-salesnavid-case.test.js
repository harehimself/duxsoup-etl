/**
 * Unit tests for salesNavId audit script functions
 */

const { normalizeToCanonicalCase } = require('../src/utils/salesNavIdExtractor');

// Import the functions we need to test
// Since the script is not modular, we'll test the core logic inline
function classifySalesNavId(value) {
  if (!value || typeof value !== 'string') {
    return 'missing';
  }

  const canonical = normalizeToCanonicalCase(value);
  if (!canonical) {
    return 'missing';
  }

  const hasCanonicalPrefix = /^(ACw|ACo)AA/.test(canonical);
  if (!hasCanonicalPrefix) {
    return 'nonstandard';
  }

  if (value === canonical) {
    return 'canonical';
  }

  if (value.toLowerCase() === canonical.toLowerCase()) {
    if (value === value.toLowerCase()) {
      return 'lowercase';
    }
    return 'mixed';
  }

  return 'nonstandard';
}

function normalizeSalesNavAliases(aliases = []) {
  let changed = false;
  const updated = [];
  const seenSalesNav = new Set();

  aliases.forEach((alias) => {
    if (!alias?.type || !alias?.value) {
      updated.push(alias);
      return;
    }

    if (alias.type !== 'salesNavId') {
      updated.push(alias);
      return;
    }

    const canonical = normalizeToCanonicalCase(alias.value) || alias.value;
    // Use lowercase for deduplication to catch case variants in suffix
    const key = `${alias.type}:${canonical.toLowerCase()}`;

    if (seenSalesNav.has(key)) {
      // Duplicate detected (case-insensitive)
      changed = true;
      return;
    }

    if (canonical !== alias.value) {
      // Prefix normalization changed the value
      changed = true;
    }

    seenSalesNav.add(key);
    updated.push({
      ...alias,
      value: canonical,
    });
  });

  return { updated, changed };
}

describe('salesNavId Audit Script', () => {
  describe('classifySalesNavId', () => {
    it('should classify canonical salesNavId correctly', () => {
      expect(classifySalesNavId('ACwAAA123xyz')).toBe('canonical');
      expect(classifySalesNavId('ACoAAB456abc')).toBe('canonical');
    });

    it('should classify lowercase salesNavId correctly', () => {
      expect(classifySalesNavId('acwaaa123xyz')).toBe('lowercase');
      expect(classifySalesNavId('acoaab456abc')).toBe('lowercase');
    });

    it('should classify mixed-case salesNavId correctly', () => {
      expect(classifySalesNavId('AcwAAA123xyz')).toBe('mixed');
      expect(classifySalesNavId('ACoaAB456abc')).toBe('mixed');
    });

    it('should classify nonstandard prefix as nonstandard', () => {
      expect(classifySalesNavId('ZZZ123')).toBe('nonstandard');
      expect(classifySalesNavId('ACX123')).toBe('nonstandard');
    });

    it('should classify missing values correctly', () => {
      expect(classifySalesNavId(null)).toBe('missing');
      expect(classifySalesNavId(undefined)).toBe('missing');
      expect(classifySalesNavId('')).toBe('missing');
    });
  });

  describe('normalizeSalesNavAliases', () => {
    it('should normalize lowercase prefix to canonical', () => {
      const input = [
        { type: 'salesNavId', value: 'acwaaa123xyz' },
        { type: 'numericId', value: '123456789' },
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(changed).toBe(true);
      expect(updated).toHaveLength(2);
      expect(updated[0].value).toBe('ACwAAA123xyz');
      expect(updated[1].value).toBe('123456789'); // Unchanged
    });

    it('should deduplicate case variants in suffix', () => {
      const input = [
        { type: 'salesNavId', value: 'ACwAAA123xyz' },
        { type: 'salesNavId', value: 'ACwAAA123XYZ' }, // Same ID, different case in suffix
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(changed).toBe(true);
      expect(updated).toHaveLength(1); // Second one removed as duplicate
      expect(updated[0].value).toBe('ACwAAA123xyz');
    });

    it('should deduplicate exact duplicates', () => {
      const input = [
        { type: 'salesNavId', value: 'ACwAAA123xyz' },
        { type: 'salesNavId', value: 'ACwAAA123xyz' }, // Exact duplicate
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(changed).toBe(true);
      expect(updated).toHaveLength(1);
      expect(updated[0].value).toBe('ACwAAA123xyz');
    });

    it('should preserve non-salesNavId aliases', () => {
      const input = [
        { type: 'numericId', value: '123456789' },
        { type: 'profileUrl', value: 'https://linkedin.com/in/user' },
        { type: 'salesNavId', value: 'ACwAAA123' },
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(updated).toHaveLength(3);
      expect(updated[0].type).toBe('numericId');
      expect(updated[1].type).toBe('profileUrl');
      expect(updated[2].type).toBe('salesNavId');
    });

    it('should return changed=false when no changes needed', () => {
      const input = [
        { type: 'salesNavId', value: 'ACwAAA123xyz' },
        { type: 'numericId', value: '123456789' },
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(changed).toBe(false);
      expect(updated).toHaveLength(2);
    });

    it('should keep distinct salesNavIds', () => {
      const input = [
        { type: 'salesNavId', value: 'ACwAAA123xyz' },
        { type: 'salesNavId', value: 'ACoAAB456abc' }, // Different ID
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(changed).toBe(false);
      expect(updated).toHaveLength(2);
    });

    it('should handle empty aliases array', () => {
      const { updated, changed } = normalizeSalesNavAliases([]);

      expect(changed).toBe(false);
      expect(updated).toHaveLength(0);
    });

    it('should handle aliases with missing type or value', () => {
      const input = [
        { type: 'salesNavId', value: 'ACwAAA123' },
        { type: null, value: 'something' },
        { type: 'numericId', value: null },
        { value: 'no-type' },
      ];

      const { updated, changed } = normalizeSalesNavAliases(input);

      expect(updated).toHaveLength(4);
      expect(updated[0].value).toBe('ACwAAA123');
      // Invalid aliases preserved as-is
      expect(updated[1]).toEqual({ type: null, value: 'something' });
    });
  });
});
