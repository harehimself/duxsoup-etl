const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    duxsoupId: {
      type: String,
      required: true,
      unique: true,
    },
    visitTime: {
      type: Date,
      required: true,
    },
    profile: {
      type: String,
      required: true,
    },
    firstName: {
      type: String,
      required: true,
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
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Add indexes for better query performance
visitSchema.index({ duxsoupId: 1 });
visitSchema.index({ visitTime: 1 });
visitSchema.index({ profile: 1 });
visitSchema.index({ firstName: 1, lastName: 1 });

module.exports = mongoose.model("Visit", visitSchema);
