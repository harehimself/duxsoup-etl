jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock processObservationPayload directly
const mockProcessObservationPayload = jest.fn();
jest.mock("../../src/controllers/observationHandler", () => ({
  handleObservation: jest.fn(),
  processObservationPayload: mockProcessObservationPayload,
}));

jest.mock("../../src/controllers/visitController", () => ({
  handleVisit: jest.fn(),
  getVisitConfig: jest.fn().mockReturnValue({
    model: {},
    type: "visit",
    timeField: "VisitTime",
    requiredFields: ["VisitTime", "Degree", "First Name"],
    dataMapper: jest.fn(),
  }),
}));

jest.mock("../../src/controllers/scanController", () => ({
  handleScan: jest.fn(),
  getScanConfig: jest.fn().mockReturnValue({
    model: {},
    type: "scan",
    timeField: "ScanTime",
    requiredFields: ["ScanTime", "First Name", "Last Name"],
    dataMapper: jest.fn(),
  }),
}));

// Override MAX_BATCH_SIZE for testing
jest.mock("../../src/constants/limits", () => ({
  ...jest.requireActual("../../src/constants/limits"),
  MAX_BATCH_SIZE: 5,
}));

const {
  handleBatchWebhook,
} = require("../../src/controllers/batchWebhookHandler");

