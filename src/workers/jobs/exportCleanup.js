const fs = require("fs").promises;
const path = require("path");
const logger = require("../../utils/logger");

/**
 * Clean up expired export files from the temp directory.
 *
 * Deletes files whose mtime is older than EXPORT_TTL_HOURS.
 * Skips subdirectories, isolates per-file errors so one bad file
 * doesn't abort the entire cleanup pass.
 *
 * Config is read at call time (not module load) so env overrides
 * take effect without restarting the process.
 *
 * @returns {Promise<{scanned: number, deleted: number, errors: number, skipped: number}>}
 */
async function cleanupExpiredExports() {
  const exportTempDir = process.env.EXPORT_TEMP_DIR || "/tmp/duxsoup-exports";
  const exportTtlHours = parseInt(process.env.EXPORT_TTL_HOURS || "24", 10);

  const stats = { scanned: 0, deleted: 0, errors: 0, skipped: 0 };
  const cutoff = Date.now() - exportTtlHours * 60 * 60 * 1000;

  let entries;
  try {
    entries = await fs.readdir(exportTempDir);
  } catch (err) {
    if (err.code === "ENOENT") {
      logger.info(
        "Export cleanup: temp directory does not exist, nothing to do",
        { dir: exportTempDir },
      );
      return stats;
    }
    throw err;
  }

  for (const entry of entries) {
    stats.scanned++;
    const filePath = path.join(exportTempDir, entry);

    try {
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        stats.skipped++;
        continue;
      }

      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        stats.deleted++;
      }
    } catch (err) {
      stats.errors++;
      logger.error("Export cleanup: error processing file", {
        file: filePath,
        error: err.message,
      });
    }
  }

  return stats;
}

module.exports = { cleanupExpiredExports };
