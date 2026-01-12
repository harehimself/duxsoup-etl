const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    // Matches "id" from Dux-Soup webhook
    id: {
      type: String,
      required: true,
      index: true,
      // --- ADDED CUSTOM VALIDATOR HERE ---
      validate: {
        validator: function(v) {
          // Ensures 'v' exists, is a string, and is not just whitespace
          return v && typeof v === 'string' && v.trim().length > 0;
        },
        message: props => `${props.value} is not a valid DuxSoup ID. It must be a non-empty string.`,
      },
      // --- END CUSTOM VALIDATOR ---
    },
    // Matches "VisitTime" from Dux-Soup webhook
    VisitTime: {
      type: Date,
      required: true,
      index: true,
    },
    // Matches "Profile" from Dux-Soup webhook
    // Note: Profile URLs are UNSTABLE and can change - not used for identity
    Profile: {
      type: String,
      required: false,
    },
    // Matches "First Name" from Dux-Soup webhook (requires quotes)
    "First Name": {
      type: String,
      required: true,
    },
    // Matches "Last Name" from Dux-Soup webhook (requires quotes)
    "Last Name": String, // Not required by the logs, but present in sample

    // Matches "Degree" from Dux-Soup webhook
    Degree: {
      type: String,
      required: true,
    },

    // All other fields from your sample, matching their exact casing
    SalesProfile: String,
    RecruiterProfile: String,
    Picture: String,
    "Middle Name": String, // Note the space
    Connections: String,
    Summary: String,
    Title: String,
    From: String,
    Company: String,
    CompanyProfile: String,
    CompanyWebsite: String,
    PersonalWebsite: String,
    Email: String,
    Phone: String,
    IM: String,
    Twitter: String,
    Location: String,

    // Structured location fields (parsed from Location string)
    city: { type: String, maxlength: 100 },
    state: { type: String, maxlength: 100 },
    stateCode: { type: String, maxlength: 10 },
    country: { type: String, maxlength: 100 },
    countryCode: { type: String, maxlength: 10 },
    province: { type: String, maxlength: 100 },
    region: { type: String, maxlength: 100 },
    locationType: { type: String, maxlength: 50 },

    Industry: String,
    "My Tags": [String], // Array of strings, note the space
    extended: mongoose.Schema.Types.Mixed, // For nested complex data like positions, skills, schools
    "My Notes": mongoose.Schema.Types.Mixed, // Changed to Mixed to accommodate both String and Array types

    // Metadata fields from top-level webhook payload
    userid: String, // DuxSoup user ID who performed the visit
    time: Date, // Event creation timestamp
    type: String, // Event type (e.g., "visit")
    event: String, // Event stage (e.g., "create" or "update")
    messagecontext: String, // Message context identifier

    // rawData should capture the entire original webhook payload
    rawData: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow null/undefined
          try {
            const size = JSON.stringify(v).length;
            return size <= 1000000; // Max 1MB serialized size
          } catch (e) {
            return false; // Invalid JSON
          }
        },
        message: 'rawData exceeds maximum size of 1MB'
      }
    },

    // Idempotency key to prevent duplicate observations
    // Computed from: sha1(userid + type + time + id)
    //
    // Note: sparse index allows null values for backwards compatibility with legacy data.
    // Future consideration: Run migration to backfill missing event_key values and remove sparse flag.
    // Until then, multiple documents can have event_key: null (breaks idempotency for those records).
    event_key: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: true, // Keep this for createdAt and updatedAt
  }
);

// Compound indexes for common query patterns
visitSchema.index({ userid: 1, VisitTime: -1 }); // User-specific queries sorted by time
visitSchema.index({ Company: 1 }); // Company extraction queries
visitSchema.index({ Location: 1 }); // Location extraction queries
// Note: event_key index is created by unique: true in field definition above

module.exports = mongoose.model("Visit", visitSchema);