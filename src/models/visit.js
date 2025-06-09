const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  duxsoupId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  visitTime: {
    type: Date,
    required: true,
    index: true
  },
  profile: {
    type: String,
    required: true,
    index: true
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

module.exports = mongoose.model('Visit', visitSchema);