const fs = require("fs").promises;
const path = require("path");
const os = require("os");

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require("../../../src/utils/logger");
const {
  cleanupExpiredExports,
} = require("../../../src/workers/jobs/exportCleanup");

describe("exportCleanup", () => {
  let testDir;
  let originalExportTempDir;
  let originalExportTtlHours;

  beforeEach(async () => {
    originalExportTempDir = process.env.EXPORT_TEMP_DIR;
    originalExportTtlHours = process.env.EXPORT_TTL_HOURS;

    testDir = path.join(os.tmpdir(), `export-cleanup-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    process.env.EXPORT_TEMP_DIR = testDir;
    process.env.EXPORT_TTL_HOURS = "1";
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    if (originalExportTempDir !== undefined) {
      process.env.EXPORT_TEMP_DIR = originalExportTempDir;
    } else {
      delete process.env.EXPORT_TEMP_DIR;
    }
    if (originalExportTtlHours !== undefined) {
      process.env.EXPORT_TTL_HOURS = originalExportTtlHours;
    } else {
      delete process.env.EXPORT_TTL_HOURS;
    }
  });

  it("should delete files older than TTL", async () => {
    const oldFile = path.join(testDir, "old-export.csv");
    await fs.writeFile(oldFile, "data");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(oldFile, twoHoursAgo, twoHoursAgo);

    const stats = await cleanupExpiredExports();

    expect(stats.deleted).toBe(1);
    expect(stats.scanned).toBe(1);
    await expect(fs.access(oldFile)).rejects.toThrow();
  });

  it("should skip files newer than TTL", async () => {
    const newFile = path.join(testDir, "new-export.csv");
    await fs.writeFile(newFile, "data");

    const stats = await cleanupExpiredExports();

    expect(stats.deleted).toBe(0);
    expect(stats.scanned).toBe(1);
    await expect(fs.access(newFile)).resolves.toBeUndefined();
  });

  it("should handle missing directory gracefully", async () => {
    process.env.EXPORT_TEMP_DIR = path.join(
      os.tmpdir(),
      "nonexistent-cleanup-dir-" + Date.now(),
    );

    const stats = await cleanupExpiredExports();

    expect(stats).toEqual({ scanned: 0, deleted: 0, errors: 0, skipped: 0 });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
      expect.any(Object),
    );
  });

  it("should skip subdirectories", async () => {
    const subDir = path.join(testDir, "subdir");
    await fs.mkdir(subDir);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(subDir, twoHoursAgo, twoHoursAgo);

    const stats = await cleanupExpiredExports();

    expect(stats.skipped).toBe(1);
    expect(stats.deleted).toBe(0);
    await expect(fs.access(subDir)).resolves.toBeUndefined();
  });

  it("should continue on per-file errors and report them", async () => {
    // Create a file, then replace it with a symlink pointing nowhere
    // so stat() fails with ENOENT
    const badLink = path.join(testDir, "broken-link.csv");
    await fs.symlink("/tmp/nonexistent-target-" + Date.now(), badLink);

    const goodFile = path.join(testDir, "good-file.csv");
    await fs.writeFile(goodFile, "data");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(goodFile, twoHoursAgo, twoHoursAgo);

    const stats = await cleanupExpiredExports();

    expect(stats.errors).toBe(1);
    expect(stats.deleted).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("error processing file"),
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("should handle mix of old and new files", async () => {
    const oldFile = path.join(testDir, "old.csv");
    const newFile = path.join(testDir, "new.json");
    await fs.writeFile(oldFile, "old data");
    await fs.writeFile(newFile, "new data");

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(oldFile, twoHoursAgo, twoHoursAgo);

    const stats = await cleanupExpiredExports();

    expect(stats.scanned).toBe(2);
    expect(stats.deleted).toBe(1);
    await expect(fs.access(oldFile)).rejects.toThrow();
    await expect(fs.access(newFile)).resolves.toBeUndefined();
  });
});
