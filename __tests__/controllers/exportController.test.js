jest.mock("../../src/services/exportService", () => ({
  createExportJob: jest.fn(),
  processExportJob: jest.fn(),
  getExportJobStatus: jest.fn(),
  getExportFile: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  createExportJob,
  processExportJob,
} = require("../../src/services/exportService");

const {
  createCsvExportHandler,
  createJsonExportHandler,
  createCompanyCsvExportHandler,
  createCompanyJsonExportHandler,
  createLocationCsvExportHandler,
  createLocationJsonExportHandler,
} = require("../../src/controllers/exportController");

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

function mockReq(body = {}) {
  return { body };
}

describe("ExportController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    processExportJob.mockResolvedValue(undefined);
  });

  describe("handler factory", () => {
    it("should return 202 with entityType=people for createCsvExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-1",
        status: "pending",
      });

      const req = mockReq({ filters: {}, fields: ["firstName"] });
      const res = mockRes();
      const next = jest.fn();

      await createCsvExportHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            entityType: "people",
            jobId: "job-1",
          }),
        }),
      );
      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "csv", entityType: "people" }),
      );
    });

    it("should return 202 with entityType=people for createJsonExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-2",
        status: "pending",
      });

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createJsonExportHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "json", entityType: "people" }),
      );
    });

    it("should return 202 with entityType=companies for createCompanyCsvExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-co-1",
        status: "pending",
      });

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createCompanyCsvExportHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityType: "companies" }),
        }),
      );
      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "csv", entityType: "companies" }),
      );
    });

    it("should return 202 with entityType=companies for createCompanyJsonExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-co-2",
        status: "pending",
      });

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createCompanyJsonExportHandler(req, res, next);

      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "json", entityType: "companies" }),
      );
    });

    it("should return 202 with entityType=locations for createLocationCsvExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-loc-1",
        status: "pending",
      });

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createLocationCsvExportHandler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "csv", entityType: "locations" }),
      );
    });

    it("should return 202 with entityType=locations for createLocationJsonExportHandler", async () => {
      createExportJob.mockResolvedValue({
        _id: "job-loc-2",
        status: "pending",
      });

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createLocationJsonExportHandler(req, res, next);

      expect(createExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ format: "json", entityType: "locations" }),
      );
    });

    it("should call next(err) when createExportJob throws", async () => {
      const error = new Error("validation failed");
      createExportJob.mockRejectedValue(error);

      const req = mockReq({});
      const res = mockRes();
      const next = jest.fn();

      await createCsvExportHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
