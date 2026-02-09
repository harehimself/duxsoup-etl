const mongoose = require("mongoose");

/**
 * Change Model
 *
 * Tracks significant changes in person profiles:
 * - Job changes (company switches)
 * - Lateral moves (company switch at same seniority level)
 * - Promotions (title upgrades at same company)
 * - Title changes (title modifications)
 *
 * Used for warm lead identification and sales intelligence
 */

const changeSchema = new mongoose.Schema(
  {
    // Type of change
    type: {
      type: String,
      required: true,
      enum: ["company_change", "promotion", "title_change", "lateral_move"],
    },

    // Person who changed
    person_id: {
      type: String,
      required: true,
      ref: "Person",
      index: true,
    },

    // Person details (snapshot at time of change)
    personSnapshot: {
      fullName: String,
      currentTitle: String,
      currentCompany: String,
      connections: Number,
      city: String,
      state: String,
      country: String,
    },

    // Change details
    from: {
      type: String,
      required: true,
    }, // Old company/title

    to: {
      type: String,
      required: true,
    }, // New company/title

    company: String, // For promotions (company where promotion occurred)

    // Enriched change context
    fromCompanyId: String,
    toCompanyId: String,
    fromTitle: String,
    toTitle: String,
    seniority: String,
    seniorityRank: Number,
    tenureDaysAtPreviousRole: Number,

    // Rolling 90-day flag for "recent job change" queries
    recentJobChange: {
      type: Boolean,
      default: false,
    },
    recentJobChangeExpiresAt: Date,

    // When the change was detected
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    // Observation IDs that triggered this detection
    observations: {
      old: mongoose.Schema.Types.ObjectId,
      new: mongoose.Schema.Types.ObjectId,
    },

    // Alert/notification tracking
    notified: {
      type: Boolean,
      default: false,
    },

    notifiedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
changeSchema.index({ type: 1, timestamp: -1 });
changeSchema.index({ person_id: 1, type: 1 });
changeSchema.index({ notified: 1, timestamp: -1 }); // For pending notifications
changeSchema.index({ createdAt: -1 });
changeSchema.index({ recentJobChange: 1, timestamp: -1 });
changeSchema.index({ recentJobChangeExpiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for deduplication (prevent duplicate change records)
changeSchema.index(
  { person_id: 1, type: 1, from: 1, to: 1, timestamp: 1 },
  { unique: true },
);

module.exports = mongoose.model("Change", changeSchema);
