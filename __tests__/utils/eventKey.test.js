const { computeEventKey } = require('../../src/utils/eventKey');

describe('EventKey Utility', () => {
  describe('computeEventKey()', () => {
    // ───────────────────────────────────────────
    // (a) Deterministic: same payload → same key
    // ───────────────────────────────────────────
    it('should produce the same key for identical payloads', () => {
      const payload = {
        userid: 'user1',
        type: 'visit',
        time: '2024-01-15T10:00:00Z',
        id: 'pid.mike-hare',
      };

      const key1 = computeEventKey(payload);
      const key2 = computeEventKey(payload);

      expect(key1).toBe(key2);
    });

    // ───────────────────────────────────────────
    // (b) Different payloads → different keys
    // ───────────────────────────────────────────
    it('should produce different keys when userid differs', () => {
      const base = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z', id: 'pid.mike-hare' };
      const variant = { ...base, userid: 'user2' };

      expect(computeEventKey(base)).not.toBe(computeEventKey(variant));
    });

    it('should produce different keys when type differs', () => {
      const base = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z', id: 'pid.mike-hare' };
      const variant = { ...base, type: 'scan' };

      expect(computeEventKey(base)).not.toBe(computeEventKey(variant));
    });

    it('should produce different keys when time differs', () => {
      const base = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z', id: 'pid.mike-hare' };
      const variant = { ...base, time: '2024-01-16T10:00:00Z' };

      expect(computeEventKey(base)).not.toBe(computeEventKey(variant));
    });

    it('should produce different keys when id differs', () => {
      const base = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z', id: 'pid.mike-hare' };
      const variant = { ...base, id: 'pid.john-doe' };

      expect(computeEventKey(base)).not.toBe(computeEventKey(variant));
    });

    // ───────────────────────────────────────────
    // (c) Missing fields use fallback values
    // ───────────────────────────────────────────
    it('should return a valid hash when all fields are missing', () => {
      // When time is missing and data.VisitTime is also missing, Date.now() is used.
      // This makes the hash non-deterministic, so we only verify format.
      const key = computeEventKey({});

      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should use fallback values for missing userid and type', () => {
      // Fix the time so the result is deterministic
      const payload1 = { time: '2024-01-15T10:00:00Z', id: 'test-id' };
      const payload2 = {
        userid: 'no-user',
        type: 'unknown',
        time: '2024-01-15T10:00:00Z',
        id: 'test-id',
      };

      // With fallbacks applied, these should produce the same key
      expect(computeEventKey(payload1)).toBe(computeEventKey(payload2));
    });

    it('should use "no-id" fallback when id is missing', () => {
      const payload1 = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z' };
      const payload2 = { userid: 'user1', type: 'visit', time: '2024-01-15T10:00:00Z', id: 'no-id' };

      // The fallback for missing id is 'no-id'
      // data.id is also checked: payload.id || payload.data?.id || 'no-id'
      expect(computeEventKey(payload1)).toBe(computeEventKey(payload2));
    });

    // ───────────────────────────────────────────
    // (d) Nested data fields checked for time
    // ───────────────────────────────────────────
    it('should use data.VisitTime when top-level time is missing', () => {
      const payload = {
        userid: 'user1',
        type: 'visit',
        // No top-level time
        data: { VisitTime: '2024-01-15T10:00:00Z', id: 'pid.mike-hare' },
        id: 'pid.mike-hare',
      };

      const payloadWithTime = {
        userid: 'user1',
        type: 'visit',
        time: '2024-01-15T10:00:00Z',
        id: 'pid.mike-hare',
      };

      // data.VisitTime should be used as the time component
      expect(computeEventKey(payload)).toBe(computeEventKey(payloadWithTime));
    });

    it('should use data.ScanTime when top-level time and VisitTime are missing', () => {
      const payload = {
        userid: 'user1',
        type: 'scan',
        data: { ScanTime: '2024-02-01T12:00:00Z', id: 'pid.jane-smith' },
        id: 'pid.jane-smith',
      };

      const payloadWithTime = {
        userid: 'user1',
        type: 'scan',
        time: '2024-02-01T12:00:00Z',
        id: 'pid.jane-smith',
      };

      expect(computeEventKey(payload)).toBe(computeEventKey(payloadWithTime));
    });

    it('should use data.id as fallback when top-level id is missing', () => {
      const payload = {
        userid: 'user1',
        type: 'visit',
        time: '2024-01-15T10:00:00Z',
        data: { id: 'pid.mike-hare' },
      };

      const payloadWithId = {
        userid: 'user1',
        type: 'visit',
        time: '2024-01-15T10:00:00Z',
        id: 'pid.mike-hare',
      };

      expect(computeEventKey(payload)).toBe(computeEventKey(payloadWithId));
    });

    // ───────────────────────────────────────────
    // (e) Output format: 40-char hex SHA1
    // ───────────────────────────────────────────
    it('should return a 40-character lowercase hex string (SHA1)', () => {
      const payload = {
        userid: 'user1',
        type: 'visit',
        time: '2024-01-15T10:00:00Z',
        id: 'pid.mike-hare',
      };

      const key = computeEventKey(payload);

      expect(key).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should return a string of exactly 40 characters', () => {
      const key = computeEventKey({ userid: 'a', type: 'b', time: 'c', id: 'd' });
      expect(key).toHaveLength(40);
    });
  });
});
