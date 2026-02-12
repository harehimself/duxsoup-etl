const mongoose = require("mongoose");

/**
 * Company Model - Canonical representation of a LinkedIn company
 *
 * Architecture: Observation-Snapshot Pattern
 * - This is the SNAPSHOT (canonical state)
 * - Companies are updated from observations (visits/scans)
 *
 * Identity Resolution:
 * - Primary: LinkedIn company numeric ID (CompanyID field from scans)
 * - Aliases: Company profile URLs, names
 */

const companyAliasSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["numericId", "profileUrl", "name"],
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

const companySchema = new mongoose.Schema(
  {
    // Canonical company ID (LinkedIn numeric company ID from CompanyID field)
    // Example: "82978333" extracted from linkedin.com/company/82978333
    // This is STABLE and never changes
    _id: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          // Accept only numeric company IDs (LinkedIn company numeric ID)
          return /^\d+$/.test(v);
        },
        message: (props) =>
          `Invalid company ID format: ${props.value}. Must be numeric LinkedIn company ID (e.g., "82978333")`,
      },
    },

    // Canonical internal ID (deterministic UUID derived from best identifier)
    canonical_id: {
      type: String,
      unique: true, // unique constraint already creates an index
      sparse: true,
    },

    // All known aliases for this company
    aliases: {
      type: [companyAliasSchema],
      default: [],
    },

    // Snapshot: Current canonical state of the company
    snapshot: {
      // Basic info
      name: { type: String, maxlength: 200 },
      industry: { type: String, maxlength: 100 },
      location: { type: String, maxlength: 200 },

      // Structured location fields (parsed from location string)
      city: { type: String, maxlength: 100 },
      state: { type: String, maxlength: 100 },
      stateCode: { type: String, maxlength: 10 },
      country: { type: String, maxlength: 100 },
      countryCode: { type: String, maxlength: 10 },
      province: { type: String, maxlength: 100 },
      region: { type: String, maxlength: 100 },
      locationType: { type: String, maxlength: 50 },

      // US region categorization (derived from stateCode)
      usRegion: { type: String, maxlength: 50 },
      usSubregion: { type: String, maxlength: 50 },
      timezone: { type: String, maxlength: 50 },
      utcOffset: { type: Number, min: -12, max: 14 },

      description: { type: String, maxlength: 5000 },

      // URLs
      companyProfileUrl: { type: String, maxlength: 2000 },
      website: { type: String, maxlength: 2000 },

      // Metadata
      employeeCount: { type: String, maxlength: 50 },
      founded: { type: String, maxlength: 50 },

      // Per-field provenance: { fieldName: { value, observedAt, source, observationId } }
      _meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    // References to observations where this company appeared
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

// Indexes for efficient queries
companySchema.index({ "aliases.value": 1 });
companySchema.index({ "snapshot.name": 1 });
companySchema.index({ createdAt: -1 });
companySchema.index({ "meta.lastObservedAt": -1 });
companySchema.index({ "meta.observationsCount": -1 });
companySchema.index({ "snapshot.industry": 1 });

module.exports = mongoose.model("Company", companySchema);
