const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;

// Set test export dir BEFORE requiring exportService (reads env at load time)
const TEST_EXPORT_DIR = "/tmp/duxsoup-exports-test";
process.env.EXPORT_TEMP_DIR = TEST_EXPORT_DIR;

const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const {
  createExportJob,
  processExportJob,
  getExportJobStatus,
  getExportFile,
} = require("../services/exportService");
const Person = require("../models/person");
const Company = require("../models/company");
const Location = require("../models/location");
const ExportJob = require("../models/exportJob");
const {
  buildCanonicalKey,
  computeCanonicalId,
} = require("../utils/identityMatcher");

// Silence logger during tests
jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function canonicalIdFor(type, value) {
  return computeCanonicalId(buildCanonicalKey(type, value));
}

// ─── Fixture builders ───────────────────────────────────────────────

let personCounter = 0;
function buildPerson(overrides = {}) {
  personCounter++;
  const id = overrides._id || `person-${personCounter}`;
  return {
    _id: id,
    canonical_id: canonicalIdFor("linkedInUsername", id),
    aliases: [{ type: "linkedInUsername", value: id }],
    ...overrides,
    snapshot: {
      firstName: `First${personCounter}`,
      lastName: `Last${personCounter}`,
      fullName: `First${personCounter} Last${personCounter}`,
      currentTitle: "Software Engineer",
      currentCompany: "Acme Corp",
      city: "San Francisco",
      state: "California",
      country: "United States",
      email: `person${personCounter}@example.com`,
      phone: "+1-555-0100",
      connections: 500,
      industry: "Technology",
      location: "San Francisco, CA",
      ...overrides.snapshot,
    },
    meta: {
      lastObservedAt: new Date("2025-01-15T10:00:00Z"),
      observationsCount: 1,
      ...overrides.meta,
    },
  };
}

let companyCounter = 0;
function buildCompany(overrides = {}) {
  companyCounter++;
  const id = overrides._id || `${82978330 + companyCounter}`;
  return {
    _id: id,
    canonical_id: canonicalIdFor("numericId", id),
    aliases: [{ type: "numericId", value: id }],
    ...overrides,
    snapshot: {
      name: `Company ${companyCounter}`,
      industry: "Technology",
      location: "San Francisco, CA",
      website: `https://company${companyCounter}.com`,
      employeeCount: "100-500",
      ...overrides.snapshot,
    },
    meta: {
      lastObservedAt: new Date("2025-01-15T10:00:00Z"),
      observationsCount: 1,
      ...overrides.meta,
    },
  };
}

