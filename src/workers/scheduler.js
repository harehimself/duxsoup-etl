const cron = require('node-cron');
const logger = require('../utils/logger');

/**
 * Background Job Scheduler
 *
 * Automates recurring tasks:
 * - Dead letter replay: Every 1 hour
 * - Health check: Every 6 hours
 */

let schedulerStarted = false;

/**
 * Start background scheduler
 *
 * Initializes all cron jobs
 */
function startScheduler(isLeader = true) {
  if (schedulerStarted) {
    logger.warn('Scheduler already started, skipping');
    return;
  }

  if (!isLeader) {
    logger.info('Scheduler: this instance is not the leader, skipping cron registration');
    return;
  }

  logger.info('Starting background job scheduler (leader instance)');

  // Job 1: Dead letter replay (every hour)
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Running scheduled dead letter replay');

      const { replayDeadLetters } = require('../../scripts/replayDeadLetters');
      // Use managedConnection: true to prevent disconnecting the shared database connection
      const stats = await replayDeadLetters({
        dryRun: false,
        limit: 100,
        managedConnection: true  // Don't disconnect - we're sharing the connection with the main app
      });

      logger.info('Scheduled dead letter replay complete', stats);
    } catch (err) {
      logger.error('Scheduled dead letter replay failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Job 2: Health check (every 6 hours)
  cron.schedule('0 */6 * * *', async () => {
    try {
      logger.info('Running scheduled health check');

      const { runHealthCheck } = require('./jobs/healthCheck');
      const report = await runHealthCheck();

      logger.info('Scheduled health check complete', {
        status: report.status,
        criticalIssues: report.criticalIssues?.length || 0,
        warnings: report.warnings?.length || 0,
      });

      // Send email/SMS alerts for warnings and critical issues
      if (report.status === 'warning' || report.status === 'critical') {
        const { sendHealthAlerts } = require('../services/notificationService');
        const results = await sendHealthAlerts(report).catch((err) => {
          logger.error('Failed to send health alerts', {
            error: err.message,
          });
          return { emailSent: false, smsSent: false };
        });

        if (results.emailSent || results.smsSent) {
          logger.info('Health alerts sent', {
            email: results.emailSent,
            sms: results.smsSent,
          });
        }
      }
    } catch (err) {
      logger.error('Scheduled health check failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Job 3: Change notification digest (daily at 8 AM)
  cron.schedule('0 8 * * *', async () => {
    try {
      logger.info('Running scheduled change notification digest');

      const Change = require('../models/change');
      const { sendHealthAlerts } = require('../services/notificationService');

      // Find un-notified changes
      const pendingChanges = await Change.find({ notified: false })
        .sort({ timestamp: -1 })
        .limit(100)
        .lean();

      if (pendingChanges.length === 0) {
        logger.info('No pending change notifications');
        return;
      }

      // Group by type
      const grouped = {};
      pendingChanges.forEach((c) => {
        if (!grouped[c.type]) grouped[c.type] = [];
        grouped[c.type].push(c);
      });

      // Build alert report
      const report = {
        status: 'warning',
        timestamp: new Date(),
        warnings: Object.entries(grouped).map(([type, changes]) => ({
          message: `${changes.length} ${type.replace(/_/g, ' ')} event(s) detected`,
          recommendation: `Review recent ${type} changes in the changes API`,
        })),
        metrics: {
          totalChanges: pendingChanges.length,
          companyChanges: grouped.company_change?.length || 0,
          promotions: grouped.promotion?.length || 0,
          titleChanges: grouped.title_change?.length || 0,
        },
      };

      const results = await sendHealthAlerts(report).catch((err) => {
        logger.error('Failed to send change digest', { error: err.message });
        return { emailSent: false, smsSent: false };
      });

      // Mark changes as notified
      if (results.emailSent || results.smsSent) {
        const changeIds = pendingChanges.map((c) => c._id);
        await Change.updateMany(
          { _id: { $in: changeIds } },
          { $set: { notified: true, notifiedAt: new Date() } },
        );
        logger.info('Change digest sent and changes marked as notified', {
          email: results.emailSent,
          sms: results.smsSent,
          count: changeIds.length,
        });
      }
    } catch (err) {
      logger.error('Scheduled change notification digest failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Job 4: Expire recentJobChange flags (daily at 2 AM)
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Running scheduled recentJobChange expiry');

      const Change = require('../models/change');
      const result = await Change.updateMany(
        { recentJobChange: true, recentJobChangeExpiresAt: { $lte: new Date() } },
        { $set: { recentJobChange: false } },
      );

      logger.info('Scheduled recentJobChange expiry complete', {
        modifiedCount: result.modifiedCount || 0,
      });
    } catch (err) {
      logger.error('Scheduled recentJobChange expiry failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  schedulerStarted = true;
  logger.info('Background job scheduler started successfully');
}

/**
 * Stop scheduler (for graceful shutdown)
 */
function stopScheduler() {
  if (!schedulerStarted) {
    return;
  }

  logger.info('Stopping background job scheduler');
  // Note: node-cron doesn't provide a clean way to stop all tasks
  // Tasks will naturally stop when process exits
  schedulerStarted = false;
}

module.exports = {
  startScheduler,
  stopScheduler,
};
