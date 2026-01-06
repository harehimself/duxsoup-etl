const {
  shouldOverwrite,
  normalizeField,
  computeDerivedMetrics,
  updateRolesTimeline,
  upsertFromObservation,
} = require('../controllers/personController');
const Person = require('../models/person');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');

describe('PersonController', () => {
  describe('shouldOverwrite()', () => {
    it('should accept when no existing value', () => {
      const existingMeta = null;
      const incomingMeta = {
        value: 'John Doe',
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it('should reject empty incoming value', () => {
      const existingMeta = {
        value: 'John Doe',
        observed_at: new Date('2024-01-01'),
        source: 'scan',
      };
      const incomingMeta = {
        value: '',
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it('should allow visit to override scan (higher precedence)', () => {
      const existingMeta = {
        value: 'San Francisco',
        observed_at: new Date('2024-01-15'),
        source: 'scan',
      };
      const incomingMeta = {
        value: 'New York',
        observed_at: new Date('2024-01-10'), // Older
        source: 'visit', // Higher precedence
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it('should reject scan when visit exists (lower precedence)', () => {
      const existingMeta = {
        value: 'New York',
        observed_at: new Date('2024-01-10'),
        source: 'visit',
      };
      const incomingMeta = {
        value: 'San Francisco',
        observed_at: new Date('2024-01-15'), // Newer
        source: 'scan', // Lower precedence
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it('should allow newer visit to override older visit (same precedence)', () => {
      const existingMeta = {
        value: 'Engineer',
        observed_at: new Date('2024-01-01'),
        source: 'visit',
      };
      const incomingMeta = {
        value: 'Senior Engineer',
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it('should reject older visit when newer exists', () => {
      const existingMeta = {
        value: 'Senior Engineer',
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };
      const incomingMeta = {
        value: 'Engineer',
        observed_at: new Date('2024-01-01'), // Older
        source: 'visit',
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });
  });

  describe('normalizeField()', () => {
    it('should update field when incoming has higher precedence', () => {
      const snapshot = {
        location: 'San Francisco',
        _meta: {
          location: {
            value: 'San Francisco',
            observed_at: new Date('2024-01-01'),
            source: 'scan',
          },
        },
      };

      const observationMeta = {
        observed_at: new Date('2024-01-15'),
        source: 'visit',
        observation_id: 'obs123',
      };

      const updated = normalizeField(snapshot, 'location', 'New York', observationMeta);

      expect(updated).toBe(true);
      expect(snapshot.location).toBe('New York');
      expect(snapshot._meta.location.source).toBe('visit');
    });

    it('should not update field when incoming has lower precedence', () => {
      const snapshot = {
        location: 'New York',
        _meta: {
          location: {
            value: 'New York',
            observed_at: new Date('2024-01-15'),
            source: 'visit',
          },
        },
      };

      const observationMeta = {
        observed_at: new Date('2024-01-20'),
        source: 'scan',
        observation_id: 'obs123',
      };

      const updated = normalizeField(snapshot, 'location', 'San Francisco', observationMeta);

      expect(updated).toBe(false);
      expect(snapshot.location).toBe('New York'); // Unchanged
    });

    it('should not update field when incoming is empty', () => {
      const snapshot = {
        email: 'john@example.com',
        _meta: {
          email: {
            value: 'john@example.com',
            observed_at: new Date('2024-01-01'),
            source: 'scan',
          },
        },
      };

      const observationMeta = {
        observed_at: new Date('2024-01-15'),
        source: 'visit',
        observation_id: 'obs123',
      };

      const updated = normalizeField(snapshot, 'email', '', observationMeta);

      expect(updated).toBe(false);
      expect(snapshot.email).toBe('john@example.com'); // Unchanged
    });
  });

  describe('computeDerivedMetrics()', () => {
    it('should compute avg_tenure_months from roles', () => {
      const roles = [
        {
          title: 'Engineer',
          startDate: new Date('2020-01-01'),
          endDate: new Date('2022-01-01'), // 24 months
          isCurrent: false,
        },
        {
          title: 'Senior Engineer',
          startDate: new Date('2022-01-01'),
          endDate: new Date('2024-01-01'), // 24 months
          isCurrent: false,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.avg_tenure_months).toBe(24);
    });

    it('should compute years_at_current_company for current role', () => {
      const roles = [
        {
          title: 'Senior Engineer',
          startDate: new Date('2022-01-01'),
          endDate: null,
          isCurrent: true,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.years_at_current_company).toBeGreaterThan(2);
      expect(metrics.years_at_current_company).toBeLessThan(5);
    });

    it('should return null metrics when no roles exist', () => {
      const roles = [];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.avg_tenure_months).toBeNull();
      expect(metrics.years_at_current_company).toBeNull();
    });

    it('should handle multiple current roles (multi-current support)', () => {
      const roles = [
        {
          title: 'Engineer at CompanyA',
          startDate: new Date('2022-01-01'),
          isCurrent: true,
        },
        {
          title: 'Consultant at CompanyB',
          startDate: new Date('2023-06-01'),
          isCurrent: true,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      // Should use the longest current tenure
      expect(metrics.years_at_current_company).toBeGreaterThan(2);
    });
  });

  describe('updateRolesTimeline()', () => {
    it('should add new role without deleting existing roles', () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: 'Engineer',
              companyName: 'OldCorp',
              startDate: new Date('2020-01-01'),
              endDate: new Date('2022-01-01'),
              isCurrent: false,
            },
          ],
        },
      };

      const observationData = {
        Title: 'Senior Engineer',
        Company: 'NewCorp',
        CompanyID: '12345',
        extended: {
          positions: [
            {
              Title: 'Senior Engineer',
              Company: 'NewCorp',
              From: '2022-01-01',
              To: 'Present',
            },
          ],
        },
      };

      const observationMeta = {
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const updated = updateRolesTimeline(person, observationData, observationMeta);

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(2); // Old + new
      expect(person.snapshot.roles[0].companyName).toBe('OldCorp'); // Preserved
      expect(person.snapshot.roles[1].companyName).toBe('NewCorp'); // Added
    });

    it('should preserve multi-current roles', () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: 'Engineer at CompanyA',
              companyName: 'CompanyA',
              isCurrent: true,
            },
            {
              title: 'Consultant at CompanyB',
              companyName: 'CompanyB',
              isCurrent: true,
            },
          ],
        },
      };

      const observationData = {
        Title: 'Engineer at CompanyA',
        Company: 'CompanyA',
      };

      const observationMeta = {
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const updated = updateRolesTimeline(person, observationData, observationMeta);

      expect(updated).toBe(false); // No new roles added
      expect(person.snapshot.roles).toHaveLength(2); // Both preserved
      expect(person.snapshot.roles.filter(r => r.isCurrent)).toHaveLength(2);
    });

    it('should not duplicate existing role', () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: 'Engineer',
              companyName: 'TechCorp',
              startDate: new Date('2022-01-01'),
              isCurrent: true,
            },
          ],
        },
      };

      const observationData = {
        Title: 'Engineer',
        Company: 'TechCorp',
      };

      const observationMeta = {
        observed_at: new Date('2024-01-15'),
        source: 'visit',
      };

      const updated = updateRolesTimeline(person, observationData, observationMeta);

      expect(updated).toBe(false); // No update
      expect(person.snapshot.roles).toHaveLength(1); // Not duplicated
    });
  });

  // Note: Integration tests for upsertFromObservation() moved to separate file
  // See personController.integration.test.js for DB-backed tests
});
