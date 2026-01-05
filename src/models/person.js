const mongoose = require('mongoose');

/**
 * Person Model - Canonical representation of a LinkedIn person
 *
 * Architecture: Observation-Snapshot Pattern
 * - This is the SNAPSHOT (canonical state)
 * - Visits and Scans are OBSERVATIONS (immutable event logs)
 *
 * Identity Resolution:
 * - Primary: Sales Navigator person ID (ACwAAABCDEF format)
 * - Fallback 1: LinkedIn numeric ID (member ID)
 * - Fallback 2: Profile URL (temporary, unstable)
 *
 * Aliases track all known identifiers to prevent duplicates when URLs change
 */

const aliasSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['salesNavId', 'numericId', 'publicUrl', 'salesUrl', 'recruiterUrl'],
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

const roleSchema = new mongoose.Schema({
  title: String,
  companyId: String, // LinkedIn company numeric ID
  companyName: String,
  location: String,
  description: String,
  startDate: Date,
  endDate: Date,
  isCurrent: {
    type: Boolean,
    default: false,
  },
}, { _id: false });

const educationSchema = new mongoose.Schema({
  school: String,
  degree: String,
  field: String,
  startDate: Date,
  endDate: Date,
}, { _id: false });

const personSchema = new mongoose.Schema({
  // Canonical person ID (Sales Navigator ID when available)
  // This is the stable identifier that NEVER changes
  _id: {
    type: String,
    required: true,
  },

  // Explicit person_id field (redundant but clear)
  person_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // All known aliases for this person
  // Used to match incoming webhooks and prevent duplicates
  aliases: {
    type: [aliasSchema],
    default: [],
    index: true,
  },

  // Snapshot: Current canonical state of the person
  snapshot: {
    // Basic info
    firstName: String,
    middleName: String,
    lastName: String,
    fullName: String,

    // Current position
    currentTitle: String,
    currentCompany: String,
    currentCompanyId: String,

    // Contact & profile
    location: String,
    industry: String,
    connections: String,
    summary: String,
    email: String,
    phone: String,
    twitter: String,

    // Profile images
    profilePicture: String,
    thumbnail: String,

    // Professional history
    roles: {
      type: [roleSchema],
      default: [],
    },

    // Education
    education: {
      type: [educationSchema],
      default: [],
    },

    // Skills
    skills: {
      type: [String],
      default: [],
    },

    // Websites
    personalWebsite: String,
    companyWebsite: String,

    // Connection degree
    degree: String,

    // Last updated from observation
    lastObservedAt: Date,
  },

  // References to observation records (visits/scans)
  // Stored as separate documents for auditability
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

  // Metadata for tracking updates
  meta: {
    last_observed_at: Date,
    last_observation: {
      type: {
        type: String,
        enum: ['visit', 'scan'],
      },
      id: mongoose.Schema.Types.ObjectId,
      observed_at: Date,
    },
    observations_count: {
      type: Number,
      default: 0,
    },
  },

  // Derived metrics (computed from roles)
  derived: {
    avg_tenure_months: Number,
    years_at_current_company: Number,
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

// Indexes for efficient queries and identity resolution
// Critical: Multikey index for alias matching (supports findByAnyAlias)
personSchema.index({ 'aliases.value': 1 });

// Optional: Compound index for type-specific alias lookups (better performance)
personSchema.index({ 'aliases.type': 1, 'aliases.value': 1 });

// Metadata indexes for sorting and tie-breaking
personSchema.index({ 'meta.last_observed_at': -1 });
personSchema.index({ 'meta.observations_count': -1 });

// Search and analysis indexes
personSchema.index({ 'snapshot.fullName': 1 });
personSchema.index({ 'snapshot.currentCompany': 1 });
personSchema.index({ createdAt: -1 });

// Note: DO NOT add uniqueness constraint on aliases.value
// Multiple people can temporarily share aliases during merges

// Pre-save hook to ensure person_id matches _id
personSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('_id')) {
    this.person_id = this._id;
  }
  next();
});

module.exports = mongoose.model('Person', personSchema);
