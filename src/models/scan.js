const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  // Original DuxSoup fields
  id: { type: String, required: true, unique: true },
  scanTime: { type: Date, required: true },
  profile: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  
  // Optional profile fields
  headline: String,
  location: String,
  connections: String,
  industry: String,
  summary: String,
  
  // Position data (normalized from Position-0-*, Position-1-*, etc.)
  positions: [{
    company: String,
    title: String,
    startDate: String,
    endDate: String,
    duration: String,
    location: String
  }],
  
  // Education data (normalized from School-0-*, School-1-*, etc.)
  education: [{
    school: String,
    degree: String,
    startYear: String,
    endYear: String
  }],
  
  // Skills (normalized from Skill-0, Skill-1, etc.)
  skills: [String],
  
  // Metadata
  processedAt: { type: Date, default: Date.now },
  source: { type: String, default: 'duxsoup' }
}, {
  timestamps: true
});

// Index for efficient querying
scanSchema.index({ profile: 1, scanTime: 1 });
scanSchema.index({ processedAt: 1 });
scanSchema.index({ firstName: 1, lastName: 1 });

module.exports = mongoose.model('Scan', scanSchema);