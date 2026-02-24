const mongoose = require("mongoose");
const crypto = require("crypto");
const { stableStringify } = require("../utils/stableStringify");
const { calculateNextReplayAt } = require("../utils/backoff");
const { MAX_RETRY_ATTEMPTS } = require("../constants/limits");
const { classifyError } = require("../utils/errorClassifier");

/**
 * DeadLetter Model - Failed person upserts for replay
 *
 * When PersonController.upsertFromObservation() fails, we log it here
 * so we can replay/recover without re-scraping LinkedIn.
 *
 * Operational use cases:
 * - Bug fixes: replay after fixing identity resolution logic
 * - Incident recovery: replay after DB outage
 * - Data quality: inspect failures and fix edge cases
 */

const deadLetterSchema = new mongoose.Schema(
  {
    // The observation that failed to upsert
    observation_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // Note: unique index is created by schema.index() below
    },

    // Source type: 'visit' or 'scan'
    sourceType: {
      type: String,
      required: true,
      enum: ["visit", "scan"],
      index: true,
    },

    // Error details
    error: {
      message: String,
      stack: String,
      code: String,
    },

    // Identity hints (for debugging)
    identity_hints: {
      person_id: String,
      source: String,
      sales_nav_id: String,
      numeric_id: String,
      public_url: String,
    },

    // Hash of payload for deduplication
    payload_hash: {
      type: String,
      required: true,
      index: true,
    },

    // Status for replay tracking
    status: {
      type: String,
      enum: [
        "pending",
        "replayed",
        "failed_again",
        "skipped",
        "permanently_failed",
      ],
      default: "pending",
      index: true,
    },

    // Error classification for smart replay
    errorClass: {
      type: String,
      enum: ["transient", "permanent"],
      index: true,
    },

    // Replay attempt tracking
    replay_attempts: {
      type: Number,
      default: 0,
    },

    last_replay_at: Date,
    last_replay_error: String,
    next_replay_at: Date,

    // When this failed
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for querying and replay
deadLetterSchema.index({ status: 1, createdAt: -1 });
deadLetterSchema.index({ sourceType: 1, status: 1 });
deadLetterSchema.index({ observation_id: 1 }, { unique: true });
deadLetterSchema.index({ status: 1, errorClass: 1, next_replay_at: 1 });

// Static method: Create from upsert failure
deadLetterSchema.statics.createFromFailure = async function (
  observationId,
  sourceType,
  error,
  identityHints,
  payload,
) {
  const payloadHash = crypto
    .createHash("sha256")
    .update(stableStringify(payload))
    .digest("hex");

  try {
    return await this.create({
      observation_id: observationId,
      sourceType,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code || "UNKNOWN",
      },
      identity_hints: identityHints || {},
      payload_hash: payloadHash,
      status: "pending",
      errorClass: classifyError(error.message),
    });
  } catch (err) {
    // If duplicate, it's already logged - skip
    if (err.code === 11000) {
      return null;
    }
    throw err;
  }
};

// Static method: Mark as replayed
deadLetterSchema.statics.markReplayed = async function (observationId) {
  return await this.findOneAndUpdate(
    { observation_id: observationId },
    {
      status: "replayed",
      last_replay_at: new Date(),
      $inc: { replay_attempts: 1 },
    },
    { returnDocument: "after" },
  );
};

// Static method: Mark replay failed (with exponential backoff / permanent failure)
deadLetterSchema.statics.markReplayFailed = async function (
  observationId,
  error,
) {
  const doc = await this.findOne({ observation_id: observationId });
  if (!doc) return null;

  const newAttempts = doc.replay_attempts + 1;
  const now = new Date();
  const errorClass = classifyError(error.message);

  // Fast-track permanent errors — skip remaining retries
  if (errorClass === "permanent" || newAttempts >= MAX_RETRY_ATTEMPTS) {
    return await this.findOneAndUpdate(
      { observation_id: observationId },
      {
        status: "permanently_failed",
        last_replay_at: now,
        last_replay_error: error.message,
        replay_attempts: newAttempts,
        errorClass,
        next_replay_at: null,
      },
      { returnDocument: "after" },
    );
  }

  const nextReplayAt = calculateNextReplayAt(now, newAttempts);
  return await this.findOneAndUpdate(
    { observation_id: observationId },
    {
      status: "failed_again",
      last_replay_at: now,
      last_replay_error: error.message,
      replay_attempts: newAttempts,
      errorClass,
      next_replay_at: nextReplayAt,
    },
    { returnDocument: "after" },
  );
};

// Static method: Find records eligible for replay (backoff-aware, skips permanent)
deadLetterSchema.statics.findEligibleForReplay = async function (limit = 100) {
  const now = new Date();
  return await this.find({
    status: { $in: ["pending", "failed_again"] },
    errorClass: { $ne: "permanent" },
    replay_attempts: { $lt: MAX_RETRY_ATTEMPTS },
    $or: [
      { next_replay_at: null },
      { next_replay_at: { $exists: false } },
      { next_replay_at: { $lte: now } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit);
};

// Static method: Count records eligible for replay (skips permanent)
deadLetterSchema.statics.countEligibleForReplay = async function () {
  const now = new Date();
  return await this.countDocuments({
    status: { $in: ["pending", "failed_again"] },
    errorClass: { $ne: "permanent" },
    replay_attempts: { $lt: MAX_RETRY_ATTEMPTS },
    $or: [
      { next_replay_at: null },
      { next_replay_at: { $exists: false } },
      { next_replay_at: { $lte: now } },
    ],
  });
};

module.exports = mongoose.model("DeadLetter", deadLetterSchema);
