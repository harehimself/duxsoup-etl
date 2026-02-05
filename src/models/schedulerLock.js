const mongoose = require('mongoose');

/**
 * SchedulerLock Model - Advisory lock for leader election
 *
 * Singleton document (_id: 'scheduler-leader') used as a lease.
 * One instance acquires it atomically via findOneAndUpdate+upsert;
 * others see it's held and skip. TTL index on expiresAt guarantees
 * automatic cleanup if the leader crashes without releasing.
 */

const schedulerLockSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: 'scheduler-leader',
  },

  instanceId: {
    type: String,
    required: true,
  },

  acquiredAt: {
    type: Date,
    required: true,
  },

  expiresAt: {
    type: Date,
    required: true,
  },

  lastRenewedAt: {
    type: Date,
  },

  hostname: {
    type: String,
  },

  pid: {
    type: Number,
  },
});

// TTL index: MongoDB deletes the document when expiresAt passes
schedulerLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SchedulerLock = mongoose.model('SchedulerLock', schedulerLockSchema);
module.exports = SchedulerLock;
