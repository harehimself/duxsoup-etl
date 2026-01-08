const mongoose = require('mongoose');

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

const companyAliasSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['numericId', 'profileUrl', 'name'],
  },
  value: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const companySchema = new mongoose.Schema({
  // Canonical company ID (LinkedIn numeric company ID)
  _id: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        // Accept numeric company IDs (1+ digits), profile URLs, or normalized company names
        return /^\d+$/.test(v) ||
               /^linkedin\.com\/company\/[\w-]+$/.test(v) ||
               /^[a-z0-9-]+$/.test(v);
      },
      message: props => `Invalid company ID format: ${props.value}. Must be numeric ID, normalized URL (linkedin.com/company/*), or normalized name (lowercase-with-dashes)`
    }
  },

  // Canonical internal ID (deterministic UUID derived from best identifier)
  canonical_id: {
    type: String,
    unique: true,  // unique constraint already creates an index
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
    description: { type: String, maxlength: 5000 },

    // URLs
    companyProfileUrl: { type: String, maxlength: 2000 },
    website: { type: String, maxlength: 2000 },

    // Metadata
    employeeCount: { type: String, maxlength: 50 },
    founded: { type: String, maxlength: 50 },
  },

  // References to observations where this company appeared
  observations: {
    visits: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Visit' }],
      default: [],
    },
    scans: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Scan' }],
      default: [],
    },
  },

  meta: {
    lastObservedAt: Date,
    lastObservation: {
      type: {
        type: String,
        enum: ['visit', 'scan'],
      },
      id: mongoose.Schema.Types.ObjectId,
      observedAt: Date,
    },
    observationsCount: {
      type: Number,
      default: 0,
    },
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
companySchema.index({ 'aliases.value': 1 });
companySchema.index({ 'snapshot.name': 1 });
companySchema.index({ createdAt: -1 });
companySchema.index({ 'meta.lastObservedAt': -1 });
companySchema.index({ 'meta.observationsCount': -1 });

module.exports = mongoose.model('Company', companySchema);
