const os = require('os');
const logger = require('../utils/logger');
const SchedulerLock = require('../models/schedulerLock');

const LOCK_ID = 'scheduler-leader';

/**
 * LeaderElectionService — MongoDB advisory lock for single-leader scheduling
 *
 * One instance acquires the lock atomically; others gracefully skip.
 * The lock auto-expires via TTL so a crashed leader doesn't hold it forever.
 */
class LeaderElectionService {
  /**
   * @param {Object} options
   * @param {string} options.instanceId  - Unique instance identifier
   * @param {number} options.ttlSeconds  - Lock time-to-live in seconds (default 30)
   * @param {number} options.renewIntervalSeconds - Renewal interval in seconds (default 10)
   */
  constructor({ instanceId, ttlSeconds = 30, renewIntervalSeconds = 10 } = {}) {
    if (!instanceId) {
      throw new Error('LeaderElectionService requires an instanceId');
    }
    this._instanceId = instanceId;
    this._ttlSeconds = ttlSeconds;
    this._renewIntervalSeconds = renewIntervalSeconds;
    this._isLeader = false;
    this._renewalTimer = null;
  }

  get isLeader() {
    return this._isLeader;
  }

  /**
   * Attempt to acquire the scheduler lock.
   * Succeeds if no lock exists or the existing lock has expired.
   * @returns {boolean} true if this instance is now the leader
   */
  async tryAcquire() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this._ttlSeconds * 1000);

    try {
      const result = await SchedulerLock.findOneAndUpdate(
        {
          _id: LOCK_ID,
          $or: [
            { expiresAt: { $lte: now } },  // expired
            { instanceId: this._instanceId }, // we already own it
          ],
        },
        {
          $set: {
            instanceId: this._instanceId,
            acquiredAt: now,
            expiresAt,
            lastRenewedAt: now,
            hostname: os.hostname(),
            pid: process.pid,
          },
        },
        { upsert: true, new: true },
      );

      if (result && result.instanceId === this._instanceId) {
        this._isLeader = true;
        logger.info('Leader election: acquired lock', {
          instanceId: this._instanceId,
          expiresAt: expiresAt.toISOString(),
        });
        return true;
      }
    } catch (err) {
      // E11000 duplicate key = another instance inserted first (race on upsert)
      if (err.code === 11000) {
        this._isLeader = false;
        logger.info('Leader election: another instance is leader', {
          instanceId: this._instanceId,
        });
        return false;
      }
      logger.error('Leader election: error acquiring lock', {
        instanceId: this._instanceId,
        error: err.message,
      });
    }

    this._isLeader = false;
    return false;
  }

  /**
   * Renew the lock's TTL. If we no longer own it, demote to follower.
   * @returns {boolean} true if renewal succeeded
   */
  async renew() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this._ttlSeconds * 1000);

    try {
      const result = await SchedulerLock.findOneAndUpdate(
        { _id: LOCK_ID, instanceId: this._instanceId },
        { $set: { expiresAt, lastRenewedAt: now } },
        { new: true },
      );

      if (result) {
        logger.debug('Leader election: lock renewed', {
          instanceId: this._instanceId,
          expiresAt: expiresAt.toISOString(),
        });
        return true;
      }

      // Lock no longer ours — another instance took over
      this._isLeader = false;
      logger.warn('Leader election: lost leadership during renewal', {
        instanceId: this._instanceId,
      });
      return false;
    } catch (err) {
      logger.error('Leader election: error renewing lock', {
        instanceId: this._instanceId,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Release the lock on graceful shutdown.
   */
  async release() {
    try {
      const result = await SchedulerLock.deleteOne({
        _id: LOCK_ID,
        instanceId: this._instanceId,
      });

      if (result.deletedCount > 0) {
        logger.info('Leader election: lock released', {
          instanceId: this._instanceId,
        });
      }
    } catch (err) {
      logger.error('Leader election: error releasing lock', {
        instanceId: this._instanceId,
        error: err.message,
      });
    }

    this._isLeader = false;
  }

  /**
   * Start the periodic renewal timer.
   */
  startRenewal() {
    if (this._renewalTimer) {
      return;
    }

    this._renewalTimer = setInterval(async () => {
      if (this._isLeader) {
        await this.renew();
      }
    }, this._renewIntervalSeconds * 1000);

    // Allow the Node process to exit even if the timer is running
    if (this._renewalTimer.unref) {
      this._renewalTimer.unref();
    }

    logger.debug('Leader election: renewal timer started', {
      intervalSeconds: this._renewIntervalSeconds,
    });
  }

  /**
   * Stop the periodic renewal timer.
   */
  stopRenewal() {
    if (this._renewalTimer) {
      clearInterval(this._renewalTimer);
      this._renewalTimer = null;
      logger.debug('Leader election: renewal timer stopped');
    }
  }
}

module.exports = LeaderElectionService;
