jest.mock("../../src/models/visit", () => ({
  findById: jest.fn(),
}));

jest.mock("../../src/models/scan", () => ({
  findById: jest.fn(),
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

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");
const {
  upsertFromObservation,
} = require("../../src/controllers/personController");
const {
  upsertCompanyFromObservation,
} = require("../../src/controllers/companyController");
const {
  upsertLocationFromObservation,
} = require("../../src/controllers/locationController");
const logger = require("../../src/utils/logger");
const { replayObservation } = require("../../src/controllers/replayController");

function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

function makeObservation(id = "obs-1") {
  return { _id: id, id: "dux-123", "First Name": "Jane" };
}

describe("replayController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("replayObservation()", () => {
    it("should return 200 with company_replayed and location_replayed when all succeed", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "company-1" });
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      await replayObservation(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          person_id: "person-1",
          replayed: true,
          company_replayed: true,
          location_replayed: true,
        }),
      });
    });

    it("should set company_replayed to false when company returns null", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue(null);
      upsertLocationFromObservation.mockResolvedValue({ _id: "loc-1" });

      await replayObservation(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          company_replayed: false,
          location_replayed: true,
        }),
      });
    });

    it("should return 200 with company_replayed false when company throws", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockRejectedValue(new Error("company err"));
      upsertLocationFromObservation.mockResolvedValue({ _id: "loc-1" });

      await replayObservation(req, res);

      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          company_replayed: false,
          location_replayed: true,
        }),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Company upsert failed during replay (non-blocking)",
        expect.objectContaining({ error: "company err" }),
      );
    });

    it("should return 200 with location_replayed false when location throws", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "c-1" });
      upsertLocationFromObservation.mockRejectedValue(new Error("loc err"));

      await replayObservation(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          company_replayed: true,
          location_replayed: false,
        }),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        "Location upsert failed during replay (non-blocking)",
        expect.objectContaining({ error: "loc err" }),
      );
    });

    it("should return 422 and NOT call company/location when person returns null", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue(null);

      await replayObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should return 500 and NOT call company/location when person throws", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "visit" },
      );
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockRejectedValue(new Error("person boom"));

      await replayObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid type", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-1" },
        { type: "invalid" },
      );

      await replayObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "INVALID_TYPE" }),
      );
      expect(upsertFromObservation).not.toHaveBeenCalled();
    });

    it("should return 404 when observation not found", async () => {
      const { req, res } = mockReqRes(
        { observationId: "obs-missing" },
        { type: "scan" },
      );
      Scan.findById.mockResolvedValue(null);

      await replayObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "NOT_FOUND" }),
      );
      expect(upsertFromObservation).not.toHaveBeenCalled();
    });
  });
});
