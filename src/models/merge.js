const mongoose = require('mongoose');

/**
 * Merge Model - Audit trail for person merges
 *
 * Tracks when duplicate people are merged into a single canonical record.
 * Critical for debugging identity resolution and compliance.
 */

const mergeSchema = new mongoose.Schema({
  // The person that was kept
  winner_id: {
    type: String,
    required: true,
    index: true,
  },

  // The people that were merged and deleted
  loser_ids: {
    type: [String],
    required: true,
  },

  // Why the merge happened
  reason: {
    type: String,
    required: true,
    enum: [
      'alias_conflict',
      'alias_conflict_detected',
      'manual_merge',
      'duplicate_detection',
    ],
  },

  // Source observation that triggered the merge
  sourceObservationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
  },

  // When the merge occurred
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },

  // Snapshots of loser documents before deletion (for rollback)
  loserSnapshots: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },

  // Snapshot of winner before merge (for rollback)
  winnerSnapshotBefore: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Whether this merge has been rolled back
  rolledBack: {
    type: Boolean,
    default: false,
  },

  rolledBackAt: {
    type: Date,
    default: null,
  },

  // Optional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
  },
}, {
  timestamps: true,
});

// Indexes for audit queries
mergeSchema.index({ winner_id: 1, timestamp: -1 });
mergeSchema.index({ loser_ids: 1 });
mergeSchema.index({ timestamp: -1 });

module.exports = mongoose.model('Merge', mergeSchema);
