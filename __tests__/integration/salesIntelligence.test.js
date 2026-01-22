const request = require('supertest');
const mongoose = require('mongoose');
const express = require('express');
const Person = require('../../src/models/person');
const Change = require('../../src/models/change');
const apiRoutes = require('../../src/routes/apiRoutes');
const database = require('../../src/utils/database');

// Create Express app for testing
const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

describe('Sales Intelligence Integration Tests', () => {
  beforeAll(async () => {
    // Connect to test database
    await database.connect();
  });

  afterAll(async () => {
    // Cleanup and disconnect
    await Person.deleteMany({});
    await Change.deleteMany({});
    await database.disconnect();
  });

  beforeEach(async () => {
    // Clear data before each test
    await Person.deleteMany({});
    await Change.deleteMany({});
  });

  describe('Query API', () => {
    it('should query prospects by title and company', async () => {
      // Create test data
      await Person.create({
        _id: 'test-vp-google',
        canonical_id: 'test-canonical-1',
        snapshot: {
          fullName: 'John Doe',
          currentTitle: 'VP Engineering',
          currentCompany: 'Google',
          connections: 1000,
          city: 'San Francisco',
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      await Person.create({
        _id: 'test-engineer-meta',
        canonical_id: 'test-canonical-2',
        snapshot: {
          fullName: 'Jane Smith',
          currentTitle: 'Software Engineer',
          currentCompany: 'Meta',
          connections: 500,
          city: 'San Francisco',
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      // Query for VPs at Google
      const response = await request(app)
        .post('/api/query/people')
        .send({
          filters: {
            'snapshot.currentTitle': { $regex: 'VP', $options: 'i' },
            'snapshot.currentCompany': 'Google',
          },
          limit: 10,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBe(1);
      expect(response.body.data.results[0].snapshot.fullName).toBe('John Doe');
    });

    it('should filter by connections range', async () => {
      await Person.create({
        _id: 'test-influencer',
        canonical_id: 'test-canonical-3',
        snapshot: {
          fullName: 'Influencer User',
          currentTitle: 'CEO',
          currentCompany: 'StartupCo',
          connections: 1500,
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      const response = await request(app)
        .post('/api/query/people')
        .send({
          filters: {
            'snapshot.connections': { $gte: 1000 },
          },
          sort: { 'snapshot.connections': -1 },
          limit: 10,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results.length).toBeGreaterThan(0);
      expect(response.body.data.results[0].snapshot.connections).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('Search API', () => {
    beforeEach(async () => {
      // Create test data
      await Person.create({
        _id: 'test-john-google',
        canonical_id: 'test-canonical-4',
        snapshot: {
          fullName: 'John Doe',
          currentTitle: 'Engineering Manager',
          currentCompany: 'Google',
          connections: 800,
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      // Wait for text index to be created
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    it('should search for people by name', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'John Doe', limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBeGreaterThan(0);
    });

    it('should search for people by company', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'Google', limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBeGreaterThan(0);
    });
  });

  describe('Change Detection', () => {
    it('should detect company changes', async () => {
      // Create person
      const person = await Person.create({
        _id: 'test-person-change',
        canonical_id: 'test-canonical-5',
        snapshot: {
          fullName: 'Alice Johnson',
          currentTitle: 'Senior Engineer',
          currentCompany: 'OldCo',
          connections: 600,
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      // Import change detection
      const { detectChanges } = require('../../src/services/changeDetectionService');

      // Simulate company change
      const oldSnapshot = JSON.parse(JSON.stringify(person.snapshot));
      person.snapshot.currentCompany = 'NewCo';

      const changes = await detectChanges(
        person,
        oldSnapshot,
        person.snapshot,
        new mongoose.Types.ObjectId()
      );

      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe('company_change');
      expect(changes[0].from).toBe('OldCo');
      expect(changes[0].to).toBe('NewCo');
    });

    it('should detect promotions', async () => {
      const person = await Person.create({
        _id: 'test-person-promotion',
        canonical_id: 'test-canonical-6',
        snapshot: {
          fullName: 'Bob Smith',
          currentTitle: 'Engineer',
          currentCompany: 'TechCorp',
          connections: 400,
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      const { detectChanges } = require('../../src/services/changeDetectionService');

      const oldSnapshot = JSON.parse(JSON.stringify(person.snapshot));
      person.snapshot.currentTitle = 'Senior Engineer';

      const changes = await detectChanges(
        person,
        oldSnapshot,
        person.snapshot,
        new mongoose.Types.ObjectId()
      );

      expect(changes.length).toBeGreaterThan(0);
      // Should detect either promotion or title_change
      expect(['promotion', 'title_change']).toContain(changes[0].type);
    });
  });

  describe('Export API', () => {
    it('should create CSV export job', async () => {
      // Create test data
      await Person.create({
        _id: 'test-export',
        canonical_id: 'test-canonical-8',
        snapshot: {
          firstName: 'Export',
          lastName: 'Test',
          currentTitle: 'Engineer',
          currentCompany: 'TestCo',
          email: 'export@example.com',
        },
        meta: {
          lastObservedAt: new Date(),
        },
      });

      const response = await request(app)
        .post('/api/export/people/csv')
        .send({
          filters: { 'snapshot.currentCompany': 'TestCo' },
          fields: ['firstName', 'lastName', 'currentTitle', 'email'],
        });

      expect(response.status).toBe(202);
      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBeDefined();
      expect(response.body.data.statusUrl).toBeDefined();
    });
  });
});
