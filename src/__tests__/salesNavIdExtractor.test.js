/**
 * Unit Tests for Sales Navigator ID Extraction
 *
 * Tests extraction logic against real-world URL patterns
 * from your production data
 */

const {
  extractSalesNavIdFromUrl,
  extractSalesNavId,
  normalizeToCanonicalCase,
  extractNumericId,
} = require('../utils/salesNavIdExtractor');

describe('extractSalesNavIdFromUrl', () => {
  describe('Real-world test cases from production data', () => {
    test('Case 1: Lowercase, People format, comma suffix', () => {
      const url =
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
      expect(result).not.toContain(',');
      expect(result).not.toContain('name');
    });

    test('Case 2: Lowercase, Lead format, different comma suffix', () => {
      const url =
        'www.linkedin.com/sales/lead/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya,name_search,z1jy';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
      expect(result).not.toContain(',');
      expect(result).not.toContain('name_search');
    });

    test('Case 3: Mixed case, Lead format, standard suffix', () => {
      const url =
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
      expect(result).not.toContain(',');
      expect(result).not.toContain('NAME_SEARCH');
    });
  });

  describe('Additional URL patterns from your data', () => {
    test('recruiterUrl format', () => {
      const url =
        'www.linkedin.com/talent/profile/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
    });

    test('recruiterUrl format with ACoAAB prefix', () => {
      const url =
        'www.linkedin.com/talent/profile/acoaabhsj7ybkdwjpapp3d5higdd5blxqaal78a';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaabhsj7ybkdwjpapp3d5higdd5blxqaal78a');
    });

    test('recruiterUrl format with https', () => {
      const url =
        'https://www.linkedin.com/talent/profile/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
    });

    test('publicUrl with salesNavId (ACwAAA format)', () => {
      const url =
        'www.linkedin.com/in/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
    });

    test('publicUrl with salesNavId (ACoAAA format)', () => {
      const url =
        'www.linkedin.com/in/acwaaa2f184b_hnrvd5wzy_e6ubasu-ulkcxaw4';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa2f184b_hnrvd5wzy_e6ubasu-ulkcxaw4');
    });

    test('salesUrl People format with multiple query params', () => {
      const url =
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
    });

    test('salesUrl People format with different params', () => {
      const url =
        'www.linkedin.com/sales/people/acoaaa2f184bcavxeqxmtibnjtw1pb00z1ejj2c,name,nw9e';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaaa2f184bcavxeqxmtibnjtw1pb00z1ejj2c');
    });

    test('salesUrl Lead format with query params', () => {
      const url =
        'www.linkedin.com/sales/lead/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya,name_search,z1jy';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
    });

    test('salesUrl Lead format without query params', () => {
      const url =
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
    });
  });

  describe('Case sensitivity handling', () => {
    test('All lowercase ID', () => {
      const url =
        'www.linkedin.com/sales/lead/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
    });

    test('All uppercase ID', () => {
      const url =
        'www.linkedin.com/sales/lead/ACWAAA0CM4MBA9L9ZIMKOPY1OTOHMYPITRLOGYA';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACWAAA0CM4MBA9L9ZIMKOPY1OTOHMYPITRLOGYA');
    });

    test('Mixed case ID (LinkedIn canonical)', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
    });

    test('ACoAAA variant (lowercase)', () => {
      const url =
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
    });

    test('ACoAAA variant (mixed case)', () => {
      const url =
        'www.linkedin.com/sales/people/ACoAAA0CM4MBva7a2Z-_uLwWoO2swdf5ye_nV2E';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACoAAA0CM4MBva7a2Z-_uLwWoO2swdf5ye_nV2E');
    });

    test('ACoAAB variant (mixed case)', () => {
      const url =
        'www.linkedin.com/sales/people/ACoAABhsj7yBKDWJpapp3d5higdd5blxqaal78a';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACoAABhsj7yBKDWJpapp3d5higdd5blxqaal78a');
    });
  });

  describe('Parameter stripping', () => {
    test('Strips comma-separated params (,name,o7fk)', () => {
      const url =
        'www.linkedin.com/sales/people/acoaaa123,name,o7fk';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acoaaa123');
      expect(result).not.toContain(',');
    });

    test('Strips comma-separated params (,NAME_SEARCH,Z1JY)', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA123,NAME_SEARCH,Z1JY';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA123');
      expect(result).not.toContain(',');
    });

    test('Strips query parameters (?param=value)', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA123?trackingId=xyz';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA123');
      expect(result).not.toContain('?');
    });

    test('Handles both comma and query params', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA123,name,abc?tracking=xyz';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA123');
      expect(result).not.toContain(',');
      expect(result).not.toContain('?');
    });
  });

  describe('Special characters in IDs', () => {
    test('Handles hyphens in ID', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA0CM4MB-a9l9-ZiMKo';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MB-a9l9-ZiMKo');
    });

    test('Handles underscores in ID', () => {
      const url =
        'www.linkedin.com/sales/lead/ACwAAA0CM4MB_a9l9_ZiMKo';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('ACwAAA0CM4MB_a9l9_ZiMKo');
    });

    test('Handles mixed hyphens and underscores', () => {
      const url =
        'www.linkedin.com/in/acwaaa2f184b_hnrvd5wzy_e6ubasu-ulkcxaw4';
      const result = extractSalesNavIdFromUrl(url);

      expect(result).toBe('acwaaa2f184b_hnrvd5wzy_e6ubasu-ulkcxaw4');
    });
  });

  describe('Edge cases', () => {
    test('Returns null for null input', () => {
      const result = extractSalesNavIdFromUrl(null);
      expect(result).toBeNull();
    });

    test('Returns null for undefined input', () => {
      const result = extractSalesNavIdFromUrl(undefined);
      expect(result).toBeNull();
    });

    test('Returns null for empty string', () => {
      const result = extractSalesNavIdFromUrl('');
      expect(result).toBeNull();
    });

    test('Returns null for non-LinkedIn URL', () => {
      const result = extractSalesNavIdFromUrl('https://example.com/profile/123');
      expect(result).toBeNull();
    });

    test('Returns null for username-based URL (not salesNavId)', () => {
      const url = 'www.linkedin.com/in/kayleighhogan';
      const result = extractSalesNavIdFromUrl(url);
      expect(result).toBeNull();
    });

    test('Returns null for numeric-only profile', () => {
      const url = 'www.linkedin.com/in/12345678';
      const result = extractSalesNavIdFromUrl(url);
      expect(result).toBeNull();
    });
  });
});

