const mongoose = require("mongoose");

const visitSchema = new mongoose.Schema(
  {
    // Matches "id" from Dux-Soup webhook
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Matches "VisitTime" from Dux-Soup webhook
    VisitTime: {
      type: Date,
      required: true,
      index: true,
    },
    // Matches "Profile" from Dux-Soup webhook
    Profile: {
      type: String,
      required: true,
      index: true,
    },
    // Matches "First Name" from Dux-Soup webhook (requires quotes)
    "First Name": {
      type: String,
      required: true,
    },
    // Matches "Last Name" from Dux-Soup webhook (requires quotes)
    "Last Name": String, // Not required by the logs, but present in sample

    // Matches "Degree" from Dux-Soup webhook
    Degree: String, // Changed from 'degree' to 'Degree'. Not in "missingFields", so keep optional.

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
    Industry: String,
    "My Tags": [String], // Array of strings, note the space
    extended: mongoose.Schema.Types.Mixed, // For nested complex data like positions, skills, schools
    "My Notes": String, // Note the space

    // rawData should capture the entire original webhook payload
    rawData: {
      type: mongoose.Schema.Types.Mixed,
      required: false, // It's good to store raw data, but maybe not *always* required if you process other fields
    },
  },
  {
    timestamps: true, // Keep this for createdAt and updatedAt
  }
);

module.exports = mongoose.model("Visit", visitSchema);
