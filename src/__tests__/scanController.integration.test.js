const { handleScan } = require('../controllers/scanController');
const Scan = require('../models/scan');
const validation = require('../utils/validation');
const logger = require('../utils/logger');
const { getConfig } = require('../utils/env');
const { computeEventKey } = require('../utils/eventKey');
const { upsertFromObservation } = require('../controllers/personController');
const DeadLetter = require('../models/deadLetter');
const { resolvePersonIdentity } = require('../utils/identityResolver');

// Mock all dependencies
jest.mock('../models/scan');
jest.mock('../utils/logger');
jest.mock('../utils/validation');
jest.mock('../utils/env');
jest.mock('../utils/eventKey');
jest.mock('../controllers/personController');
jest.mock('../models/deadLetter');
jest.mock('../utils/identityResolver');

describe('scanController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    getConfig.mockReturnValue({
      isProduction: false,
    });

    validation.validateWebhookPayload = jest.fn();
    validation.validateRequiredFields = jest.fn();
    validation.createErrorResponse = jest.fn((error, details) => ({
      error,
      ...details,
    }));
    validation.createSuccessResponse = jest.fn((type, document, profileData) => ({
      success: true,
      message: 'Success',
      data: { id: document._id },
    }));
    validation.handleDatabaseError = jest.fn((error, type, id, isProd) => ({
      error: 'Database error',
      message: error.message,
    }));

    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Mock event key computation
    computeEventKey.mockReturnValue('mock-event-key-456');

    // Mock person controller
    upsertFromObservation.mockResolvedValue({});

    // Mock dead letter
    DeadLetter.createFromFailure = jest.fn().mockResolvedValue({});

    // Mock identity resolver
    resolvePersonIdentity.mockReturnValue({
      person_id: 'mock-person-id',
      aliases: [],
      source: 'publicUrl'
    });
  });

  describe('handleScan - Success Cases', () => {
    it('should successfully process valid scan data', async () => {
      const validPayload = {
        data: {
          id: 'scan-id-123',
          Profile: 'https://linkedin.com/in/jane',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Jane',
          'Last Name': 'Doe',
          Company: 'Acme Corp',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });

      const mockScan = {
        _id: 'mongo-scan-id',
        id: 'scan-id-123',
        __v: 0,
      };
      Scan.findOneAndUpdate = jest.fn().mockResolvedValue(mockScan);

      await handleScan(req, res);

      expect(validation.validateWebhookPayload).toHaveBeenCalledWith(validPayload, 'scan');
      expect(validation.validateRequiredFields).toHaveBeenCalledWith(
        validPayload.data,
        ['ScanTime', 'Profile', 'First Name', 'Last Name'],
        'scan'
      );
      expect(Scan.findOneAndUpdate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(validation.createSuccessResponse).toHaveBeenCalledWith(
        'scan',
        mockScan,
        validPayload.data
      );
    });

    it('should require Last Name for scan (unlike visit)', async () => {
      const validPayload = {
        data: {
          id: 'scan-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          'Last Name': 'User',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: 'id',
        id: 'scan-id',
      });

      await handleScan(req, res);

      expect(validation.validateRequiredFields).toHaveBeenCalledWith(
        validPayload.data,
        ['ScanTime', 'Profile', 'First Name', 'Last Name'],
        'scan'
      );
    });

    it('should handle optional scan fields with default empty values', async () => {
      const minimalPayload = {
        data: {
          id: 'minimal-scan',
          Profile: 'https://linkedin.com/in/minimal',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Min',
          'Last Name': 'User',
          // Optional fields omitted
        },
      };

      req.body = minimalPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: minimalPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: 'mongo-id',
        id: 'minimal-scan',
      });

      await handleScan(req, res);

      const savedData = Scan.findOneAndUpdate.mock.calls[0][1];
      expect(savedData.Company).toBe('');
      expect(savedData.Title).toBe('');
      expect(savedData.Location).toBe('');
      expect(savedData['Connection Degree']).toBe('');
    });
  });

  describe('handleScan - Validation Errors', () => {
    it('should return 400 when payload validation fails', async () => {
      req.body = { invalidPayload: true };

      validation.validateWebhookPayload.mockReturnValue({
        isValid: false,
        error: 'Invalid scan payload structure',
        profileData: null,
      });

      validation.createErrorResponse.mockReturnValue({
        error: 'Invalid scan payload structure',
      });

      await handleScan(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid scan payload structure',
      });
      expect(Scan.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('should return 400 when Last Name is missing', async () => {
      const incompletePayload = {
        data: {
          id: 'test-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          // Missing Last Name (required for scan)
        },
      };

      req.body = incompletePayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: incompletePayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: false,
        error: 'Missing required fields',
        missingFields: ['Last Name'],
      });

      await handleScan(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(Scan.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleScan - Database Errors', () => {
    it('should return 500 when database operation fails', async () => {
      const validPayload = {
        data: {
          id: 'test-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          'Last Name': 'User',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      const dbError = new Error('Database connection failed');
      Scan.findOneAndUpdate = jest.fn().mockRejectedValue(dbError);

      await handleScan(req, res);

      expect(validation.handleDatabaseError).toHaveBeenCalledWith(
        dbError,
        'scan',
        'test-id',
        false
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('handleScan - Data Transformation', () => {
    it('should convert ScanTime string to Date object', async () => {
      const validPayload = {
        data: {
          id: 'test-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          'Last Name': 'User',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: 'id',
        id: 'test-id',
      });

      await handleScan(req, res);

      const savedData = Scan.findOneAndUpdate.mock.calls[0][1];
      expect(savedData.ScanTime).toBeInstanceOf(Date);
      expect(savedData.ScanTime.toISOString()).toBe('2024-01-16T14:30:00.000Z');
    });

    it('should preserve rawData in saved document', async () => {
      const validPayload = {
        data: {
          id: 'test-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          'Last Name': 'User',
        },
        metadata: {
          webhook_id: 'webhook-456',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: 'id',
        id: 'test-id',
      });

      await handleScan(req, res);

      const savedData = Scan.findOneAndUpdate.mock.calls[0][1];
      expect(savedData.rawData).toEqual(validPayload);
    });
  });

  describe('handleScan - Logging', () => {
    it('should log processing start with scan type', async () => {
      const validPayload = {
        data: {
          id: 'test-id',
          Profile: 'https://linkedin.com/in/test',
          ScanTime: '2024-01-16T14:30:00Z',
          'First Name': 'Test',
          'Last Name': 'User',
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
      });

      Scan.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: 'id',
        id: 'test-id',
      });

      await handleScan(req, res);

      expect(logger.info).toHaveBeenCalledWith('Processing scan data', {
        id: 'test-id',
        profile: 'https://linkedin.com/in/test',
      });
    });
  });
});
