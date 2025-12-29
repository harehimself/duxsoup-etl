const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError,
} = require('../utils/validation');

// Mock the logger
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');

describe('Validation Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateWebhookPayload', () => {
    it('should return valid for correct payload with data property', () => {
      const payload = {
        data: {
          id: 'test-id-123',
          Profile: 'https://linkedin.com/in/test',
        },
      };

      const result = validateWebhookPayload(payload, 'visit');

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.profileData).toEqual(payload.data);
    });

    it('should return invalid when payload is null', () => {
      const result = validateWebhookPayload(null, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing "data" property');
      expect(result.profileData).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return invalid when payload is undefined', () => {
      const result = validateWebhookPayload(undefined, 'scan');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing "data" property');
      expect(result.profileData).toBeNull();
    });

    it('should return invalid when data property is missing', () => {
      const payload = { type: 'visit' };

      const result = validateWebhookPayload(payload, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing "data" property');
      expect(result.profileData).toBeNull();
    });

    it('should return invalid when id is missing', () => {
      const payload = {
        data: {
          Profile: 'https://linkedin.com/in/test',
        },
      };

      const result = validateWebhookPayload(payload, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing or invalid "id"');
      expect(result.profileData).toBeNull();
    });

    it('should return invalid when id is empty string', () => {
      const payload = {
        data: {
          id: '',
          Profile: 'https://linkedin.com/in/test',
        },
      };

      const result = validateWebhookPayload(payload, 'scan');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing or invalid "id"');
    });

    it('should return invalid when id is whitespace only', () => {
      const payload = {
        data: {
          id: '   ',
          Profile: 'https://linkedin.com/in/test',
        },
      };

      const result = validateWebhookPayload(payload, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing or invalid "id"');
    });

    it('should return invalid when id is not a string', () => {
      const payload = {
        data: {
          id: 12345,
          Profile: 'https://linkedin.com/in/test',
        },
      };

      const result = validateWebhookPayload(payload, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing or invalid "id"');
    });

    it('should handle different webhook types in error messages', () => {
      const payload = { type: 'scan' };

      const resultVisit = validateWebhookPayload(payload, 'visit');
      const resultScan = validateWebhookPayload(payload, 'scan');

      expect(resultVisit.error).toContain('Invalid visit');
      expect(resultScan.error).toContain('Invalid scan');
    });
  });

  describe('validateRequiredFields', () => {
    it('should return valid when all required fields are present', () => {
      const profileData = {
        id: 'test-id',
        Profile: 'https://linkedin.com/in/test',
        VisitTime: '2024-01-15T10:00:00Z',
        'First Name': 'John',
      };
      const requiredFields = ['Profile', 'VisitTime', 'First Name'];

      const result = validateRequiredFields(profileData, requiredFields, 'visit');

      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.missingFields).toEqual([]);
    });

    it('should return invalid when a required field is missing', () => {
      const profileData = {
        id: 'test-id',
        Profile: 'https://linkedin.com/in/test',
        // VisitTime is missing
        'First Name': 'John',
      };
      const requiredFields = ['Profile', 'VisitTime', 'First Name'];

      const result = validateRequiredFields(profileData, requiredFields, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Missing required fields');
      expect(result.missingFields).toContain('VisitTime');
    });

    it('should return invalid when multiple required fields are missing', () => {
      const profileData = {
        id: 'test-id',
        Profile: 'https://linkedin.com/in/test',
      };
      const requiredFields = ['Profile', 'VisitTime', 'First Name', 'Last Name'];

      const result = validateRequiredFields(profileData, requiredFields, 'scan');

      expect(result.isValid).toBe(false);
      expect(result.missingFields).toEqual(['VisitTime', 'First Name', 'Last Name']);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should treat empty string as missing field', () => {
      const profileData = {
        id: 'test-id',
        Profile: '',
        VisitTime: '2024-01-15T10:00:00Z',
      };
      const requiredFields = ['Profile', 'VisitTime'];

      const result = validateRequiredFields(profileData, requiredFields, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.missingFields).toContain('Profile');
    });

    it('should treat null as missing field', () => {
      const profileData = {
        id: 'test-id',
        Profile: 'https://linkedin.com/in/test',
        VisitTime: null,
      };
      const requiredFields = ['Profile', 'VisitTime'];

      const result = validateRequiredFields(profileData, requiredFields, 'visit');

      expect(result.isValid).toBe(false);
      expect(result.missingFields).toContain('VisitTime');
    });

    it('should handle empty required fields array', () => {
      const profileData = { id: 'test-id' };
      const requiredFields = [];

      const result = validateRequiredFields(profileData, requiredFields, 'visit');

      expect(result.isValid).toBe(true);
      expect(result.missingFields).toEqual([]);
    });
  });

  describe('createErrorResponse', () => {
    it('should create basic error response with just message', () => {
      const result = createErrorResponse('Test error message');

      expect(result).toEqual({
        error: 'Test error message',
      });
    });

    it('should include missingFields when provided', () => {
      const details = { missingFields: ['field1', 'field2'] };

      const result = createErrorResponse('Missing fields error', details);

      expect(result).toEqual({
        error: 'Missing fields error',
        missingFields: ['field1', 'field2'],
      });
    });

    it('should include required fields when provided', () => {
      const details = { required: ['Profile', 'VisitTime'] };

      const result = createErrorResponse('Validation error', details);

      expect(result).toEqual({
        error: 'Validation error',
        required: ['Profile', 'VisitTime'],
      });
    });

    it('should include message when provided in details', () => {
      const details = { message: 'Additional context message' };

      const result = createErrorResponse('Error occurred', details);

      expect(result).toEqual({
        error: 'Error occurred',
        message: 'Additional context message',
      });
    });

    it('should include all details when provided', () => {
      const details = {
        missingFields: ['field1'],
        required: ['field1', 'field2'],
        message: 'Detailed error info',
      };

      const result = createErrorResponse('Complex error', details);

      expect(result).toEqual({
        error: 'Complex error',
        missingFields: ['field1'],
        required: ['field1', 'field2'],
        message: 'Detailed error info',
      });
    });
  });

  describe('createSuccessResponse', () => {
    it('should create success response for visit type', () => {
      const document = { _id: 'mongo-id-123' };
      const profileData = {
        id: 'duxsoup-id-456',
        Profile: 'https://linkedin.com/in/john',
        VisitTime: '2024-01-15T10:00:00Z',
        'First Name': 'John',
      };

      const result = createSuccessResponse('visit', document, profileData);

      expect(result).toEqual({
        success: true,
        message: 'Visit data processed successfully',
        data: {
          id: 'mongo-id-123',
          duxsoupId: 'duxsoup-id-456',
          profile: 'https://linkedin.com/in/john',
          visittime: '2024-01-15T10:00:00Z',
          firstName: 'John',
          status: 'processed',
        },
      });
    });

    it('should create success response for scan type with lastName', () => {
      const document = { _id: 'mongo-id-789' };
      const profileData = {
        id: 'duxsoup-id-789',
        Profile: 'https://linkedin.com/in/jane',
        ScanTime: '2024-01-16T14:30:00Z',
        'First Name': 'Jane',
        'Last Name': 'Doe',
      };

      const result = createSuccessResponse('scan', document, profileData);

      expect(result).toEqual({
        success: true,
        message: 'Scan data processed successfully',
        data: {
          id: 'mongo-id-789',
          duxsoupId: 'duxsoup-id-789',
          profile: 'https://linkedin.com/in/jane',
          scantime: '2024-01-16T14:30:00Z',
          firstName: 'Jane',
          lastName: 'Doe',
          status: 'processed',
        },
      });
    });

    it('should capitalize first letter of type in message', () => {
      const document = { _id: 'id' };
      const profileData = {
        id: 'test',
        Profile: 'url',
        VisitTime: 'time',
        'First Name': 'Name',
      };

      const result = createSuccessResponse('visit', document, profileData);

      expect(result.message).toBe('Visit data processed successfully');
    });

    it('should not include lastName for visit type', () => {
      const document = { _id: 'id' };
      const profileData = {
        id: 'test',
        Profile: 'url',
        VisitTime: 'time',
        'First Name': 'Name',
        'Last Name': 'Should not appear',
      };

      const result = createSuccessResponse('visit', document, profileData);

      expect(result.data).not.toHaveProperty('lastName');
    });
  });

  describe('handleDatabaseError', () => {
    it('should create error response with message and stack in development', () => {
      const error = new Error('Database connection failed');
      error.stack = 'Error: Database connection failed\n  at test.js:1:1';

      const result = handleDatabaseError(error, 'visit', 'test-id-123', false);

      expect(result).toEqual({
        error: 'Failed to process visit data (database error)',
        message: 'Database connection failed',
        stack: error.stack,
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Error saving or updating visit data:',
        expect.objectContaining({
          error: 'Database connection failed',
          duxsoupId: 'test-id-123',
        })
      );
    });

    it('should not include stack trace in production', () => {
      const error = new Error('Database error');
      error.stack = 'Error: Database error\n  at test.js:1:1';

      const result = handleDatabaseError(error, 'scan', 'test-id-456', true);

      expect(result).toEqual({
        error: 'Failed to process scan data (database error)',
        message: 'Database error',
      });
      expect(result).not.toHaveProperty('stack');
    });

    it('should handle errors without stack property', () => {
      const error = new Error('Simple error');
      delete error.stack;

      const result = handleDatabaseError(error, 'visit', 'test-id', false);

      expect(result).toEqual({
        error: 'Failed to process visit data (database error)',
        message: 'Simple error',
      });
    });

    it('should handle different webhook types', () => {
      const error = new Error('Test error');

      const visitResult = handleDatabaseError(error, 'visit', 'id1', true);
      const scanResult = handleDatabaseError(error, 'scan', 'id2', true);

      expect(visitResult.error).toContain('visit data');
      expect(scanResult.error).toContain('scan data');
    });

    it('should log error with correct parameters', () => {
      const error = new Error('Test error');
      error.stack = 'stack trace';

      handleDatabaseError(error, 'visit', 'duxsoup-123', true);

      expect(logger.error).toHaveBeenCalledWith(
        'Error saving or updating visit data:',
        {
          error: 'Test error',
          stack: 'stack trace',
          duxsoupId: 'duxsoup-123',
        }
      );
    });
  });
});
