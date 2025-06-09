const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  // Matches "id" from Dux-Soup webhook
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Matches "ScanTime" from Dux-Soup webhook
  ScanTime: {
    type: Date,
    required: true,
    index: true
  },
  // Matches "Profile" from Dux-Soup webhook
  Profile: {
    type: String,
    required: true,
    index: true
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
  Company: String, // Added based on typical Dux-Soup scan data
  Title: String,   // Added based on typical Dux-Soup scan data
  Location: String,// Added based on typical Dux-Soup scan data
  Industry: String,// Added based on typical Dux-Soup scan data
  ConnectionDegree: String, // Changed to match Dux-Soup casing
  ProfileUrl: String, // Changed to match Dux-Soup casing (if it exists)
  
  // rawData should capture the entire original webhook payload
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    required: false // It's good to store raw data, but maybe not *always* required if you process other fields
  }
}, {
  timestamps: true // Keep this for createdAt and updatedAt
});

module.exports = mongoose.model('Scan', scanSchema);