function buildReqRes(body = {}) {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe("BatchWebhookHandler", () => {
  describe("handleBatchWebhook()", () => {
    // ───────────────────────────────────────────
    // Validation: missing payloads field
    // ───────────────────────────────────────────
    it("should reject request missing payloads field with 400", async () => {
      const { req, res } = buildReqRes({});

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe("VALIDATION_ERROR");
      expect(body.message).toMatch(/payloads/);
    });

    // ───────────────────────────────────────────
    // Validation: non-array payloads
    // ───────────────────────────────────────────
    it("should reject non-array payloads with 400", async () => {
      const { req, res } = buildReqRes({ payloads: "not-an-array" });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe("VALIDATION_ERROR");
      expect(body.message).toMatch(/must be an array/);
    });

    // ───────────────────────────────────────────
    // Validation: empty array
    // ───────────────────────────────────────────
    it("should reject empty payloads array with 400", async () => {
      const { req, res } = buildReqRes({ payloads: [] });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe("VALIDATION_ERROR");
      expect(body.message).toMatch(/must not be empty/);
    });

    // ───────────────────────────────────────────
    // Validation: exceeds MAX_BATCH_SIZE
    // ───────────────────────────────────────────
    it("should reject batch exceeding MAX_BATCH_SIZE with 400", async () => {
      const payloads = Array.from({ length: 6 }, (_, i) => ({
        type: "visit",
        data: { id: `pid-${i}` },
      }));
      const { req, res } = buildReqRes({ payloads });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe("VALIDATION_ERROR");
      expect(body.message).toMatch(/exceeds maximum of 5/);
    });

    // ───────────────────────────────────────────
    // Success: mixed visit + scan payloads
    // ───────────────────────────────────────────
    it("should process mixed visit and scan payloads", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-1" } },
        { type: "scan", data: { id: "pid-2" } },
        { type: "visit", data: { id: "pid-3" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-1", success: true },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { scanId: "s-2", success: true },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-3", success: true },
        });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.total).toBe(3);
      expect(body.succeeded).toBe(3);
      expect(body.failed).toBe(0);
      expect(body.results).toHaveLength(3);

      // Check per-item results
      expect(body.results[0]).toEqual({
        index: 0,
        success: true,
        type: "visit",
        id: "v-1",
      });
      expect(body.results[1]).toEqual({
        index: 1,
        success: true,
        type: "scan",
        id: "s-2",
      });
      expect(body.results[2]).toEqual({
        index: 2,
        success: true,
        type: "visit",
        id: "v-3",
      });

      // processObservationPayload called 3 times
      expect(mockProcessObservationPayload).toHaveBeenCalledTimes(3);
    });

    // ───────────────────────────────────────────
    // Per-item results with correct indices
    // ───────────────────────────────────────────
    it("should return per-item results with correct indices", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-a" } },
        { type: "scan", data: { id: "pid-b" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-a" },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { scanId: "s-b" },
        });

      await handleBatchWebhook(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.results[0].index).toBe(0);
      expect(body.results[1].index).toBe(1);
    });

    // ───────────────────────────────────────────
    // Error isolation: one bad payload doesn't fail the batch
    // ───────────────────────────────────────────
    it("should isolate errors: one bad payload does not fail the batch", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-good" } },
        { type: "visit", data: { id: "pid-bad" } },
        { type: "visit", data: { id: "pid-also-good" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-good" },
        })
        .mockResolvedValueOnce({
          success: false,
          status: 400,
          error: "Missing required fields",
          data: { error: "Missing required fields" },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-also-good" },
        });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.results[0].success).toBe(true);
      expect(body.results[1].success).toBe(false);
      expect(body.results[1].error).toBe("Missing required fields");
      expect(body.results[2].success).toBe(true);
    });

    // ───────────────────────────────────────────
    // Invalid type: per-item error, not batch failure
    // ───────────────────────────────────────────
    it("should report per-item error for invalid type without failing batch", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-1" } },
        { type: "connection", data: { id: "pid-2" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-1" },
      });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.results[1].success).toBe(false);
      expect(body.results[1].error).toMatch(/Invalid type/);
      expect(body.results[1].error).toMatch(/connection/);

      // processObservationPayload only called once (for the valid payload)
      expect(mockProcessObservationPayload).toHaveBeenCalledTimes(1);
    });

    // ───────────────────────────────────────────
    // Missing type field: per-item error
    // ───────────────────────────────────────────
    it("should report per-item error for payload missing type field", async () => {
      const payloads = [
        { data: { id: "pid-1" } }, // no type
        { type: "visit", data: { id: "pid-2" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload.mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-2" },
      });

      await handleBatchWebhook(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.failed).toBe(1);
      expect(body.succeeded).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toMatch(/Missing type/);
    });

    // ───────────────────────────────────────────
    // All payloads fail: graceful response
    // ───────────────────────────────────────────
    it("should handle all payloads failing gracefully", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-fail-1" } },
        { type: "visit", data: { id: "pid-fail-2" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockResolvedValueOnce({
          success: false,
          status: 400,
          error: "Validation failed",
          data: { error: "Validation failed" },
        })
        .mockResolvedValueOnce({
          success: false,
          status: 500,
          error: "DB error",
          data: { error: "DB error" },
        });

      await handleBatchWebhook(req, res);

      // Batch endpoint itself returns 200 (batch was processed, items failed)
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.succeeded).toBe(0);
      expect(body.failed).toBe(2);
      expect(body.message).toBe("Batch processed: 0 succeeded, 2 failed");
    });

    // ───────────────────────────────────────────
    // Summary counts match results array
    // ───────────────────────────────────────────
    it("should have summary counts matching results array", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-1" } },
        { type: "invalid" },
        { type: "scan", data: { id: "pid-3" } },
        { type: "visit", data: { id: "pid-4" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-1" },
        })
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { scanId: "s-3" },
        })
        .mockResolvedValueOnce({
          success: false,
          status: 400,
          error: "Bad data",
        });

      await handleBatchWebhook(req, res);

      const body = res.json.mock.calls[0][0];

      // Count results manually
      const successCount = body.results.filter((r) => r.success).length;
      const failCount = body.results.filter((r) => !r.success).length;

      expect(body.succeeded).toBe(successCount);
      expect(body.failed).toBe(failCount);
      expect(body.total).toBe(body.results.length);
      expect(body.succeeded + body.failed).toBe(body.total);
    });

    // ───────────────────────────────────────────
    // Unexpected exception from processObservationPayload
    // ───────────────────────────────────────────
    it("should catch unexpected exceptions from processObservationPayload", async () => {
      const payloads = [
        { type: "visit", data: { id: "pid-boom" } },
        { type: "visit", data: { id: "pid-ok" } },
      ];
      const { req, res } = buildReqRes({ payloads });

      mockProcessObservationPayload
        .mockRejectedValueOnce(new Error("Unexpected crash"))
        .mockResolvedValueOnce({
          success: true,
          status: 200,
          data: { visitId: "v-ok" },
        });

      await handleBatchWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toBe("Unexpected crash");
      expect(body.results[1].success).toBe(true);
    });
  });
});
