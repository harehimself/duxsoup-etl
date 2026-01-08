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
    required: false
  },

  // Idempotency key to prevent duplicate observations
  // Computed from: sha1(userid + type + time + id)
  event_key: {
    type: String,
    unique: true,
    sparse: true, // Allow null for backwards compatibility
    index: true,
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('Scan', scanSchema);