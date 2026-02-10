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

jest.mock("../../src/models/company", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/location", () => ({
  find: jest.fn(),
}));

jest.mock("../../src/models/exportJob", () => ({
  create: jest.fn(),
  findById: jest.fn(),
}));

jest.mock("../../src/utils/queryValidation", () => ({
  validateQuery: jest.fn((params) => params),
  checkForDangerousOperators: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { Readable } = require("stream");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const {
  createExportJob,
  processExportJob,
  getExportJobStatus,
  getExportFile,
  DEFAULT_CSV_FIELDS,
  PEOPLE_DEFAULT_CSV_FIELDS,
  COMPANY_DEFAULT_CSV_FIELDS,
  LOCATION_DEFAULT_CSV_FIELDS,
} = require("../../src/services/exportService");
const Person = require("../../src/models/person");
const Company = require("../../src/models/company");
const Location = require("../../src/models/location");
const ExportJob = require("../../src/models/exportJob");

const EXPORT_TEMP_DIR = process.env.EXPORT_TEMP_DIR || "/tmp/duxsoup-exports";

/**
 * Helper: create a mock Mongoose cursor (readable stream in object mode)
 */
function createMockCursor(docs = []) {
  return Readable.from(docs, { objectMode: true });
}

/**
 * Helper: chainable query mock that ends with .cursor()
 */
function buildQueryMock(docs = []) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    cursor: jest.fn(() => createMockCursor(docs)),
  };
}

describe("ExportService", () => {
  afterEach(async () => {
    jest.restoreAllMocks();
  });

  // ───────────────────────────────────────────
  // Backward compatibility
  // ───────────────────────────────────────────
  describe("exports", () => {
    it("should export DEFAULT_CSV_FIELDS as alias for PEOPLE_DEFAULT_CSV_FIELDS", () => {
      expect(DEFAULT_CSV_FIELDS).toBe(PEOPLE_DEFAULT_CSV_FIELDS);
    });
  });

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
        entityType: "people",
        fields: PEOPLE_DEFAULT_CSV_FIELDS,
        status: "pending",
      });

      const job = await createExportJob({ format: "csv" });

      expect(ExportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          format: "csv",
          entityType: "people",
          fields: PEOPLE_DEFAULT_CSV_FIELDS,
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

    it("should create company export job with company default fields", async () => {
      ExportJob.create.mockResolvedValue({
        _id: "job-co-1",
        format: "csv",
        entityType: "companies",
        fields: COMPANY_DEFAULT_CSV_FIELDS,
        status: "pending",
      });

      await createExportJob({ format: "csv", entityType: "companies" });

      expect(ExportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "companies",
          fields: COMPANY_DEFAULT_CSV_FIELDS,
        }),
      );
    });

    it("should create location export job with location default fields", async () => {
      ExportJob.create.mockResolvedValue({
        _id: "job-loc-1",
        format: "csv",
        entityType: "locations",
        fields: LOCATION_DEFAULT_CSV_FIELDS,
        status: "pending",
      });

      await createExportJob({ format: "csv", entityType: "locations" });

      expect(ExportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "locations",
          fields: LOCATION_DEFAULT_CSV_FIELDS,
        }),
      );
    });

    it("should throw INVALID_ENTITY_TYPE for unknown entity type", async () => {
      await expect(
        createExportJob({ format: "csv", entityType: "widgets" }),
      ).rejects.toThrow("Unknown entity type");
    });
  });

  // ───────────────────────────────────────────
  // processExportJob() — streaming
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

    it("should stream CSV job and update status to completed", async () => {
      const mockData = [
        { _id: "john-doe", snapshot: { firstName: "John", lastName: "Doe" } },
      ];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-csv",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName", "lastName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-csv");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(1);
      expect(jobDoc.result.fileSize).toBeGreaterThan(0);
      expect(jobDoc.save).toHaveBeenCalled();

      // Verify file was written
      const filePath = path.join(EXPORT_TEMP_DIR, "job-csv.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain("firstName,lastName");
      expect(content).toContain("John,Doe");

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should stream JSON job and update status to completed", async () => {
      const mockData = [
        { _id: "p1", snapshot: { firstName: "Alice" } },
        { _id: "p2", snapshot: { firstName: "Bob" } },
      ];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-json",
        format: "json",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-json");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(2);

      // Verify file is valid JSON array
      const filePath = path.join(EXPORT_TEMP_DIR, "job-json.json");
      const content = await fsp.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]._id).toBe("p1");

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should set status to failed when cursor errors", async () => {
      // Create a cursor that emits an error
      const errorCursor = new Readable({
        objectMode: true,
        read() {
          this.destroy(new Error("DB cursor error"));
        },
      });
      const queryMock = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        cursor: jest.fn(() => errorCursor),
      };
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-fail",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-fail")).rejects.toThrow(
        "DB cursor error",
      );
      expect(jobDoc.status).toBe("failed");
      expect(jobDoc.error.message).toBe("DB cursor error");
    });

    it("should clean up temp file when export fails", async () => {
      const errorCursor = new Readable({
        objectMode: true,
        read() {
          this.destroy(new Error("Query failed"));
        },
      });
      const queryMock = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        cursor: jest.fn(() => errorCursor),
      };
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-cleanup",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-cleanup")).rejects.toThrow(
        "Query failed",
      );

      // File should have been cleaned up
      const filePath = path.join(EXPORT_TEMP_DIR, "job-cleanup.csv");
      await expect(fsp.access(filePath)).rejects.toThrow();
    });

    it("should clean up JSON temp file when export fails", async () => {
      // Create cursor that emits one doc then errors
      const errorCursor = new Readable({
        objectMode: true,
        read() {
          this.push({ _id: "p1" });
          this.destroy(new Error("Disk full"));
        },
      });
      const queryMock = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        cursor: jest.fn(() => errorCursor),
      };
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-json-fail",
        format: "json",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-json-fail")).rejects.toThrow(
        "Disk full",
      );

      // File should have been cleaned up
      const filePath = path.join(EXPORT_TEMP_DIR, "job-json-fail.json");
      await expect(fsp.access(filePath)).rejects.toThrow();
    });

    it("should not clean up temp file on success", async () => {
      const queryMock = buildQueryMock([
        { _id: "p1", snapshot: { firstName: "Test" } },
      ]);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-ok",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-ok");

      // File should still exist
      const filePath = path.join(EXPORT_TEMP_DIR, "job-ok.csv");
      await expect(fsp.access(filePath)).resolves.toBeUndefined();

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should throw EXPORT_TOO_LARGE when streaming exceeds max rows", async () => {
      const docs = [];
      for (let i = 0; i < 100001; i++) {
        docs.push({ _id: `p${i}` });
      }
      const queryMock = buildQueryMock(docs);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-big",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await expect(processExportJob("job-big")).rejects.toThrow(
        "maximum row limit",
      );

      // Clean up
      const filePath = path.join(EXPORT_TEMP_DIR, "job-big.csv");
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should handle empty cursor (zero results)", async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-empty",
        format: "json",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-empty");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(0);

      // Verify file is empty JSON array
      const filePath = path.join(EXPORT_TEMP_DIR, "job-empty.json");
      const content = await fsp.readFile(filePath, "utf8");
      expect(JSON.parse(content)).toEqual([]);

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should write CSV header even when cursor returns zero documents", async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-empty-csv",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName", "lastName", "email"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-empty-csv");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(0);

      // Verify file contains header row but no data rows
      const filePath = path.join(EXPORT_TEMP_DIR, "job-empty-csv.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toBe("firstName,lastName,email\n");

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should escape CSV fields containing commas and quotes", async () => {
      const mockData = [
        {
          _id: "p1",
          snapshot: {
            firstName: 'John "Jack"',
            lastName: "Doe, Jr.",
          },
        },
      ];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-escape",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName", "lastName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-escape");

      const filePath = path.join(EXPORT_TEMP_DIR, "job-escape.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain('"John ""Jack"""');
      expect(content).toContain('"Doe, Jr."');

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should format linkedInUrl field from _id", async () => {
      const mockData = [{ _id: "jane-doe", snapshot: { firstName: "Jane" } }];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-url",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["firstName", "linkedInUrl"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-url");

      const filePath = path.join(EXPORT_TEMP_DIR, "job-url.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain("https://linkedin.com/in/jane-doe");

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    it("should format lastObservedAt as ISO string", async () => {
      const date = new Date("2025-06-15T12:00:00.000Z");
      const mockData = [{ _id: "p1", meta: { lastObservedAt: date } }];
      const queryMock = buildQueryMock(mockData);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-date",
        format: "csv",
        entityType: "people",
        status: "pending",
        filters: {},
        fields: ["lastObservedAt"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-date");

      const filePath = path.join(EXPORT_TEMP_DIR, "job-date.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain("2025-06-15T12:00:00.000Z");

      // Clean up
      await fsp.unlink(filePath).catch(() => {});
    });

    // ── Company export streaming ──────────────────────────────────────

    it("should stream company CSV export using Company model", async () => {
      const mockData = [
        {
          _id: "82978333",
          snapshot: { name: "Acme Corp", industry: "Technology" },
        },
      ];
      const queryMock = buildQueryMock(mockData);
      Company.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-co-csv",
        format: "csv",
        entityType: "companies",
        status: "pending",
        filters: {},
        fields: ["name", "industry", "companyId"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-co-csv");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(1);
      expect(Company.find).toHaveBeenCalled();

      const filePath = path.join(EXPORT_TEMP_DIR, "job-co-csv.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain("name,industry,companyId");
      expect(content).toContain("Acme Corp,Technology,82978333");

      await fsp.unlink(filePath).catch(() => {});
    });

    // ── Location export streaming ─────────────────────────────────────

    it("should stream location CSV export using Location model", async () => {
      const mockData = [
        {
          _id: "san-francisco-ca-us",
          snapshot: {
            name: "San Francisco, CA, US",
            city: "San Francisco",
            country: "United States",
          },
        },
      ];
      const queryMock = buildQueryMock(mockData);
      Location.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-loc-csv",
        format: "csv",
        entityType: "locations",
        status: "pending",
        filters: {},
        fields: ["name", "city", "country", "locationId"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-loc-csv");

      expect(jobDoc.status).toBe("completed");
      expect(jobDoc.result.rowCount).toBe(1);
      expect(Location.find).toHaveBeenCalled();

      const filePath = path.join(EXPORT_TEMP_DIR, "job-loc-csv.csv");
      const content = await fsp.readFile(filePath, "utf8");
      expect(content).toContain("name,city,country,locationId");
      expect(content).toContain("San Francisco");
      expect(content).toContain("san-francisco-ca-us");

      await fsp.unlink(filePath).catch(() => {});
    });

    it("should default entityType to people when not set on job", async () => {
      const queryMock = buildQueryMock([
        { _id: "p1", snapshot: { firstName: "Test" } },
      ]);
      Person.find.mockReturnValue(queryMock);

      const jobDoc = {
        _id: "job-legacy",
        format: "csv",
        // entityType NOT set (simulates old job records)
        status: "pending",
        filters: {},
        fields: ["firstName"],
        save: jest.fn().mockResolvedValue(undefined),
      };
      ExportJob.findById.mockResolvedValue(jobDoc);

      await processExportJob("job-legacy");

      expect(jobDoc.status).toBe("completed");
      expect(Person.find).toHaveBeenCalled();

      await fsp
        .unlink(path.join(EXPORT_TEMP_DIR, "job-legacy.csv"))
        .catch(() => {});
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
      // Create an actual file for the access check
      const testPath = path.join(EXPORT_TEMP_DIR, "job-dl.csv");
      await fsp.mkdir(EXPORT_TEMP_DIR, { recursive: true });
      await fsp.writeFile(testPath, "test", "utf8");

      ExportJob.findById.mockResolvedValue({
        _id: "job-dl",
        status: "completed",
        format: "csv",
        result: { filePath: testPath },
      });

      const result = await getExportFile("job-dl");

      expect(result.filePath).toBe(testPath);
      expect(result.format).toBe("csv");

      // Clean up
      await fsp.unlink(testPath).catch(() => {});
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
      ExportJob.findById.mockResolvedValue({
        _id: "job-1",
        status: "completed",
        format: "csv",
        result: { filePath: "/tmp/nonexistent-file-that-does-not-exist.csv" },
      });

      await expect(getExportFile("job-1")).rejects.toThrow(
        "deleted or expired",
      );
    });
  });
});
