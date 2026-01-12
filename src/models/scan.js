const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
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
  // Matches "ScanTime" from Dux-Soup webhook
  ScanTime: {
    type: Date,
    required: true,
    index: true
  },
  // Matches "Profile" from Dux-Soup webhook
  // Note: Profile URLs are UNSTABLE and can change - not used for identity
  Profile: {
    type: String,
    required: false
  },
  // Matches "First Name" from Dux-Soup webhook (requires quotes)
  'First Name': {
    type: String,
    required: true
  },
  // Matches "Last Name" from Dux-Soup webhook (requires quotes)
  'Last Name': {
    type: String,
    required: true
  },
  // Fields that are present but not explicitly required in your schema (optional)
  'Middle Name': String,
  Company: String,
  CompanyID: String,
  Title: String,
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
  'Connection Degree': String,
  'Profile URL': String,
  PublicProfile: String,
  Degree: String,
  Picture: String,
  Connections: String,
  Summary: String,
  SalesProfile: String,
  RecruiterProfile: String,

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
}, {
  timestamps: true
});

// Compound indexes for common query patterns
scanSchema.index({ userid: 1, ScanTime: -1 }); // User-specific queries sorted by time
scanSchema.index({ Company: 1 }); // Company extraction queries
scanSchema.index({ Location: 1 }); // Location extraction queries
// Note: event_key index is created by unique: true in field definition above

module.exports = mongoose.model('Scan', scanSchema);