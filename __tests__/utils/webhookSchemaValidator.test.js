const {
  validateWebhookSchema,
  validateAndLogSchema,
  detectUnknownFields,
  formatErrors,
} = require("../../src/utils/webhookSchemaValidator");

// Mock logger to capture log calls
jest.mock("../../src/utils/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const logger = require("../../src/utils/logger");

// --- Helper: minimal valid payloads ---

function validVisitPayload(overrides = {}) {
  return {
    userid: "user123",
    type: "visit",
    time: "2026-01-15T14:30:00.000Z",
    id: "pid.mike-hare",
    event: "create",
    messagecontext: "",
    data: {
      id: "pid.mike-hare",
      VisitTime: "2026-01-15T14:30:00.000Z",
      Profile: "https://www.linkedin.com/in/mike-hare",
      "First Name": "Mike",
      "Last Name": "Hare",
      Degree: "1st",
      Title: "VP of Product",
      Company: "Acme Corp",
      Location: "San Francisco, California, United States",
      ...overrides,
    },
  };
}

function validScanPayload(overrides = {}) {
  return {
    userid: "user123",
    type: "scan",
    time: "2026-01-15T14:30:00.000Z",
    id: "pid.mike-hare",
    event: "create",
    messagecontext: "",
    data: {
      id: "pid.mike-hare",
      ScanTime: "2026-01-15T14:30:00.000Z",
      Profile: "https://www.linkedin.com/in/mike-hare",
      "First Name": "Mike",
      "Last Name": "Hare",
      Title: "VP of Product",
      Company: "Acme Corp",
      Location: "San Francisco, California, United States",
      ...overrides,
    },
  };
}

describe("webhookSchemaValidator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("validateWebhookSchema()", () => {
    // --- Valid payloads ---

    it("should pass a valid visit payload", () => {
      const result = validateWebhookSchema(validVisitPayload());
      expect(result.valid).toBe(true);
      expect(result.typeErrors).toHaveLength(0);
      expect(result.unknownFields).toHaveLength(0);
      expect(result.type).toBe("visit");
    });

    it("should pass a valid scan payload", () => {
      const result = validateWebhookSchema(validScanPayload());
      expect(result.valid).toBe(true);
      expect(result.typeErrors).toHaveLength(0);
      expect(result.unknownFields).toHaveLength(0);
      expect(result.type).toBe("scan");
    });

    it("should pass a visit with extended data (positions, schools, skills)", () => {
      const payload = validVisitPayload({
        extended: {
          positions: [
            {
              title: "VP of Product",
              companyName: "Acme Corp",
              companyId: "12345678",
              startDate: { month: 3, year: 2022 },
              endDate: null,
              isCurrent: true,
              location: "San Francisco, CA",
            },
          ],
          schools: [
            {
              schoolName: "Stanford University",
              degree: "MBA",
              fieldOfStudy: "Business Administration",
              startDate: { year: 2015 },
              endDate: { year: 2017 },
            },
          ],
          skills: ["Product Management", "Strategic Planning"],
        },
      });

      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(true);
      expect(result.typeErrors).toHaveLength(0);
    });

    it("should pass a visit with minimal optional fields (most fields absent)", () => {
      const payload = {
        type: "visit",
        data: {
          id: "pid.test",
          VisitTime: "2026-01-15T14:30:00.000Z",
          "First Name": "Test",
          Degree: "2nd",
        },
      };

      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(true);
      expect(result.typeErrors).toHaveLength(0);
    });

    it("should pass when optional fields are null", () => {
      const payload = validVisitPayload({
        SalesProfile: null,
        Company: null,
        Location: null,
        "Last Name": null,
        extended: null,
      });

      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(true);
      expect(result.typeErrors).toHaveLength(0);
    });

    // --- Envelope-level violations ---

    it("should detect non-object payload", () => {
      const result = validateWebhookSchema(null);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("expected object"),
      );
    });

    it("should detect non-object payload (string)", () => {
      const result = validateWebhookSchema("not-an-object");
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("expected object"),
      );
    });

    it('should detect missing required "type" in envelope', () => {
      const result = validateWebhookSchema({ data: { id: "test" } });
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(expect.stringContaining("type"));
    });

    it('should detect missing required "data" in envelope', () => {
      const result = validateWebhookSchema({ type: "visit" });
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(expect.stringContaining("data"));
    });

    it("should detect invalid type value (not visit or scan)", () => {
      const payload = { type: "message", data: { id: "test" } };
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("message"),
      );
    });

    // --- Data-level type violations ---

    it("should detect when data.id is a number instead of string", () => {
      const payload = validVisitPayload({ id: 12345 });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("data/id"),
      );
    });

    it("should detect when data.id is empty string", () => {
      const payload = validVisitPayload({ id: "" });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("data/id"),
      );
    });

    it("should detect when a string field receives an object (the education bug pattern)", () => {
      const payload = validVisitPayload({
        Title: { text: "VP of Product", textDirection: "LTR" },
      });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("data/Title"),
      );
    });

    it("should detect when a string field receives an array", () => {
      const payload = validScanPayload({
        Company: ["Acme Corp", "Also Inc"],
      });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("data/Company"),
      );
    });

    it("should accept VisitTime as a Unix timestamp number", () => {
      const payload = validVisitPayload({ VisitTime: 1705312200000 });
      const result = validateWebhookSchema(payload);
      expect(
        result.typeErrors.filter((e) => e.includes("VisitTime")),
      ).toHaveLength(0);
    });

    it("should accept ScanTime as a Unix timestamp number", () => {
      const payload = validScanPayload({ ScanTime: 1705312200000 });
      const result = validateWebhookSchema(payload);
      expect(
        result.typeErrors.filter((e) => e.includes("ScanTime")),
      ).toHaveLength(0);
    });

    it("should detect when extended is a string instead of object", () => {
      const payload = validVisitPayload({ extended: "not-an-object" });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("data/extended"),
      );
    });

    it("should detect when extended.positions is not an array", () => {
      const payload = validVisitPayload({
        extended: { positions: "not-an-array" },
      });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("positions"),
      );
    });

    it("should detect when extended.skills contains a number", () => {
      const payload = validVisitPayload({
        extended: { skills: [42, "valid"] },
      });
      const result = validateWebhookSchema(payload);
      expect(result.valid).toBe(false);
      expect(result.typeErrors).toContainEqual(
        expect.stringContaining("skills"),
      );
    });

    // --- Unknown field detection ---

    it("should detect unknown fields in the envelope", () => {
      const payload = validVisitPayload();
      payload.newEnvelopeField = "surprise";
      payload.anotherNew = 123;

      const result = validateWebhookSchema(payload);
      // Unknown fields don't make the schema "invalid" — they are informational
      expect(result.unknownFields).toContainEqual(
        expect.objectContaining({ path: "envelope", key: "newEnvelopeField" }),
      );
      expect(result.unknownFields).toContainEqual(
        expect.objectContaining({ path: "envelope", key: "anotherNew" }),
      );
    });

    it("should detect unknown fields in visit data", () => {
      const payload = validVisitPayload({ NewDuxSoupField: "hello" });

      const result = validateWebhookSchema(payload);
      expect(result.unknownFields).toContainEqual(
        expect.objectContaining({ path: "data", key: "NewDuxSoupField" }),
      );
    });

    it("should detect unknown fields in scan data", () => {
      const payload = validScanPayload({ BrandNewField: "hello" });

      const result = validateWebhookSchema(payload);
      expect(result.unknownFields).toContainEqual(
        expect.objectContaining({ path: "data", key: "BrandNewField" }),
      );
    });

    it("should not flag known visit fields as unknown", () => {
      const payload = validVisitPayload({
        SalesProfile: "https://www.linkedin.com/sales/lead/ACwAAAtest",
        Email: "test@test.com",
        Phone: "+1-555-0100",
        "My Tags": ["tag1"],
        "My Notes": "note",
        extended: { positions: [], schools: [], skills: [] },
      });

      const result = validateWebhookSchema(payload);
      expect(result.unknownFields).toHaveLength(0);
    });

    it("should not flag known scan fields as unknown", () => {
      const payload = validScanPayload({
        CompanyID: "12345678",
        "Connection Degree": "2nd",
        "Profile URL": "https://www.linkedin.com/in/test",
        PublicProfile: "https://www.linkedin.com/in/test",
      });

      const result = validateWebhookSchema(payload);
      expect(result.unknownFields).toHaveLength(0);
    });

    // --- Edge cases ---

    it("should never throw even with bizarre input", () => {
      expect(() => validateWebhookSchema(undefined)).not.toThrow();
      expect(() => validateWebhookSchema(42)).not.toThrow();
      expect(() => validateWebhookSchema([])).not.toThrow();
      expect(() =>
        validateWebhookSchema({ type: "visit", data: null }),
      ).not.toThrow();
    });

    it("should handle data being a non-object gracefully", () => {
      const result = validateWebhookSchema({ type: "visit", data: "string" });
      expect(result.valid).toBe(false);
    });

    it("should accept CompanyID as integer (DuxSoup sends both string and int)", () => {
      const payload = validScanPayload({ CompanyID: 12345678 });
      const result = validateWebhookSchema(payload);
      // CompanyID allows string, integer, or null
      expect(
        result.typeErrors.filter((e) => e.includes("CompanyID")),
      ).toHaveLength(0);
    });

    it("should accept My Tags as either array or string", () => {
      const asArray = validVisitPayload({ "My Tags": ["tag1", "tag2"] });
      const asString = validVisitPayload({ "My Tags": "single-tag" });

      expect(
        validateWebhookSchema(asArray).typeErrors.filter((e) =>
          e.includes("Tags"),
        ),
      ).toHaveLength(0);
      expect(
        validateWebhookSchema(asString).typeErrors.filter((e) =>
          e.includes("Tags"),
        ),
      ).toHaveLength(0);
    });

    it("should accept position companyId as string or integer", () => {
      const asString = validVisitPayload({
        extended: {
          positions: [{ title: "VP", companyName: "Acme", companyId: "12345" }],
        },
      });
      const asInt = validVisitPayload({
        extended: {
          positions: [{ title: "VP", companyName: "Acme", companyId: 12345 }],
        },
      });

      expect(validateWebhookSchema(asString).typeErrors).toHaveLength(0);
      expect(validateWebhookSchema(asInt).typeErrors).toHaveLength(0);
    });
  });

  describe("validateAndLogSchema()", () => {
    it("should not log anything for a valid payload", () => {
      validateAndLogSchema(validVisitPayload());

      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should log a warning for type violations", () => {
      validateAndLogSchema(validVisitPayload({ id: 12345 }));

      expect(logger.warn).toHaveBeenCalledWith(
        "Webhook schema type violations detected",
        expect.objectContaining({
          type: "visit",
          violations: expect.any(Array),
          count: expect.any(Number),
        }),
      );
    });

    it("should log info for unknown fields", () => {
      validateAndLogSchema(validVisitPayload({ BrandNew: "value" }));

      expect(logger.info).toHaveBeenCalledWith(
        "Webhook schema drift: unknown fields detected",
        expect.objectContaining({
          type: "visit",
          unknownFields: expect.arrayContaining([
            expect.objectContaining({ key: "BrandNew" }),
          ]),
          count: 1,
        }),
      );
    });

    it("should log both warnings and info when both violations exist", () => {
      const payload = validVisitPayload({ id: 12345, NewField: "x" });
      validateAndLogSchema(payload);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("should include duxsoupId in log context", () => {
      validateAndLogSchema(validVisitPayload({ NewField: "x" }));

      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ duxsoupId: "pid.mike-hare" }),
      );
    });

    it("should return the validation result", () => {
      const result = validateAndLogSchema(validVisitPayload());

      expect(result).toHaveProperty("valid", true);
      expect(result).toHaveProperty("typeErrors");
      expect(result).toHaveProperty("unknownFields");
      expect(result).toHaveProperty("type", "visit");
    });
  });

  describe("detectUnknownFields()", () => {
    it("should return empty for null input", () => {
      expect(detectUnknownFields(null, ["a"], "test")).toEqual([]);
    });

    it("should return empty when all fields are known", () => {
      const result = detectUnknownFields({ a: 1, b: 2 }, ["a", "b"], "obj");
      expect(result).toEqual([]);
    });

    it("should detect unknown fields with correct path", () => {
      const result = detectUnknownFields({ a: 1, b: 2, c: 3 }, ["a"], "data");
      expect(result).toEqual([
        { path: "data", key: "b" },
        { path: "data", key: "c" },
      ]);
    });
  });

  describe("formatErrors()", () => {
    it("should return empty for null errors", () => {
      expect(formatErrors(null, "test")).toEqual([]);
    });

    it("should format type errors", () => {
      const errors = [
        {
          keyword: "type",
          instancePath: "/Title",
          params: { type: "string,null" },
          data: { text: "VP" },
        },
      ];
      const formatted = formatErrors(errors, "data");
      expect(formatted[0]).toContain("data/Title");
      expect(formatted[0]).toContain("expected");
    });

    it("should format enum errors", () => {
      const errors = [
        {
          keyword: "enum",
          instancePath: "/type",
          params: { allowedValues: ["visit", "scan"] },
          data: "message",
        },
      ];
      const formatted = formatErrors(errors, "envelope");
      expect(formatted[0]).toContain("message");
      expect(formatted[0]).toContain("visit");
    });

    it("should format required errors", () => {
      const errors = [
        {
          keyword: "required",
          instancePath: "",
          params: { missingProperty: "data" },
        },
      ];
      const formatted = formatErrors(errors, "envelope");
      expect(formatted[0]).toContain("data");
      expect(formatted[0]).toContain("required");
    });
  });
});
