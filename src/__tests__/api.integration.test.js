const request = require('supertest');
const express = require('express');
const apiRoutes = require('../routes/apiRoutes');
const { handleVisit } = require('../controllers/visitController');
const { handleScan } = require('../controllers/scanController');
const logger = require('../utils/logger');

// Mock dependencies
jest.mock('../controllers/visitController');
jest.mock('../controllers/scanController');
jest.mock('../utils/logger');

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json({ limit: '10mb', strict: true }));
  app.use('/api', apiRoutes);
  return app;
};

describe('API Integration Tests', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();

    // Setup default mock implementations
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();
  });

  describe('GET /api/test', () => {
    it('should return success message', async () => {
      const response = await request(app).get('/api/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'API routes working',
      });
    });
  });

  describe('POST /api/webhook', () => {
    describe('Request Validation', () => {
      it('should return 400 when type field is missing', async () => {
        const payload = {
          data: {
            id: 'test-id',
            Profile: 'https://linkedin.com/in/test',
          },
        };

        const response = await request(app)
          .post('/api/webhook')
          .send(payload)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: 'Missing type field',
        });
        expect(handleVisit).not.toHaveBeenCalled();
        expect(handleScan).not.toHaveBeenCalled();
      });

      it('should return 400 for invalid webhook type', async () => {
        const payload = {
          type: 'invalid_type',
          data: {
            id: 'test-id',
          },
        };

        const response = await request(app)
          .post('/api/webhook')
          .send(payload)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: 'Invalid payload type',
          message: 'Type must be either "visit" or "scan"',
        });
        expect(handleVisit).not.toHaveBeenCalled();
        expect(handleScan).not.toHaveBeenCalled();
      });

      it('should reject non-JSON payloads', async () => {
        const response = await request(app)
          .post('/api/webhook')
          .send('not json')
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
      });
    });

    describe('Visit Webhook Routing', () => {
      it('should route visit webhooks to handleVisit controller', async () => {
        const visitPayload = {
          type: 'visit',
          data: {
            id: 'visit-123',
            Profile: 'https://linkedin.com/in/test',
            VisitTime: '2024-01-15T10:00:00Z',
            'First Name': 'John',
            Degree: '1st',
          },
        };

        // Mock handleVisit to send a successful response
        handleVisit.mockImplementation((req, res) => {
          res.status(200).json({
            success: true,
            message: 'Visit data processed',
          });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send(visitPayload)
          .set('Content-Type', 'application/json');

        expect(handleVisit).toHaveBeenCalled();
        expect(handleScan).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('should forward request and response objects to handleVisit', async () => {
        const visitPayload = {
          type: 'visit',
          data: {
            id: 'visit-456',
          },
        };

        handleVisit.mockImplementation((req, res) => {
          expect(req.body).toEqual(visitPayload);
          res.status(200).json({ ok: true });
        });

        await request(app)
          .post('/api/webhook')
          .send(visitPayload)
          .set('Content-Type', 'application/json');

        expect(handleVisit).toHaveBeenCalledTimes(1);
        const [req, res] = handleVisit.mock.calls[0];
        expect(req.body).toEqual(visitPayload);
        expect(res.status).toBeDefined();
        expect(res.json).toBeDefined();
      });
    });

    describe('Scan Webhook Routing', () => {
      it('should route scan webhooks to handleScan controller', async () => {
        const scanPayload = {
          type: 'scan',
          data: {
            id: 'scan-123',
            Profile: 'https://linkedin.com/in/test',
            ScanTime: '2024-01-16T14:30:00Z',
            'First Name': 'Jane',
            'Last Name': 'Doe',
          },
        };

        // Mock handleScan to send a successful response
        handleScan.mockImplementation((req, res) => {
          res.status(200).json({
            success: true,
            message: 'Scan data processed',
          });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send(scanPayload)
          .set('Content-Type', 'application/json');

        expect(handleScan).toHaveBeenCalled();
        expect(handleVisit).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      it('should forward request and response objects to handleScan', async () => {
        const scanPayload = {
          type: 'scan',
          data: {
            id: 'scan-789',
          },
        };

        handleScan.mockImplementation((req, res) => {
          expect(req.body).toEqual(scanPayload);
          res.status(200).json({ ok: true });
        });

        await request(app)
          .post('/api/webhook')
          .send(scanPayload)
          .set('Content-Type', 'application/json');

        expect(handleScan).toHaveBeenCalledTimes(1);
        const [req, res] = handleScan.mock.calls[0];
        expect(req.body).toEqual(scanPayload);
        expect(res.status).toBeDefined();
        expect(res.json).toBeDefined();
      });
    });

    describe('Logging', () => {
      it('should log webhook receipt with type and id', async () => {
        const visitPayload = {
          type: 'visit',
          id: 'webhook-id-123',
          data: {
            id: 'data-id',
          },
        };

        handleVisit.mockImplementation((req, res) => {
          res.status(200).json({ success: true });
        });

        await request(app)
          .post('/api/webhook')
          .send(visitPayload)
          .set('Content-Type', 'application/json');

        expect(logger.info).toHaveBeenCalledWith('Webhook received', {
          type: 'visit',
          id: 'webhook-id-123',
        });
      });

      it('should log even when type is missing', async () => {
        const invalidPayload = {
          data: { id: 'test' },
        };

        await request(app)
          .post('/api/webhook')
          .send(invalidPayload)
          .set('Content-Type', 'application/json');

        expect(logger.info).toHaveBeenCalledWith('Webhook received', {
          type: undefined,
          id: undefined,
        });
      });
    });

    describe('Error Handling from Controllers', () => {
      it('should propagate 400 errors from handleVisit', async () => {
        const visitPayload = {
          type: 'visit',
          data: {
            id: 'test-id',
          },
        };

        handleVisit.mockImplementation((req, res) => {
          res.status(400).json({
            error: 'Missing required fields',
          });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send(visitPayload)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: 'Missing required fields',
        });
      });

      it('should propagate 500 errors from handleScan', async () => {
        const scanPayload = {
          type: 'scan',
          data: {
            id: 'test-id',
          },
        };

        handleScan.mockImplementation((req, res) => {
          res.status(500).json({
            error: 'Database error',
            message: 'Connection failed',
          });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send(scanPayload)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
          error: 'Database error',
          message: 'Connection failed',
        });
      });
    });

    describe('Content-Type Handling', () => {
      it('should accept application/json content type', async () => {
        handleVisit.mockImplementation((req, res) => {
          res.status(200).json({ success: true });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send({ type: 'visit', data: { id: 'test' } })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
      });

      it('should handle large payloads within limit', async () => {
        const largeData = {
          type: 'visit',
          data: {
            id: 'test-id',
            largeField: 'x'.repeat(1024 * 100), // 100KB of data
          },
        };

        handleVisit.mockImplementation((req, res) => {
          res.status(200).json({ success: true });
        });

        const response = await request(app)
          .post('/api/webhook')
          .send(largeData)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(handleVisit).toHaveBeenCalled();
      });
    });
  });

  describe('HTTP Methods', () => {
    it('should not allow GET requests to /api/webhook', async () => {
      const response = await request(app).get('/api/webhook');

      expect(response.status).toBe(404);
    });

    it('should not allow PUT requests to /api/webhook', async () => {
      const response = await request(app)
        .put('/api/webhook')
        .send({ type: 'visit' });

      expect(response.status).toBe(404);
    });

    it('should not allow DELETE requests to /api/webhook', async () => {
      const response = await request(app).delete('/api/webhook');

      expect(response.status).toBe(404);
    });
  });
});
