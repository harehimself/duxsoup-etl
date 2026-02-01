jest.mock("mongoose", () => {
  const actualMongoose = jest.requireActual("mongoose");
  return {
    ...actualMongoose,
    model: jest.fn().mockReturnValue({}),
    connect: jest.fn(),
    Schema: actualMongoose.Schema,
  };
});

jest.mock("../../src/models/person", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/exportJob", () => ({
  create: jest.fn(),
  findById: jest.fn(),
}));

jest.mock("../../src/utils/queryValidation", () => ({
  validateQuery: jest.fn((params) => params),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("fs", () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    access: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("csv-writer", () => ({
  createObjectCsvWriter: jest.fn(() => ({
    writeRecords: jest.fn().mockResolvedValue(undefined),
  })),
}));

const {
  createExportJob,
  processExportJob,
  getExportJobStatus,
  getExportFile,
  DEFAULT_CSV_FIELDS,
} = require("../../src/services/exportService");
const Person = require("../../src/models/person");
const ExportJob = require("../../src/models/exportJob");

/**
 * Helper: chainable query mock
 */
function buildQueryMock(resolvedValue = []) {
  return {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe("ExportService", () => {
  // ───────────────────────────────────────────
  // createExportJob()
  // ───────────────────────────────────────────
  describe("createExportJob()", () => {
    it("should throw INVALID_FORMAT for unsupported format", async () => {
      await expect(createExportJob({ format: "xml" })).rejects.toThrow(
        "Format must be csv or json",
      );
    });

    it("should create job with default CSV fields when none specified", async () => {
      ExportJob.create.mockResolvedValue({
        _id: "job-123",
        format: "csv",
        fields: DEFAULT_CSV_FIELDS,
        status: "pending",
      });

      const job = await createExportJob({ format: "csv" });

      expect(ExportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          format: "csv",
          fields: DEFAULT_CSV_FIELDS,
          status: "pending",
        }),
      );
      expect(job.status).toBe("pending");
    });

    it("should use custom fields when provided", async () => {
      const customFields = ["firstName", "lastName", "email"];
      ExportJob.create.mockResolvedValue({
        _id: "job-456",
        format: "json",
        fields: customFields,
        status: "pending",
      });

      await createExportJob({ format: "json", fields: customFields });

      expect(ExportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({ fields: customFields }),
      );
    });

    it("should set expiresAt based on TTL", async () => {
      ExportJob.create.mockResolvedValue({ _id: "job-789", status: "pending" });

      await createExportJob({ format: "csv" });

      const createArg = ExportJob.create.mock.calls[0][0];
      expect(createArg.expiresAt).toBeInstanceOf(Date);
      expect(createArg.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ───────────────────────────────────────────
  // processExportJob()
  // ───────────────────────────────────────────
  describe("processExportJob()", () => {
    it("should throw NOT_FOUND when job does not exist", async () => {
      ExportJob.findById.mockResolvedValue(null);

      await expect(processExportJob("nonexistent")).rejects.toThrow(
        "Export job not found",
      );
    });

    it("should throw INVALID_STATE when job is not pending", async () => {
      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "completed",
        save: jest.fn(),
      });

      await expect(processExportJob("job-1")).rejects.toThrow("not pending");
    });

    it("should process CSV job and update status to completed", async () => {
      // Re-setup mocks that get cleared between tests
      const fs = require("fs");
      fs.promises.mkdir.mockResolvedValue(undefined);
      fs.promises.stat.mockResolvedValue({ size: 1024 });
      const csvWriter = require("csv-writer");
      csvWriter.createObjectCsvWriter.mockReturnValue({
        writeRecords: jest.fn().mockResolvedValue(undefined),
      });

      const mockData = [
        { _id: "p1", snapshot: { firstName: "John", lastName: "Doe" } },
      ];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-csv",
        format: "csv",
        status: "pending",
        filters: {},
        fields: ["firstName", "lastName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      const _result = await processExportJob("job-csv");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(1);
      expect(jobDoc.result.fileSize).toBe(1024);
      expect(jobDoc.save).toHaveBeenCalled();
    });

    it("should process JSON job and update status to completed", async () => {
      const fs = require("fs");
      fs.promises.mkdir.mockResolvedValue(undefined);
      fs.promises.writeFile.mockResolvedValue(undefined);
      fs.promises.stat.mockResolvedValue({ size: 512 });

      const queryMock = buildQueryMock([{ _id: "p1" }]);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-json",
        format: "json",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-json");

      expect(jobDoc.status).toBe("completed");
    });

    it("should set status to failed when error occurs during export", async () => {
      Person.find.mockImplementation(() => {
        throw new Error("DB error");
      });

      const jobDoc = {
        _id: "job-fail",
        format: "csv",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-fail")).rejects.toThrow("DB error");
      expect(jobDoc.status).toBe("failed");
      expect(jobDoc.error.message).toBe("DB error");
    });

    it("should throw EXPORT_TOO_LARGE when data exceeds max rows", async () => {
      // Create array with 100001 items (default max is 100000)
      const largeData = new Array(100001).fill({ _id: "p" });
      const queryMock = buildQueryMock(largeData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-big",
        format: "csv",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-big")).rejects.toThrow(
        "maximum row limit",
      );
    });
  });

  // ───────────────────────────────────────────
  // getExportJobStatus()
  // ───────────────────────────────────────────
  describe("getExportJobStatus()", () => {
    it("should return job when found", async () => {
      const mockJob = { _id: "job-1", status: "completed" };
      ExportJob.findById.mockResolvedValue(mockJob);

      const result = await getExportJobStatus("job-1");
      expect(result).toEqual(mockJob);
    });

    it("should throw NOT_FOUND when job does not exist", async () => {
      ExportJob.findById.mockResolvedValue(null);

      await expect(getExportJobStatus("nonexistent")).rejects.toThrow(
        "Export job not found",
      );
    });
  });

  // ───────────────────────────────────────────
  // getExportFile()
  // ───────────────────────────────────────────
  describe("getExportFile()", () => {
    it("should return filePath and format for completed job", async () => {
      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "completed",
        format: "csv",
        result: { filePath: "/tmp/duxsoup-exports/job-1.csv" },
      });

      const result = await getExportFile("job-1");

      expect(result.filePath).toBe("/tmp/duxsoup-exports/job-1.csv");
      expect(result.format).toBe("csv");
    });

    it("should throw NOT_FOUND when job does not exist", async () => {
      ExportJob.findById.mockResolvedValue(null);

      await expect(getExportFile("nonexistent")).rejects.toThrow(
        "Export job not found",
      );
    });

    it("should throw NOT_READY when job is not completed", async () => {
      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "processing",
        format: "csv",
      });

      await expect(getExportFile("job-1")).rejects.toThrow("not ready");
    });

    it("should throw FILE_NOT_FOUND when filePath is missing", async () => {
      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "completed",
        format: "csv",
        result: {},
      });

      await expect(getExportFile("job-1")).rejects.toThrow(
        "Export file not found",
      );
    });

    it("should throw FILE_NOT_FOUND when file no longer exists on disk", async () => {
      const fs = require("fs");
      fs.promises.access.mockRejectedValue(new Error("ENOENT"));

      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "completed",
        format: "csv",
        result: { filePath: "/tmp/deleted.csv" },
      });

      await expect(getExportFile("job-1")).rejects.toThrow(
        "deleted or expired",
      );
    });
  });
});
