const mongoose = require('mongoose');

/**
 * Location Model - Canonical representation of a location string
 *
 * Identity Resolution:
 * - Primary: normalized location slug
 * - Aliases: raw + normalized strings
 */

const locationAliasSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['raw', 'normalized'],
  },
  value: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const locationSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },

  canonical_id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  aliases: {
    type: [locationAliasSchema],
    default: [],
    index: true,
  },

  snapshot: {
    name: String,
    normalized: String,
    country: String,
    region: String,
    city: String,
  },

  observations: {
    visits: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Visit' }],
      default: [],
    },
    scans: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Scan' }],
      default: [],
    },
  },

  meta: {
    lastObservedAt: Date,
    lastObservation: {
      type: {
        type: String,
        enum: ['visit', 'scan'],
      },
      id: mongoose.Schema.Types.ObjectId,
      observedAt: Date,
    },
    observationsCount: {
      type: Number,
      default: 0,
    },
  },
}, {
  timestamps: true,
});

locationSchema.index({ 'aliases.value': 1 });
locationSchema.index({ 'snapshot.normalized': 1 });
locationSchema.index({ 'meta.lastObservedAt': -1 });
locationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Location', locationSchema);
