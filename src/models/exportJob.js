const mongoose = require("mongoose");

/**
 * Export Job Model
 *
 * Tracks async export jobs for CSV/JSON generation
 * Jobs are processed by the export worker in the background
 */

const exportJobSchema = new mongoose.Schema(
  {
    // Unique job ID (UUID)
    _id: {
      type: String,
      required: true,
    },

    // Entity type being exported
    entityType: {
      type: String,
      enum: ["people", "companies", "locations"],
      default: "people",
    },

    // Export format
    format: {
      type: String,
      required: true,
      enum: ["csv", "json"],
    },

    // Job status
    status: {
      type: String,
      required: true,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },

    // Query filters (same format as Query API)
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Fields to include in export
    fields: {
      type: [String],
      default: [],
    },

    // Result metadata
    result: {
      filePath: String, // Temporary file path
      fileSize: Number, // File size in bytes
      rowCount: Number, // Number of rows exported
      downloadUrl: String, // Download URL (relative)
    },

    // Error information (if failed)
    error: {
      code: String,
      message: String,
      stack: String,
    },

    // Processing timestamps
    startedAt: Date,
    completedAt: Date,

    // Expiration (jobs auto-delete after TTL)
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
exportJobSchema.index({ status: 1, createdAt: -1 });
exportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index (auto-delete)

module.exports = mongoose.model("ExportJob", exportJobSchema);
