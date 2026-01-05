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

  // Explicit company_id field (redundant but clear)
  company_id: {
    type: String,
    required: true,
    unique: true,
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

    // Last updated from observation
    lastObservedAt: Date,
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

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
companySchema.index({ 'aliases.value': 1 });
companySchema.index({ 'snapshot.name': 1 });
companySchema.index({ 'snapshot.lastObservedAt': -1 });
companySchema.index({ createdAt: -1 });

// Pre-save hook to ensure company_id matches _id
companySchema.pre('save', function(next) {
  if (this.isNew || this.isModified('_id')) {
    this.company_id = this._id;
  }
  next();
});

module.exports = mongoose.model('Company', companySchema);
