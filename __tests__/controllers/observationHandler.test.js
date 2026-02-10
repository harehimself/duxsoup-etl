jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/utils/validation");
jest.mock("../../src/utils/eventKey");
const mockGetConfig = jest.fn().mockReturnValue({ isProduction: false });
jest.mock("../../src/utils/env", () => ({
  getConfig: mockGetConfig,
}));

jest.mock("../../src/controllers/personController", () => ({
  upsertFromObservation: jest.fn(),
}));

jest.mock("../../src/controllers/companyController", () => ({
  upsertCompanyFromObservation: jest.fn(),
}));

jest.mock("../../src/controllers/locationController", () => ({
  upsertLocationFromObservation: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  createFromFailure: jest.fn(),
}));

const mockResolvePersonIdentity = jest.fn().mockReturnValue({
  person_id: "test-person-id",
  aliases: [],
  source: "salesNavId",
});
jest.mock("../../src/utils/identityMatcher", () => ({
  resolvePersonIdentity: mockResolvePersonIdentity,
}));

const mockShouldSkip = jest.fn().mockReturnValue(false);
jest.mock("../../src/utils/upsertDebounce", () => ({
  shouldSkip: mockShouldSkip,
  clear: jest.fn(),
  getStats: jest.fn(),
}));

const {
  handleObservation,
} = require("../../src/controllers/observationHandler");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError,
} = require("../../src/utils/validation");
const { computeEventKey } = require("../../src/utils/eventKey");
const {
  upsertFromObservation,
} = require("../../src/controllers/personController");
const {
  upsertCompanyFromObservation,
} = require("../../src/controllers/companyController");
const {
  upsertLocationFromObservation,
} = require("../../src/controllers/locationController");
const DeadLetter = require("../../src/models/deadLetter");

/**
 * Build mock req/res for Express handler testing
 */
function buildReqRes(body = {}) {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

/**
 * Standard config object matching the shape used in visitController/scanController
 */
function buildConfig(overrides = {}) {
  const model = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  };

  return {
    model,
    type: "visit",
    timeField: "VisitTime",
    requiredFields: ["id"],
    dataMapper: jest
      .fn()
      .mockReturnValue({ id: "pid.mike-hare", event_key: "abc123" }),
    ...overrides,
  };
}