let locationCounter = 0;
function buildLocation(overrides = {}) {
  locationCounter++;
  const id = overrides._id || `location-${locationCounter}`;
  return {
    _id: id,
    canonical_id: canonicalIdFor("location", id),
    aliases: [{ type: "normalized", value: id }],
    ...overrides,
    snapshot: {
      name: `Location ${locationCounter}`,
      city: "San Francisco",
      state: "California",
      country: "United States",
      countryCode: "US",
      locationType: "city",
      ...overrides.snapshot,
    },
    meta: {
      lastObservedAt: new Date("2025-01-15T10:00:00Z"),
      observationsCount: 1,
      ...overrides.meta,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

async function createAndProcess(params) {
  const job = await createExportJob(params);
  const processed = await processExportJob(job._id);
  return processed;
}

async function readExportFile(job) {
  return fs.readFile(job.result.filePath, "utf8");
}

function parseCsvRows(csv) {
  const lines = csv.trim().split("\n");
  return lines.map((line) => {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Export Stream Integration", () => {
  beforeAll(async () => {
    await connect();
    await fs.mkdir(TEST_EXPORT_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TEST_EXPORT_DIR, { recursive: true, force: true });
    await closeDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
    personCounter = 0;
    companyCounter = 0;
    locationCounter = 0;
  });

  afterEach(async () => {
    try {
      const files = await fs.readdir(TEST_EXPORT_DIR);
      await Promise.all(
        files.map((f) => fs.unlink(path.join(TEST_EXPORT_DIR, f))),
      );
    } catch (_err) {
      // Directory may not exist yet
    }
  });

  // ─── Core Pipeline ──────────────────────────────────────────────

  describe("Core Pipeline", () => {
    it("should export people to CSV with correct header and row count", async () => {
      await Person.create([buildPerson(), buildPerson(), buildPerson()]);

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows).toHaveLength(4);
      expect(rows[0]).toContain("firstName");
      expect(rows[0]).toContain("lastName");
      expect(rows[0]).toContain("currentTitle");
      expect(rows[0]).toContain("linkedInUrl");
      expect(job.result.rowCount).toBe(3);
    });

    it("should export people to JSON with correct array length and fields", async () => {
      await Person.create([buildPerson(), buildPerson()]);

      const job = await createAndProcess({
        format: "json",
        entityType: "people",
      });
      const content = await readExportFile(job);
      const data = JSON.parse(content);

      expect(data).toHaveLength(2);
      expect(data[0]).toHaveProperty("snapshot");
      expect(data[0].snapshot).toHaveProperty("firstName");
    });

    it("should export companies to CSV with company-specific headers", async () => {
      await Company.create([buildCompany(), buildCompany()]);

      const job = await createAndProcess({
        format: "csv",
        entityType: "companies",
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("name");
      expect(rows[0]).toContain("industry");
      expect(rows[0]).toContain("companyId");
      expect(rows[1]).toContain("Technology");
    });

    it("should export locations to JSON with valid location fields", async () => {
      await Location.create([buildLocation(), buildLocation()]);

      const job = await createAndProcess({
        format: "json",
        entityType: "locations",
      });
      const content = await readExportFile(job);
      const data = JSON.parse(content);

      expect(data).toHaveLength(2);
      expect(data[0]).toHaveProperty("snapshot");
      expect(data[0].snapshot).toHaveProperty("city");
      expect(data[0].snapshot).toHaveProperty("country");
    });

    it("should format linkedInUrl from bare username _id", async () => {
      await Person.create(buildPerson({ _id: "jane-doe" }));

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      const urlIndex = rows[0].indexOf("linkedInUrl");
      expect(rows[1][urlIndex]).toBe("https://linkedin.com/in/jane-doe");
    });

    it("should pass Sales Nav ID through as-is for linkedInUrl", async () => {
      await Person.create(buildPerson({ _id: "ACwAABjK8PoBZx4n" }));

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      const urlIndex = rows[0].indexOf("linkedInUrl");
      expect(rows[1][urlIndex]).toBe("ACwAABjK8PoBZx4n");
    });
  });

  // ─── Empty Results ──────────────────────────────────────────────

  describe("Empty Results", () => {
    it("should produce header-only CSV when no documents exist", async () => {
      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("firstName");
      expect(job.result.rowCount).toBe(0);
    });

    it("should produce empty JSON array when no documents exist", async () => {
      const job = await createAndProcess({
        format: "json",
        entityType: "people",
      });
      const content = await readExportFile(job);
      const data = JSON.parse(content);

      expect(data).toEqual([]);
    });
  });

  // ─── Filters ────────────────────────────────────────────────────

  describe("Filters", () => {
    it("should narrow results based on filter criteria", async () => {
      await Person.create([
        buildPerson({ snapshot: { country: "United States" } }),
        buildPerson({ snapshot: { country: "United States" } }),
        buildPerson({ snapshot: { country: "Canada" } }),
      ]);

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        filters: { "snapshot.country": "United States" },
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows).toHaveLength(3);
      expect(job.result.rowCount).toBe(2);
    });

    it("should return header-only CSV when filter matches nothing", async () => {
      await Person.create([buildPerson(), buildPerson()]);

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        filters: { "snapshot.country": "Nonexistentland" },
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows).toHaveLength(1);
      expect(job.result.rowCount).toBe(0);
    });
  });

  // ─── Custom Fields ──────────────────────────────────────────────

  describe("Custom Fields", () => {
    it("should export only the requested field subset", async () => {
      await Person.create(
        buildPerson({
          snapshot: {
            firstName: "Alice",
            email: "alice@example.com",
            lastName: "Wonder",
          },
        }),
      );

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        fields: ["firstName", "email"],
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows[0]).toEqual(["firstName", "email"]);
      expect(rows[1][0]).toBe("Alice");
      expect(rows[1][1]).toBe("alice@example.com");
      expect(rows[1]).toHaveLength(2);
    });
  });

  // ─── Data Integrity ─────────────────────────────────────────────

  describe("Data Integrity", () => {
    it("should properly escape CSV fields with commas, quotes, and newlines", async () => {
      await Person.create(
        buildPerson({
          snapshot: {
            currentTitle: 'VP, "Engineering"',
            currentCompany: "Line1\nLine2",
            firstName: "Normal",
            lastName: "Person",
          },
        }),
      );

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
      });
      const rawCsv = await readExportFile(job);

      expect(rawCsv).toContain('"VP, ""Engineering"""');
      expect(rawCsv).toContain('"Line1\nLine2"');
    });

    it("should extract nested snapshot fields from real Mongoose lean docs", async () => {
      await Person.create(
        buildPerson({
          snapshot: {
            firstName: "Nested",
            city: "Portland",
            country: "United States",
          },
        }),
      );

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        fields: ["firstName", "city", "country"],
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows[1][0]).toBe("Nested");
      expect(rows[1][1]).toBe("Portland");
      expect(rows[1][2]).toBe("United States");
    });

    it("should format dates as ISO 8601 strings in CSV", async () => {
      const observedAt = new Date("2025-03-15T14:30:00.000Z");
      await Person.create(
        buildPerson({
          meta: { lastObservedAt: observedAt, observationsCount: 1 },
        }),
      );

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        fields: ["firstName", "lastObservedAt"],
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows[1][1]).toBe("2025-03-15T14:30:00.000Z");
    });

    it("should render missing fields as empty strings, not 'undefined'", async () => {
      await Person.create({
        _id: "sparse-person",
        canonical_id: canonicalIdFor("linkedInUsername", "sparse-person"),
        aliases: [{ type: "linkedInUsername", value: "sparse-person" }],
        snapshot: { firstName: "Sparse" },
        meta: { lastObservedAt: new Date(), observationsCount: 1 },
      });

      const job = await createAndProcess({
        format: "csv",
        entityType: "people",
        fields: ["firstName", "email", "phone", "city"],
      });
      const csv = await readExportFile(job);
      const rows = parseCsvRows(csv);

      expect(rows[1][0]).toBe("Sparse");
      expect(rows[1][1]).toBe("");
      expect(rows[1][2]).toBe("");
      expect(rows[1][3]).toBe("");
      expect(csv).not.toContain("undefined");
    });
  });

  // ─── Row Limit ──────────────────────────────────────────────────

  describe("Row Limit", () => {
    it("should fail with EXPORT_TOO_LARGE when row limit exceeded", async () => {
      await Person.create([
        buildPerson(),
        buildPerson(),
        buildPerson(),
        buildPerson(),
        buildPerson(),
      ]);

      // Re-require exportService with low EXPORT_MAX_ROWS while keeping
      // the same mongoose connection by pinning mongoose and model modules.
      await jest.isolateModulesAsync(async () => {
        process.env.EXPORT_MAX_ROWS = "3";
        process.env.EXPORT_TEMP_DIR = TEST_EXPORT_DIR;

        // Pin shared mongoose/model singletons so the isolated service
        // uses the already-connected connection instead of a fresh one.
        jest.doMock("mongoose", () => require("mongoose"));
        jest.doMock("../models/person", () => Person);
        jest.doMock("../models/company", () => Company);
        jest.doMock("../models/location", () => Location);
        jest.doMock("../models/exportJob", () => ExportJob);

        const isolatedService = require("../services/exportService");
        const job = await isolatedService.createExportJob({
          format: "csv",
          entityType: "people",
        });

        await expect(
          isolatedService.processExportJob(job._id),
        ).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE" });

        // Verify temp file was cleaned up
        const filePath = path.join(TEST_EXPORT_DIR, `${job._id}.csv`);
        await expect(fs.access(filePath)).rejects.toThrow();

        delete process.env.EXPORT_MAX_ROWS;
      });
    });
  });

  // ─── Job Lifecycle ──────────────────────────────────────────────

  describe("Job Lifecycle", () => {
    it("should track full lifecycle from create to completed", async () => {
      await Person.create([buildPerson(), buildPerson()]);

      const job = await createExportJob({
        format: "csv",
        entityType: "people",
      });
      expect(job.status).toBe("pending");

      const processed = await processExportJob(job._id);
      expect(processed.status).toBe("completed");
      expect(processed.startedAt).toBeInstanceOf(Date);
      expect(processed.completedAt).toBeInstanceOf(Date);
      expect(processed.result.rowCount).toBe(2);
      expect(processed.result.fileSize).toBeGreaterThan(0);
      expect(processed.result.downloadUrl).toMatch(
        `/api/export/download/${job._id}`,
      );
    });

    it("should return correct status via getExportJobStatus", async () => {
      await Person.create(buildPerson());

      const job = await createExportJob({
        format: "csv",
        entityType: "people",
      });
      await processExportJob(job._id);

      const status = await getExportJobStatus(job._id);
      expect(status.status).toBe("completed");
      expect(status.result.rowCount).toBe(1);
    });

    it("should return file info via getExportFile", async () => {
      await Person.create(buildPerson());

      const job = await createExportJob({
        format: "json",
        entityType: "people",
      });
      await processExportJob(job._id);

      const fileInfo = await getExportFile(job._id);
      expect(fileInfo.format).toBe("json");
      expect(fileInfo.filePath).toMatch(/\.json$/);

      const stat = await fs.stat(fileInfo.filePath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────

  describe("Error Handling", () => {
    it("should throw INVALID_STATE when processing a non-pending job", async () => {
      const jobId = crypto.randomUUID();
      await ExportJob.create({
        _id: jobId,
        format: "csv",
        entityType: "people",
        status: "completed",
        fields: ["firstName"],
        expiresAt: new Date(Date.now() + 86400000),
        result: { rowCount: 0, fileSize: 0 },
      });

      await expect(processExportJob(jobId)).rejects.toMatchObject({
        code: "INVALID_STATE",
      });
    });
  });
});
