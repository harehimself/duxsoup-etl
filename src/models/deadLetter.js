const mongoose = require('mongoose');
const crypto = require('crypto');

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

const deadLetterSchema = new mongoose.Schema({
  // The observation that failed to upsert
  observation_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },

  // Source type: 'visit' or 'scan'
  sourceType: {
    type: String,
    required: true,
    enum: ['visit', 'scan'],
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
    enum: ['pending', 'replayed', 'failed_again', 'skipped'],
    default: 'pending',
    index: true,
  },

  // Replay attempt tracking
  replay_attempts: {
    type: Number,
    default: 0,
  },

  last_replay_at: Date,
  last_replay_error: String,

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
}, {
  timestamps: true,
});

// Indexes for querying and replay
deadLetterSchema.index({ status: 1, createdAt: -1 });
deadLetterSchema.index({ sourceType: 1, status: 1 });
deadLetterSchema.index({ observation_id: 1 }, { unique: true });

// Static method: Create from upsert failure
deadLetterSchema.statics.createFromFailure = async function(observationId, sourceType, error, identityHints, payload) {
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  try {
    return await this.create({
      observation_id: observationId,
      sourceType,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code || 'UNKNOWN',
      },
      identity_hints: identityHints || {},
      payload_hash: payloadHash,
      status: 'pending',
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
deadLetterSchema.statics.markReplayed = async function(observationId) {
  return await this.findOneAndUpdate(
    { observation_id: observationId },
    {
      status: 'replayed',
      last_replay_at: new Date(),
      $inc: { replay_attempts: 1 },
    },
    { new: true }
  );
};

// Static method: Mark replay failed
deadLetterSchema.statics.markReplayFailed = async function(observationId, error) {
  return await this.findOneAndUpdate(
    { observation_id: observationId },
    {
      status: 'failed_again',
      last_replay_at: new Date(),
      last_replay_error: error.message,
      $inc: { replay_attempts: 1 },
    },
    { new: true }
  );
};

module.exports = mongoose.model('DeadLetter', deadLetterSchema);
