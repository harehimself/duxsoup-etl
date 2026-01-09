const mongoose = require("mongoose");

/**
 * Location Model - Canonical representation of a location string
 *
 * Identity Resolution:
 * - Primary: normalized location slug
 * - Aliases: raw + normalized strings
 */

const locationAliasSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["raw", "normalized"],
    },
    value: {
      type: String,
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const locationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          // Accept normalized location slugs (lowercase with hyphens)
          return /^[a-z0-9-]+$/.test(v) && v.length >= 2;
        },
        message: (props) =>
          `Invalid location ID format: ${props.value}. Must be normalized slug (lowercase-with-hyphens, min 2 chars)`,
      },
    },

    canonical_id: {
      type: String,
      required: true,
      unique: true, // unique constraint already creates an index
    },

    aliases: {
      type: [locationAliasSchema],
      default: [],
    },

    snapshot: {
      name: { type: String, maxlength: 200 },
      normalized: { type: String, maxlength: 200 },

      // Structured location fields
      city: { type: String, maxlength: 100 },
      state: { type: String, maxlength: 100 },
      stateCode: { type: String, maxlength: 10 },
      country: { type: String, maxlength: 100 },
      countryCode: { type: String, maxlength: 10 },
      province: { type: String, maxlength: 100 },
      region: { type: String, maxlength: 100 },

      // Location type: 'city', 'metropolitan', 'unknown'
      locationType: { type: String, maxlength: 50 },
    },

    observations: {
      visits: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Visit" }],
        default: [],
      },
      scans: {
        type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Scan" }],
        default: [],
      },
    },

    meta: {
      lastObservedAt: Date,
      lastObservation: {
        type: {
          type: String,
          enum: ["visit", "scan"],
        },
        id: mongoose.Schema.Types.ObjectId,
        observedAt: Date,
      },
      observationsCount: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  },
);

locationSchema.index({ "aliases.value": 1 });
locationSchema.index({ "snapshot.normalized": 1 });
locationSchema.index({ "meta.lastObservedAt": -1 });
locationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Location", locationSchema);
