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
  },

  // Canonical internal ID (deterministic UUID derived from best identifier)
  canonical_id: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },

  // All known aliases for this company
  aliases: {
    type: [companyAliasSchema],
    default: [],
    index: true,
  },

  // Snapshot: Current canonical state of the company
  snapshot: {
    // Basic info
    name: String,
    industry: String,
    location: String,
    description: String,

    // URLs
    companyProfileUrl: String,
    website: String,

    // Metadata
    employeeCount: String,
    founded: String,
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
