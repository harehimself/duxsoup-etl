const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  duxsoupId: {
    type: String,
    required: true,
    unique: true
  },
  visitTime: {
    type: Date,
    required: true
  },
  profile: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: String,
  degree: String,
  company: String,
  title: String,
  location: String,
  industry: String,
  connectionDegree: String,
  profileUrl: String,
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, {
  timestamps: true
});

// Add indexes for better query performance
visitSchema.index({ duxsoupId: 1 });
visitSchema.index({ visitTime: 1 });
visitSchema.index({ profile: 1 });
visitSchema.index({ firstName: 1, lastName: 1 });

module.exports = mongoose.model('Visit', visitSchema);
"@ | Out-File "src\models\Visit.js" -Encoding utf8

# Create Scan model
@"
const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  duxsoupId: {
    type: String,
    required: true,
    unique: true
  },
  scanTime: {
    type: Date,
    required: true
  },
  profile: {
    type: String,
    required: true
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  company: String,
  title: String,
  location: String,
  industry: String,
  connectionDegree: String,
  profileUrl: String,
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, {
  timestamps: true
});

// Add indexes for better query performance
scanSchema.index({ duxsoupId: 1 });
scanSchema.index({ scanTime: 1 });
scanSchema.index({ profile: 1 });
scanSchema.index({ firstName: 1, lastName: 1 });

module.exports = mongoose.model('Scan', scanSchema);