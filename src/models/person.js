const mongoose = require("mongoose");

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

const aliasSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "linkedInUsername",
        "salesNavId",
        "numericId",
        "duxsoupId",
        "profileUrl",
        "publicUrl",
        "salesUrl",
        "recruiterUrl",
      ],
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

const roleSchema = new mongoose.Schema(
  {
    title: String,
    companyId: String, // LinkedIn company numeric ID
    companyName: String,
    location: String,
    description: String,
    startDate: Date,
    endDate: {
      type: Date,
      validate: {
        validator: function (endDate) {
          // If endDate is provided and startDate exists, ensure endDate > startDate
          if (endDate && this.startDate) {
            return endDate >= this.startDate;
          }
          return true;
        },
        message: "endDate must be after or equal to startDate",
      },
    },
    isCurrent: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const educationSchema = new mongoose.Schema(
  {
    school: String,
    degree: String,
    field: String,
    startDate: Date,
    endDate: Date,
  },
  { _id: false },
);

const personSchema = new mongoose.Schema(
  {
    // Canonical person ID (Sales Navigator ID when available)
    // This is the stable identifier that NEVER changes
    _id: {
      type: String,
      required: true,
      validate: {
        validator: function (v) {
          if (!v || typeof v !== "string") return false;

          // Accept:
          // 1. Sales Nav IDs: AC[wo]AA[A-Z][rest] (case-insensitive)
          // 2. Numeric IDs: 8+ digits
          // 3. LinkedIn URLs: linkedin.com/in/username
          // 4. Bare usernames: 3-100 chars, alphanumeric/dash/underscore only (no @, no spaces)
          return (
            /^AC[wo]AA[A-Z][A-Za-z0-9_-]+$/i.test(v) ||
            /^\d{8,}$/.test(v) ||
            /^linkedin\.com\/in\/[\w-]+$/i.test(v) ||
            (/^[\w-]{3,100}$/.test(v) && !/[@\s]/.test(v))
          );
        },
        message: (props) =>
          `Invalid person ID format: ${props.value}. Must be Sales Nav ID, numeric ID (8+ digits), LinkedIn URL, or username`,
      },
    },

    // Canonical internal ID (deterministic UUID derived from best stable identifier)
    canonical_id: {
      type: String,
      required: true,
      unique: true, // unique constraint already creates an index
    },

    // All known aliases for this person
    // Used to match incoming webhooks and prevent duplicates
    aliases: {
      type: [aliasSchema],
      default: [],
    },

    // Snapshot: Current canonical state of the person
    snapshot: {
      // Basic info
      firstName: { type: String, maxlength: 100 },
      middleName: { type: String, maxlength: 100 },
      lastName: { type: String, maxlength: 100 },
      fullName: { type: String, maxlength: 300 },

      // Current position
      currentTitle: { type: String, maxlength: 200 },
      currentCompany: { type: String, maxlength: 200 },
      currentCompanyId: String,

      // Contact & profile
      location: { type: String, maxlength: 200 },
      industry: { type: String, maxlength: 100 },
      connections: { type: String, maxlength: 50 },
      summary: { type: String, maxlength: 5000 },
      email: { type: String, maxlength: 254 },
      phone: { type: String, maxlength: 50 },
      twitter: { type: String, maxlength: 100 },

      // Profile images
      profilePicture: { type: String, maxlength: 2000 },
      thumbnail: { type: String, maxlength: 2000 },

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
      personalWebsite: { type: String, maxlength: 2000 },
      companyWebsite: { type: String, maxlength: 2000 },

      // Connection degree
      degree: { type: String, maxlength: 20 },

      // Provenance metadata - tracks source of each field value
      // Structure: { fieldName: { value, observedAt, source, observationId } }
      _meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
    },

    // References to observation records (visits/scans)
    // Stored as separate documents for auditability
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

    // Metadata for tracking updates
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

    // Derived metrics (computed from roles)
    derived: {
      avgTenureMonths: Number,
      yearsAtCurrentCompany: Number,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries and identity resolution
// Critical: Multikey index for alias matching (supports findByAnyAlias)
personSchema.index({ "aliases.value": 1 });

// Optional: Compound index for type-specific alias lookups (better performance)
personSchema.index({ "aliases.type": 1, "aliases.value": 1 });

// Metadata indexes for sorting and tie-breaking
personSchema.index({ "meta.lastObservedAt": -1 });
personSchema.index({ "meta.observationsCount": -1 });

// Search and analysis indexes
personSchema.index({ "snapshot.fullName": 1 });
personSchema.index({ "snapshot.currentCompany": 1 });
personSchema.index({ createdAt: -1 });

// Note: DO NOT add uniqueness constraint on aliases.value
// Multiple people can temporarily share aliases during merges

module.exports = mongoose.model("Person", personSchema);
