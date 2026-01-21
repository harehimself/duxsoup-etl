const cron = require('node-cron');
const logger = require('../utils/logger');

/**
 * Background Job Scheduler
 *
 * Automates recurring tasks:
 * - Dead letter replay: Every 1 hour
 * - Health check: Every 6 hours
 * - Lead scoring update: Daily at 2am
 * - Pending alerts: Every 15 minutes
 */

let schedulerStarted = false;

/**
 * Start background scheduler
 *
 * Initializes all cron jobs
 */
function startScheduler() {
  if (schedulerStarted) {
    logger.warn('Scheduler already started, skipping');
    return;
  }

  logger.info('Starting background job scheduler');

  // Job 1: Dead letter replay (every hour)
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Running scheduled dead letter replay');

      const { replayDeadLetters } = require('../scripts/replay-dead-letters');
      const stats = await replayDeadLetters({ limit: 100 });

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

      // Send Slack alert if critical issues found
      if (report.status === 'critical' && process.env.SLACK_WEBHOOK_URL) {
        const { sendHealthAlert } = require('../services/alertService');
        await sendHealthAlert(report).catch((err) => {
          logger.error('Failed to send health alert', {
            error: err.message,
          });
        });
      }
    } catch (err) {
      logger.error('Scheduled health check failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Job 3: Lead scoring update (daily at 2am)
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Running scheduled lead score recalculation');

      const { recalculateAllScores } = require('../services/scoringService');
      const stats = await recalculateAllScores({ batchSize: 100 });

      logger.info('Scheduled lead score recalculation complete', stats);
    } catch (err) {
      logger.error('Scheduled lead score recalculation failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  });

  // Job 4: Process pending alerts (every 15 minutes)
  cron.schedule('*/15 * * * *', async () => {
    try {
      logger.debug('Running scheduled alert processing');

      const { processPendingAlerts } = require('../services/alertService');
      const stats = await processPendingAlerts({ limit: 100 });

      if (stats.sent > 0 || stats.errors > 0) {
        logger.info('Scheduled alert processing complete', stats);
      }
    } catch (err) {
      logger.error('Scheduled alert processing failed', {
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