describe('extractSalesNavId from webhook data', () => {
  test('Extracts from SalesProfile field', () => {
    const data = {
      SalesProfile:
        'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',
    };
    const result = extractSalesNavId(data);

    expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Extracts from Profile field', () => {
    const data = {
      Profile: 'www.linkedin.com/in/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya',
    };
    const result = extractSalesNavId(data);

    expect(result).toBe('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
  });

  test('Extracts from RecruiterProfile field', () => {
    const data = {
      RecruiterProfile:
        'https://www.linkedin.com/talent/profile/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
    };
    const result = extractSalesNavId(data);

    expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Extracts from salesUrl field (your custom field)', () => {
    const data = {
      salesUrl:
        'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk',
    };
    const result = extractSalesNavId(data);

    expect(result).toBe('acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
  });

  test('Extracts from nested data.SalesProfile', () => {
    const data = {
      data: {
        SalesProfile:
          'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',
      },
    };
    const result = extractSalesNavId(data);

    expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Returns null if no salesNavId found', () => {
    const data = {
      Profile: 'www.linkedin.com/in/kayleighhogan', // Username, not ID
      id: 'pid.kayleighhogan',
    };
    const result = extractSalesNavId(data);

    expect(result).toBeNull();
  });

  test('Prioritizes SalesProfile over other fields', () => {
    const data = {
      SalesProfile:
        'www.linkedin.com/sales/lead/ACwAAA111,NAME_SEARCH,Z1JY',
      Profile: 'www.linkedin.com/in/acwaaa222',
    };
    const result = extractSalesNavId(data);

    // Should return from SalesProfile (higher priority)
    expect(result).toBe('ACwAAA111');
  });
});

describe('normalizeToCanonicalCase', () => {
  test('Normalizes lowercase ACwAAA to canonical', () => {
    const result = normalizeToCanonicalCase('acwaaa0cm4mba9l9zimkopy1otohmypitrlogya');
    expect(result).toBe('ACwAAA0cm4mba9l9zimkopy1otohmypitrlogya');
  });

  test('Normalizes lowercase ACoAAA to canonical', () => {
    const result = normalizeToCanonicalCase('acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
    expect(result).toBe('ACoAAA0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e');
  });

  test('Normalizes lowercase ACoAAB to canonical', () => {
    const result = normalizeToCanonicalCase('acoaabhsj7ybkdwjpapp3d5higdd5blxqaal78a');
    expect(result).toBe('ACoAABhsj7ybkdwjpapp3d5higdd5blxqaal78a');
  });

  test('Preserves already-canonical ACwAAA', () => {
    const result = normalizeToCanonicalCase('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
    expect(result).toBe('ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA');
  });

  test('Preserves already-canonical ACoAAA', () => {
    const result = normalizeToCanonicalCase('ACoAAA0CM4MBva7a2Z-_uLwWoO2swdf5ye_nV2E');
    expect(result).toBe('ACoAAA0CM4MBva7a2Z-_uLwWoO2swdf5ye_nV2E');
  });

  test('Handles null input', () => {
    const result = normalizeToCanonicalCase(null);
    expect(result).toBeNull();
  });

  test('Handles undefined input', () => {
    const result = normalizeToCanonicalCase(undefined);
    expect(result).toBeUndefined();
  });
});

describe('extractNumericId', () => {
  test('Extracts from id.NNNNNNNN format', () => {
    const result = extractNumericId('id.218248067');
    expect(result).toBe('218248067');
  });

  test('Extracts from plain numeric string', () => {
    const result = extractNumericId('218248067');
    expect(result).toBe('218248067');
  });

  test('Returns null for pid.username format', () => {
    const result = extractNumericId('pid.kayleighhogan');
    expect(result).toBeNull();
  });

  test('Returns null for short numbers (< 8 digits)', () => {
    const result = extractNumericId('id.1234567');
    expect(result).toBeNull();
  });

  test('Extracts long numeric IDs (9+ digits)', () => {
    const result = extractNumericId('id.1234567890');
    expect(result).toBe('1234567890');
  });

  test('Handles null input', () => {
    const result = extractNumericId(null);
    expect(result).toBeNull();
  });

  test('Handles undefined input', () => {
    const result = extractNumericId(undefined);
    expect(result).toBeNull();
  });
});
