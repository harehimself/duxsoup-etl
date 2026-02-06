const { handleVisit } = require("../controllers/visitController");
const Visit = require("../models/visit");
const validation = require("../utils/validation");
const logger = require("../utils/logger");
const { getConfig } = require("../utils/env");
const { computeEventKey } = require("../utils/eventKey");
const { upsertFromObservation } = require("../controllers/personController");
const {
  upsertCompanyFromObservation,
} = require("../controllers/companyController");
const {
  upsertLocationFromObservation,
} = require("../controllers/locationController");
const DeadLetter = require("../models/deadLetter");
const { resolvePersonIdentity } = require("../utils/identityMatcher");

// Mock all dependencies
jest.mock("../models/visit");
jest.mock("../utils/logger");
jest.mock("../utils/validation");
jest.mock("../utils/env");
jest.mock("../utils/eventKey");
jest.mock("../controllers/personController");
jest.mock("../controllers/companyController");
jest.mock("../controllers/locationController");
jest.mock("../models/deadLetter");
jest.mock("../utils/identityMatcher");

describe("visitController", () => {
  let req, res;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup request and response objects
    req = {
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Setup default mock implementations
    getConfig.mockReturnValue({
      isProduction: false,
    });

    // Mock validation functions with default implementations
    validation.validateWebhookPayload = jest.fn();
    validation.validateRequiredFields = jest.fn();
    validation.createErrorResponse = jest.fn((error, details) => ({
      error,
      ...details,
    }));
    validation.createSuccessResponse = jest.fn(
      (type, document, _profileData) => ({
        success: true,
        message: "Success",
        data: { id: document._id },
      }),
    );
    validation.handleDatabaseError = jest.fn((error, _type, _id, _isProd) => ({
      error: "Database error",
      message: error.message,
    }));

    // Mock logger
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Mock event key computation
    computeEventKey.mockReturnValue("mock-event-key-123");

    // Mock person controller
    upsertFromObservation.mockResolvedValue({});
    upsertCompanyFromObservation.mockResolvedValue({});
    upsertLocationFromObservation.mockResolvedValue({});

    // Mock dead letter
    DeadLetter.createFromFailure = jest.fn().mockResolvedValue({});

    // Mock identity resolver
    resolvePersonIdentity.mockReturnValue({
      person_id: "mock-person-id",
      aliases: [],
      source: "publicUrl",
    });
  });

  describe("handleVisit - Success Cases", () => {
    it("should successfully process valid visit data", async () => {
      const validPayload = {
        data: {
          id: "test-id-123",
          Profile: "https://linkedin.com/in/john",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "John",
          "Last Name": "Doe",
          Degree: "1st",
        },
      };

      req.body = validPayload;

      // Mock validation to pass
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

      // Mock database operation
      const mockVisit = {
        _id: "mongo-id-456",
        id: "test-id-123",
        __v: 0,
      };
      Visit.findOneAndUpdate = jest.fn().mockResolvedValue(mockVisit);

      await handleVisit(req, res);

      expect(validation.validateWebhookPayload).toHaveBeenCalledWith(
        validPayload,
        "visit",
      );
      expect(validation.validateRequiredFields).toHaveBeenCalledWith(
        validPayload.data,
        ["VisitTime", "Profile", "Degree", "First Name"],
        "visit",
      );
      expect(Visit.findOneAndUpdate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(validation.createSuccessResponse).toHaveBeenCalledWith(
        "visit",
        mockVisit,
        validPayload.data,
      );
    });

    it("should use upsert to update existing records", async () => {
      const validPayload = {
        data: {
          id: "existing-id",
          Profile: "https://linkedin.com/in/jane",
          VisitTime: "2024-01-16T10:00:00Z",
          "First Name": "Jane",
          Degree: "2nd",
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
        missingFields: [],
      });

      const mockExistingVisit = {
        _id: "mongo-id-789",
        id: "existing-id",
        __v: 1,
      };
      Visit.findOneAndUpdate = jest.fn().mockResolvedValue(mockExistingVisit);

      await handleVisit(req, res);

      expect(Visit.findOneAndUpdate).toHaveBeenCalledWith(
        { id: "existing-id" },
        expect.objectContaining({
          id: "existing-id",
          Profile: "https://linkedin.com/in/jane",
        }),
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle optional fields with default empty values", async () => {
      const minimalPayload = {
        data: {
          id: "minimal-id",
          Profile: "https://linkedin.com/in/minimal",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Min",
          Degree: "3rd+",
          // All other fields are optional
        },
      };

      req.body = minimalPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: minimalPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
        missingFields: [],
      });

      Visit.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: "mongo-id",
        id: "minimal-id",
      });

      await handleVisit(req, res);

      const savedData = Visit.findOneAndUpdate.mock.calls[0][1];
      expect(savedData["Last Name"]).toBe("");
      expect(savedData.SalesProfile).toBe("");
      expect(savedData.Email).toBe("");
      expect(savedData["My Tags"]).toEqual([]);
    });
  });

  describe("handleVisit - Validation Errors", () => {
    it("should return 400 when payload validation fails", async () => {
      req.body = { invalidPayload: true };

      validation.validateWebhookPayload.mockReturnValue({
        isValid: false,
        error: "Invalid payload structure",
        profileData: null,
      });

      validation.createErrorResponse.mockReturnValue({
        error: "Invalid payload structure",
      });

      await handleVisit(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid payload structure",
      });
      expect(Visit.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should return 400 when required fields are missing", async () => {
      const incompletePayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          // Missing VisitTime, First Name, Degree
        },
      };

      req.body = incompletePayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: incompletePayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: false,
        error: "Missing required fields",
        missingFields: ["VisitTime", "First Name", "Degree"],
      });

      validation.createErrorResponse.mockReturnValue({
        error: "Missing required fields",
        missingFields: ["VisitTime", "First Name", "Degree"],
        required: ["VisitTime", "Profile", "Degree", "First Name"],
      });

      await handleVisit(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Missing required fields",
        missingFields: ["VisitTime", "First Name", "Degree"],
        required: ["VisitTime", "Profile", "Degree", "First Name"],
      });
      expect(Visit.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("handleVisit - Database Errors", () => {
    it("should return 500 when database operation fails", async () => {
      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
        },
      };

      req.body = validPayload;

      validation.validateWebhookPayload.mockReturnValue({
        isValid: true,
        profileData: validPayload.data,
      });

      validation.validateRequiredFields.mockReturnValue({
        isValid: true,
        missingFields: [],
      });

      const dbError = new Error("Database connection failed");
      Visit.findOneAndUpdate = jest.fn().mockRejectedValue(dbError);

      validation.handleDatabaseError.mockReturnValue({
        error: "Failed to process visit data (database error)",
        message: "Database connection failed",
      });

      await handleVisit(req, res);

      expect(validation.handleDatabaseError).toHaveBeenCalledWith(
        dbError,
        "visit",
        "test-id",
        false,
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Failed to process visit data (database error)",
        message: "Database connection failed",
      });
    });

    it("should use production flag from config when handling database errors", async () => {
      getConfig.mockReturnValue({
        isProduction: true,
      });

      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
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

      const dbError = new Error("DB Error");
      Visit.findOneAndUpdate = jest.fn().mockRejectedValue(dbError);

      await handleVisit(req, res);

      expect(validation.handleDatabaseError).toHaveBeenCalledWith(
        dbError,
        "visit",
        "test-id",
        true,
      );
    });
  });

  describe("handleVisit - Unexpected Errors", () => {
    it("should handle unexpected errors in try-catch", async () => {
      req.body = { data: { id: "test" } };

      // Make validation throw an unexpected error
      validation.validateWebhookPayload.mockImplementation(() => {
        throw new Error("Unexpected validation error");
      });

      await handleVisit(req, res);

      expect(logger.error).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Failed to process visit data",
          message: "Unexpected validation error",
        }),
      );
    });

    it("should include stack trace in development mode for unexpected errors", async () => {
      getConfig.mockReturnValue({
        isProduction: false,
      });

      req.body = { data: { id: "test" } };

      const testError = new Error("Test error");
      testError.stack = "Error stack trace";

      validation.validateWebhookPayload.mockImplementation(() => {
        throw testError;
      });

      await handleVisit(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: "Error stack trace",
        }),
      );
    });

    it("should not include stack trace in production mode for unexpected errors", async () => {
      getConfig.mockReturnValue({
        isProduction: true,
      });

      req.body = { data: { id: "test" } };

      const testError = new Error("Test error");
      testError.stack = "Error stack trace";

      validation.validateWebhookPayload.mockImplementation(() => {
        throw testError;
      });

      await handleVisit(req, res);

      const responseData = res.json.mock.calls[0][0];
      expect(responseData).not.toHaveProperty("stack");
    });
  });

  describe("handleVisit - Data Transformation", () => {
    it("should convert VisitTime string to Date object", async () => {
      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
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

      Visit.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: "id",
        id: "test-id",
      });

      await handleVisit(req, res);

      const savedData = Visit.findOneAndUpdate.mock.calls[0][1];
      expect(savedData.VisitTime).toBeInstanceOf(Date);
      expect(savedData.VisitTime.toISOString()).toBe(
        "2024-01-15T10:00:00.000Z",
      );
    });

    it("should preserve rawData in saved document", async () => {
      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
        },
        metadata: {
          webhook_id: "webhook-123",
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

      Visit.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: "id",
        id: "test-id",
      });

      await handleVisit(req, res);

      const savedData = Visit.findOneAndUpdate.mock.calls[0][1];
      expect(savedData.rawData).toEqual(validPayload);
    });
  });

  describe("handleVisit - Logging", () => {
    it("should log processing start", async () => {
      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
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

      Visit.findOneAndUpdate = jest.fn().mockResolvedValue({
        _id: "id",
        id: "test-id",
      });

      await handleVisit(req, res);

      expect(logger.info).toHaveBeenCalledWith("Processing visit data", {
        id: "test-id",
        profile: "https://linkedin.com/in/test",
      });
    });

    it("should log successful processing", async () => {
      const validPayload = {
        data: {
          id: "test-id",
          Profile: "https://linkedin.com/in/test",
          VisitTime: "2024-01-15T10:00:00Z",
          "First Name": "Test",
          Degree: "1st",
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

      const mockVisit = {
        _id: "mongo-id",
        id: "test-id",
        __v: 0,
      };
      Visit.findOneAndUpdate = jest.fn().mockResolvedValue(mockVisit);

      await handleVisit(req, res);

      expect(logger.info).toHaveBeenCalledWith(
        "Visit data processed in MongoDB",
        {
          id: "mongo-id",
          duxsoupId: "test-id",
          profile: "https://linkedin.com/in/test",
          isNew: true,
        },
      );
    });
  });
});
