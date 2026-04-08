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

// Mock schema validator to return controllable results
const mockValidateAndLogSchema = jest.fn().mockReturnValue({
  valid: true,
  typeErrors: [],
  unknownFields: [],
  type: "visit",
});
jest.mock("../../src/utils/webhookSchemaValidator", () => ({
  validateAndLogSchema: mockValidateAndLogSchema,
  validateWebhookSchema: jest.fn(),
}));

const {
  processObservationPayload,
} = require("../../src/controllers/observationHandler");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createSuccessResponse,
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
const throughputTracker = require("../../src/utils/throughputTracker");

/**
 * Standard config object simulating a visit handler
 */
function buildConfig() {
  const mockObservation = { _id: "obs-123", event_key: "ek-123" };
  return {
    model: {
      findOneAndUpdate: jest.fn().mockResolvedValue({
        value: mockObservation,
        lastErrorObject: { upserted: "obs-123" },
      }),
    },
    type: "visit",
    timeField: "VisitTime",
    requiredFields: ["id"],
    dataMapper: jest
      .fn()
      .mockReturnValue({ id: "ds-123", event_key: "ek-123" }),
  };
}

/**
 * Standard payload simulating a visit webhook
 */
function buildPayload() {
  return {
    type: "visit",
    data: {
      id: "ds-123",
      Profile: "https://www.linkedin.com/in/johndoe",
      VisitTime: Date.now(),
    },
  };
}

describe("observationHandler — warning propagation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    throughputTracker.reset();

    // Re-apply schema validator mock after clearAllMocks
    mockValidateAndLogSchema.mockReturnValue({
      valid: true,
      typeErrors: [],
      unknownFields: [],
      type: "visit",
    });

    // Default mocks for clean processing
    validateWebhookPayload.mockReturnValue({
      isValid: true,
      profileData: { id: "ds-123", Profile: "https://linkedin.com/in/johndoe" },
    });
    validateRequiredFields.mockReturnValue({ isValid: true });
    computeEventKey.mockReturnValue("ek-123");
    createSuccessResponse.mockReturnValue({
      message: "Visit processed",
      visitId: "obs-123",
    });
    upsertFromObservation.mockResolvedValue({ _id: "person-123" });
    upsertCompanyFromObservation.mockResolvedValue({});
    upsertLocationFromObservation.mockResolvedValue({});
  });

  it("should return empty warnings array for clean processing", async () => {
    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    expect(result.data.warnings).toEqual([]);
  });

  it("should include warnings array in response on success", async () => {
    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.data).toHaveProperty("warnings");
    expect(Array.isArray(result.data.warnings)).toBe(true);
  });

  it("should include NO_STABLE_ID warning when person upsert returns null", async () => {
    // upsertFromObservation returns null when no stable ID
    upsertFromObservation.mockResolvedValue(null);

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    // people_upsert should be false when person upsert returns null
    expect(result.data.people_upsert).toBe(false);
  });

  it("should include PERSON_UPSERT_FAILED warning when person upsert throws", async () => {
    upsertFromObservation.mockRejectedValue(new Error("DB connection lost"));

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const personWarning = result.data.warnings.find(
      (w) => w.code === "PERSON_UPSERT_FAILED",
    );
    expect(personWarning).toBeDefined();
    expect(personWarning.message).toContain("DB connection lost");
  });

  it("should include COMPANY_UPSERT_FAILED warning when company upsert throws", async () => {
    upsertCompanyFromObservation.mockRejectedValue(
      new Error("Company validation failed"),
    );

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const companyWarning = result.data.warnings.find(
      (w) => w.code === "COMPANY_UPSERT_FAILED",
    );
    expect(companyWarning).toBeDefined();
    expect(companyWarning.message).toContain("Company validation failed");
  });

  it("should include LOCATION_UPSERT_FAILED warning when location upsert throws", async () => {
    upsertLocationFromObservation.mockRejectedValue(
      new Error("Location parse error"),
    );

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const locationWarning = result.data.warnings.find(
      (w) => w.code === "LOCATION_UPSERT_FAILED",
    );
    expect(locationWarning).toBeDefined();
    expect(locationWarning.message).toContain("Location parse error");
  });

  it("should include DEBOUNCED warning when processing is debounced", async () => {
    mockShouldSkip.mockReturnValue(true);

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const debouncedWarning = result.data.warnings.find(
      (w) => w.code === "DEBOUNCED",
    );
    expect(debouncedWarning).toBeDefined();
  });

  it("should include SCHEMA_TYPE_VIOLATION warnings from schema validation", async () => {
    mockValidateAndLogSchema.mockReturnValue({
      valid: false,
      typeErrors: ["data/VisitTime: expected string, got number"],
      unknownFields: [],
      type: "visit",
    });

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const schemaWarning = result.data.warnings.find(
      (w) => w.code === "SCHEMA_TYPE_VIOLATION",
    );
    expect(schemaWarning).toBeDefined();
    expect(schemaWarning.message).toContain("VisitTime");
  });

  it("should include SCHEMA_UNKNOWN_FIELD warnings from schema validation", async () => {
    mockValidateAndLogSchema.mockReturnValue({
      valid: true,
      typeErrors: [],
      unknownFields: [{ path: "data", key: "NewField" }],
      type: "visit",
    });

    const config = buildConfig();
    const result = await processObservationPayload(config, buildPayload());

    expect(result.success).toBe(true);
    const unknownFieldWarning = result.data.warnings.find(
      (w) => w.code === "SCHEMA_UNKNOWN_FIELD",
    );
    expect(unknownFieldWarning).toBeDefined();
    expect(unknownFieldWarning.message).toContain("NewField");
  });

  it("should feed warning counts to throughput tracker", async () => {
    // Cause a company upsert failure to generate a warning
    upsertCompanyFromObservation.mockRejectedValue(new Error("Company error"));

    const recordSpy = jest.spyOn(throughputTracker, "record");

    const config = buildConfig();
    await processObservationPayload(config, buildPayload());

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        warningCount: expect.any(Number),
        warningsByCode: expect.objectContaining({
          COMPANY_UPSERT_FAILED: 1,
        }),
      }),
    );

    recordSpy.mockRestore();
  });

  it("should not include warningCount in tracker event when no warnings", async () => {
    const recordSpy = jest.spyOn(throughputTracker, "record");

    const config = buildConfig();
    await processObservationPayload(config, buildPayload());

    const call = recordSpy.mock.calls[0][0];
    expect(call.warningCount).toBeUndefined();

    recordSpy.mockRestore();
  });
});
