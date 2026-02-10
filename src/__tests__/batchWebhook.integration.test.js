const request = require("supertest");
const express = require("express");
const apiRoutes = require("../routes/apiRoutes");
const logger = require("../utils/logger");

// Must use require inside factory to avoid TDZ issues with jest.mock hoisting
jest.mock("../controllers/observationHandler", () => ({
  handleObservation: jest.fn(),
  processObservationPayload: jest.fn(),
}));

const {
  processObservationPayload: mockProcessObservationPayload,
} = require("../controllers/observationHandler");

jest.mock("../controllers/visitController", () => ({
  handleVisit: jest.fn(),
  getVisitConfig: jest.fn().mockReturnValue({
    model: {},
    type: "visit",
    timeField: "VisitTime",
    requiredFields: ["VisitTime", "Degree", "First Name"],
    dataMapper: jest.fn(),
  }),
}));

jest.mock("../controllers/scanController", () => ({
  handleScan: jest.fn(),
  getScanConfig: jest.fn().mockReturnValue({
    model: {},
    type: "scan",
    timeField: "ScanTime",
    requiredFields: ["ScanTime", "First Name", "Last Name"],
    dataMapper: jest.fn(),
  }),
}));

jest.mock("../utils/logger");

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: "10mb", strict: true }));
  app.use("/api", apiRoutes);
  return app;
}

describe("POST /api/webhook/batch (integration)", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();
  });

  it("should return 400 when payloads field is missing", async () => {
    const response = await request(app)
      .post("/api/webhook/batch")
      .send({})
      .set("Content-Type", "application/json");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe("VALIDATION_ERROR");
  });

  it("should return 400 for empty payloads array", async () => {
    const response = await request(app)
      .post("/api/webhook/batch")
      .send({ payloads: [] })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should process a batch of visit payloads and return per-item results", async () => {
    mockProcessObservationPayload
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-1", success: true },
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-2", success: true },
      });

    const response = await request(app)
      .post("/api/webhook/batch")
      .send({
        payloads: [
          {
            type: "visit",
            userid: "u1",
            data: { id: "pid.a", Profile: "https://linkedin.com/in/a" },
          },
          {
            type: "visit",
            userid: "u1",
            data: { id: "pid.b", Profile: "https://linkedin.com/in/b" },
          },
        ],
      })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.total).toBe(2);
    expect(response.body.succeeded).toBe(2);
    expect(response.body.failed).toBe(0);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0].success).toBe(true);
    expect(response.body.results[1].success).toBe(true);
  });

  it("should isolate failures: good payloads succeed even when one fails", async () => {
    mockProcessObservationPayload
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-ok" },
      })
      .mockResolvedValueOnce({
        success: false,
        status: 400,
        error: "Missing fields",
        data: { error: "Missing fields" },
      });

    const response = await request(app)
      .post("/api/webhook/batch")
      .send({
        payloads: [
          { type: "visit", data: { id: "pid.good" } },
          { type: "visit", data: { id: "pid.bad" } },
        ],
      })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);
    expect(response.body.succeeded).toBe(1);
    expect(response.body.failed).toBe(1);
    expect(response.body.results[0].success).toBe(true);
    expect(response.body.results[1].success).toBe(false);
  });

  it("should handle mixed visit/scan types in a single batch", async () => {
    mockProcessObservationPayload
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { visitId: "v-1" },
      })
      .mockResolvedValueOnce({
        success: true,
        status: 200,
        data: { scanId: "s-1" },
      });

    const response = await request(app)
      .post("/api/webhook/batch")
      .send({
        payloads: [
          { type: "visit", data: { id: "pid.v" } },
          { type: "scan", data: { id: "pid.s" } },
        ],
      })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);
    expect(response.body.succeeded).toBe(2);
    expect(response.body.results[0].type).toBe("visit");
    expect(response.body.results[1].type).toBe("scan");
  });

  it("should report per-item error for invalid type without failing batch", async () => {
    mockProcessObservationPayload.mockResolvedValueOnce({
      success: true,
      status: 200,
      data: { visitId: "v-1" },
    });

    const response = await request(app)
      .post("/api/webhook/batch")
      .send({
        payloads: [
          { type: "visit", data: { id: "pid.ok" } },
          { type: "connection", data: { id: "pid.bad-type" } },
        ],
      })
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);
    expect(response.body.succeeded).toBe(1);
    expect(response.body.failed).toBe(1);
    expect(response.body.results[1].error).toMatch(/Invalid type/);
  });
});