describe("ObservationHandler", () => {
  beforeEach(() => {
    // Re-apply defaults that resetMocks clears
    mockGetConfig.mockReturnValue({ isProduction: false });
    mockResolvePersonIdentity.mockReturnValue({
      person_id: "test-person-id",
      aliases: [],
      source: "salesNavId",
    });
    mockShouldSkip.mockReturnValue(false);
  });

  describe("handleObservation()", () => {
    // ───────────────────────────────────────────
    // (a) Successful visit: creates observation + all entity upserts
    // ───────────────────────────────────────────
    it("should create observation and call all entity upserts on success", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        time: "2024-01-15T00:00:00Z",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
          "First Name": "Mike",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      // Setup validation mocks
      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-abc");

      const fakeObservation = {
        _id: "obs-123",
        event_key: "event-key-abc",
      };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-123" },
      });

      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "company-1" });
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      createSuccessResponse.mockReturnValue({
        success: true,
        message: "Visit data processed successfully",
      });

      await handleObservation(config, req, res);

      // Phase 1: observation created
      expect(config.model.findOneAndUpdate).toHaveBeenCalledWith(
        { event_key: "event-key-abc" },
        { $setOnInsert: expect.any(Object) },
        {
          new: true,
          upsert: true,
          runValidators: true,
          includeResultMetadata: true,
        },
      );

      // Phase 2: all three entity upserts called
      expect(upsertFromObservation).toHaveBeenCalledWith(
        fakeObservation,
        "visit",
      );
      expect(upsertCompanyFromObservation).toHaveBeenCalledWith(
        fakeObservation,
        "visit",
      );
      expect(upsertLocationFromObservation).toHaveBeenCalledWith(
        fakeObservation,
        "visit",
      );

      // Response: 200 with all upserts true
      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.people_upsert).toBe(true);
      expect(responseBody.company_upsert).toBe(true);
      expect(responseBody.location_upsert).toBe(true);
      expect(responseBody.duplicate).toBe(false);
    });

    // ───────────────────────────────────────────
    // (b) Duplicate event_key: E11000 on Phase 1 → returns existing + skips entity upserts
    // ───────────────────────────────────────────
    it("should return existing observation and skip entity upserts on duplicate event_key", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-dup");

      // Phase 1: E11000 duplicate key error
      const dupError = new Error("E11000 duplicate key");
      dupError.code = 11000;
      dupError.keyPattern = { event_key: 1 };
      config.model.findOneAndUpdate.mockRejectedValue(dupError);

      const existingObservation = {
        _id: "obs-existing",
        event_key: "event-key-dup",
      };
      config.model.findOne.mockResolvedValue(existingObservation);

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Should find existing observation
      expect(config.model.findOne).toHaveBeenCalledWith({
        event_key: "event-key-dup",
      });

      // Entity upserts should NOT be called
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();

      // Response: 200 with duplicate:true
      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.duplicate).toBe(true);
      expect(responseBody.people_upsert).toBe(true); // Already processed before
    });

    // ───────────────────────────────────────────
    // (c) Phase 2 person failure: dead letter created, company/location NOT called
    // ───────────────────────────────────────────
    it("should create dead letter and skip company/location when person upsert fails", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-fail");

      const fakeObservation = { _id: "obs-456", event_key: "event-key-fail" };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-456" },
      });

      // Person upsert throws
      const personError = new Error("Identity resolution failed");
      upsertFromObservation.mockRejectedValue(personError);

      DeadLetter.createFromFailure.mockResolvedValue({ _id: "dl-1" });
      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Still returns 200 (Phase 1 succeeded)
      expect(res.status).toHaveBeenCalledWith(200);

      // Dead letter created
      expect(DeadLetter.createFromFailure).toHaveBeenCalledWith(
        "obs-456",
        "visit",
        personError,
        expect.any(Object),
        payload,
      );

      // Company and location upserts should NOT be called
      // (they are inside the try block after person upsert at lines 134-198)
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();

      // Response shows people_upsert:false
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.people_upsert).toBe(false);
      expect(responseBody.company_upsert).toBe(false);
      expect(responseBody.location_upsert).toBe(false);
    });

    // ───────────────────────────────────────────
    // (d) Company upsert failure: location still runs
    // ───────────────────────────────────────────
    it("should still call location upsert when company upsert fails", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-comp-fail");

      const fakeObservation = {
        _id: "obs-789",
        event_key: "event-key-comp-fail",
      };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-789" },
      });

      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockRejectedValue(
        new Error("Company DB error"),
      );
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Location upsert still called despite company failure
      expect(upsertLocationFromObservation).toHaveBeenCalledWith(
        fakeObservation,
        "visit",
      );

      // Response: 200 with company_upsert:false, location_upsert:true
      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.people_upsert).toBe(true);
      expect(responseBody.company_upsert).toBe(false);
      expect(responseBody.location_upsert).toBe(true);
    });

    // ───────────────────────────────────────────
    // (e) Phase 1 failure: non-E11000 returns 500
    // ───────────────────────────────────────────
    it("should return 500 when Phase 1 model throws non-E11000 error", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-db-fail");

      // Phase 1 DB error (not E11000)
      const dbError = new Error("Connection refused");
      dbError.code = 9999;
      config.model.findOneAndUpdate.mockRejectedValue(dbError);

      handleDatabaseError.mockReturnValue({
        error: "Failed to process visit data (database error)",
        message: "Connection refused",
      });

      await handleObservation(config, req, res);

      // Returns 500
      expect(res.status).toHaveBeenCalledWith(500);
      expect(handleDatabaseError).toHaveBeenCalledWith(
        dbError,
        "visit",
        "pid.mike-hare",
        false,
      );

      // No entity upserts called
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();

      // No dead letter created
      expect(DeadLetter.createFromFailure).not.toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // (f) Invalid payload: returns 400
    // ───────────────────────────────────────────
    it("should return 400 when payload validation fails (missing data)", async () => {
      const payload = {}; // Missing data property

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: false,
        error: 'Invalid visit payload structure: Missing "data" property',
        profileData: null,
      });

      createErrorResponse.mockReturnValue({
        error: 'Invalid visit payload structure: Missing "data" property',
      });

      await handleObservation(config, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createErrorResponse).toHaveBeenCalled();

      // No DB operations attempted
      expect(config.model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(upsertFromObservation).not.toHaveBeenCalled();
    });

    it("should return 400 when required fields are missing", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: { id: "pid.mike-hare" }, // Missing Profile field if required
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig({ requiredFields: ["id", "Profile"] });

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: false,
        error: "Missing required fields",
        missingFields: ["Profile"],
      });

      createErrorResponse.mockReturnValue({
        error: "Missing required fields",
        missingFields: ["Profile"],
      });

      await handleObservation(config, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(config.model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    // ───────────────────────────────────────────
    // Edge: E11000 on Phase 1 but findOne returns null (race condition retry)
    // ───────────────────────────────────────────
    it("should retry findOne when E11000 occurs but first findOne returns null", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-race");

      const dupError = new Error("E11000");
      dupError.code = 11000;
      dupError.keyPattern = { event_key: 1 };
      config.model.findOneAndUpdate.mockRejectedValue(dupError);

      const existingObs = { _id: "obs-race", event_key: "event-key-race" };
      // First findOne returns null, second returns the document
      config.model.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingObs);

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // findOne called twice (retry)
      expect(config.model.findOne).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should return 500 when E11000 occurs but observation cannot be found after retry", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-gone");

      const dupError = new Error("E11000");
      dupError.code = 11000;
      dupError.keyPattern = { event_key: 1 };
      config.model.findOneAndUpdate.mockRejectedValue(dupError);

      // Both findOne calls return null
      config.model.findOne.mockResolvedValue(null);

      await handleObservation(config, req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Duplicate detection failed",
      });
    });

    // ───────────────────────────────────────────
    // (g) Duplicate via $setOnInsert no-op (no E11000): skip Phase 2
    // ───────────────────────────────────────────
    it("should detect duplicate via includeResultMetadata when findOneAndUpdate returns existing doc", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-existing");

      const existingObservation = {
        _id: "obs-existing",
        event_key: "event-key-existing",
      };
      // No upserted field = document already existed
      config.model.findOneAndUpdate.mockResolvedValue({
        value: existingObservation,
        lastErrorObject: { updatedExisting: true },
      });

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Entity upserts should NOT be called (duplicate detected)
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();

      // Response: 200 with duplicate:true
      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.duplicate).toBe(true);
      expect(responseBody.people_upsert).toBe(true);
    });

    // ───────────────────────────────────────────
    // Debounce: rapid-fire duplicate visits
    // ───────────────────────────────────────────
    it("should skip Phase 2 and set debounced:true when shouldSkip returns true", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-debounce");

      const fakeObservation = {
        _id: "obs-debounce",
        event_key: "event-key-debounce",
      };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-debounce" },
      });

      // Debounce returns true — skip Phase 2
      mockShouldSkip.mockReturnValue(true);

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Phase 1 still runs
      expect(config.model.findOneAndUpdate).toHaveBeenCalled();

      // Phase 2 entity upserts should NOT run
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();

      // Response: 200 with debounced:true, people_upsert:true
      expect(res.status).toHaveBeenCalledWith(200);
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.debounced).toBe(true);
      expect(responseBody.people_upsert).toBe(true);
      expect(responseBody.duplicate).toBe(false);
    });

    it("should run Phase 2 normally when shouldSkip returns false", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: "pid.mike-hare",
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-no-debounce");

      const fakeObservation = {
        _id: "obs-no-debounce",
        event_key: "event-key-no-debounce",
      };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-no-debounce" },
      });

      mockShouldSkip.mockReturnValue(false);

      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "company-1" });
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // Phase 2 runs normally
      expect(upsertFromObservation).toHaveBeenCalledWith(
        fakeObservation,
        "visit",
      );
      expect(upsertCompanyFromObservation).toHaveBeenCalled();
      expect(upsertLocationFromObservation).toHaveBeenCalled();

      // Response: debounced:false
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.debounced).toBe(false);
    });

    it("should bypass debounce when duxsoupId is missing (null)", async () => {
      const payload = {
        userid: "user1",
        type: "visit",
        data: {
          id: null, // No duxsoupId
          Profile: "https://www.linkedin.com/in/mike-hare",
        },
      };

      const { req, res } = buildReqRes(payload);
      const config = buildConfig();

      validateWebhookPayload.mockReturnValue({
        isValid: true,
        error: null,
        profileData: payload.data,
      });
      validateRequiredFields.mockReturnValue({
        isValid: true,
        error: null,
        missingFields: [],
      });
      computeEventKey.mockReturnValue("event-key-null-id");

      const fakeObservation = {
        _id: "obs-null-id",
        event_key: "event-key-null-id",
      };
      config.model.findOneAndUpdate.mockResolvedValue({
        value: fakeObservation,
        lastErrorObject: { upserted: "obs-null-id" },
      });

      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "company-1" });
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      createSuccessResponse.mockReturnValue({ success: true });

      await handleObservation(config, req, res);

      // shouldSkip should NOT have been called (null key bypasses debounce)
      expect(mockShouldSkip).not.toHaveBeenCalled();

      // Phase 2 runs normally
      expect(upsertFromObservation).toHaveBeenCalled();

      // Response: debounced:false
      const responseBody = res.json.mock.calls[0][0];
      expect(responseBody.debounced).toBe(false);
    });
  });
});
