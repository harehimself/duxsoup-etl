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

      // TODO: Add email/SMS notification for critical issues
    } catch (err) {
      logger.error('Scheduled health check failed', {
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
