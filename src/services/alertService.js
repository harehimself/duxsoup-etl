const axios = require('axios');
const logger = require('../utils/logger');
const Change = require('../models/change');

/**
 * Alert Service
 *
 * Sends Slack notifications for critical sales intelligence events:
 * - High-value prospects changing jobs
 * - Decision makers getting promoted
 * - Target account people leaving
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ALERT_MIN_LEAD_SCORE = parseInt(
  process.env.ALERT_MIN_LEAD_SCORE || '70',
  10,
);

/**
 * Send Slack alert for a change event
 *
 * @param {Object} change - Change record
 * @returns {Promise<Boolean>} True if alert sent successfully
 */
async function sendSlackAlert(change) {
  // Skip if no webhook configured
  if (!SLACK_WEBHOOK_URL) {
    logger.warn('Slack webhook URL not configured, skipping alert');
    return false;
  }

  // Build Slack message
  const message = buildSlackMessage(change);

  if (!message) {
    logger.debug('No Slack message built for change', {
      change_id: change._id,
      type: change.type,
    });
    return false;
  }

  try {
    // Send to Slack
    await axios.post(SLACK_WEBHOOK_URL, message, {
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info('Slack alert sent', {
      change_id: change._id,
      type: change.type,
      person_id: change.person_id,
    });

    // Mark change as notified
    await Change.updateOne(
      { _id: change._id },
      { notified: true, notifiedAt: new Date() },
    );

    return true;
  } catch (err) {
    logger.error('Failed to send Slack alert', {
      change_id: change._id,
      error: err.message,
      stack: err.stack,
    });
    return false;
  }
}

/**
 * Build Slack message for a change event
 *
 * @param {Object} change - Change record
 * @returns {Object|null} Slack message payload or null
 */
function buildSlackMessage(change) {
  const { type, personSnapshot, from, to, company } = change;

  // Determine alert priority
  const priority = determineAlertPriority(change);

  if (!priority) {
    return null; // Skip low-priority changes
  }

  // Build message based on change type
  let emoji, title, description;

  if (type === 'company_change') {
    emoji = '🎯';
    title = 'High-Value Lead Alert: Job Change';
    description = `${personSnapshot.fullName} (${personSnapshot.currentTitle}) just joined ${to}`;
  } else if (type === 'promotion') {
    emoji = '🚀';
    title = 'Decision Maker Promotion';
    description = `${personSnapshot.fullName} was promoted to ${to} at ${company}`;
  } else if (type === 'title_change') {
    emoji = '📊';
    title = 'Title Change Detected';
    description = `${personSnapshot.fullName} changed title from ${from} to ${to}`;
  } else {
    return null;
  }

  // Build Slack blocks
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${title}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: description,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Previous:*\n${from}`,
        },
        {
          type: 'mrkdwn',
          text: `*Current:*\n${to}`,
        },
      ],
    },
  ];

  // Add person details
  const detailFields = [];

  if (personSnapshot.connections) {
    detailFields.push({
      type: 'mrkdwn',
      text: `*Connections:*\n${personSnapshot.connections.toLocaleString()}`,
    });
  }

  if (personSnapshot.city || personSnapshot.state || personSnapshot.country) {
    const location = [
      personSnapshot.city,
      personSnapshot.state,
      personSnapshot.country,
    ]
      .filter(Boolean)
      .join(', ');
    detailFields.push({
      type: 'mrkdwn',
      text: `*Location:*\n${location}`,
    });
  }

  if (detailFields.length > 0) {
    blocks.push({
      type: 'section',
      fields: detailFields,
    });
  }

  // Add priority indicator
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Priority: *${priority.toUpperCase()}* | Person ID: \`${change.person_id}\``,
      },
    ],
  });

  return { blocks };
}

/**
 * Determine alert priority for a change
 *
 * @param {Object} change - Change record
 * @returns {String|null} Priority level (high, medium, low) or null
 */
function determineAlertPriority(change) {
  const { type, personSnapshot } = change;

  // High priority: High-value prospects (connections >= 500, senior titles)
  const isSenior = /\b(vp|vice president|director|chief|ceo|cfo|cto|head|lead)\b/i.test(
    personSnapshot.currentTitle || '',
  );
  const isInfluential = personSnapshot.connections >= 500;

  if (isSenior || isInfluential) {
    return 'high';
  }

  // Medium priority: Company changes and promotions
  if (type === 'company_change' || type === 'promotion') {
    return 'medium';
  }

  // Low priority: Other title changes
  if (type === 'title_change') {
    return 'low';
  }

  return null;
}

/**
 * Send alert for a change if it meets criteria
 *
 * @param {Object} change - Change record
 * @returns {Promise<Boolean>} True if alert sent
 */
async function sendAlertIfNeeded(change) {
  // Skip if already notified
  if (change.notified) {
    return false;
  }

  // Check if change meets alert criteria
  const priority = determineAlertPriority(change);

  // Only send high and medium priority alerts
  if (!priority || priority === 'low') {
    return false;
  }

  // Send alert
  return await sendSlackAlert(change);
}

/**
 * Process pending alerts (changes that need notification)
 *
 * @param {Object} options - Options
 * @param {Number} options.limit - Max alerts to process (default: 100)
 * @returns {Promise<Object>} Stats
 */
async function processPendingAlerts(options = {}) {
  const { limit = 100 } = options;

  logger.info('Processing pending alerts', { limit });

  // Find unnotified changes
  const changes = await Change.find({ notified: false })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
    .exec();

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const change of changes) {
    try {
      const sent = await sendAlertIfNeeded(change);

      if (sent) {
        sentCount++;
      } else {
        skippedCount++;
        // Mark as notified even if skipped (low priority)
        await Change.updateOne(
          { _id: change._id },
          { notified: true, notifiedAt: new Date() },
        );
      }
    } catch (err) {
      logger.error('Failed to process alert', {
        change_id: change._id,
        error: err.message,
      });
      errorCount++;
    }
  }

  logger.info('Pending alerts processed', {
    sent: sentCount,
    skipped: skippedCount,
    errors: errorCount,
  });

  return {
    sent: sentCount,
    skipped: skippedCount,
    errors: errorCount,
  };
}

/**
 * Send health check alert to Slack
 *
 * @param {Object} report - Health report
 * @returns {Promise<Boolean>} True if alert sent successfully
 */
async function sendHealthAlert(report) {
  // Skip if no webhook configured
  if (!SLACK_WEBHOOK_URL) {
    logger.warn('Slack webhook URL not configured, skipping health alert');
    return false;
  }

  const { status, criticalIssues = [], warnings = [], metrics = {} } = report;

  // Build message
  const emoji = status === 'critical' ? '🚨' : '⚠️';
  const statusText = status.toUpperCase();

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} DuxSoup ETL Health Alert: ${statusText}`,
        emoji: true,
      },
    },
  ];

  // Add critical issues
  if (criticalIssues.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Critical Issues:*',
      },
    });

    for (const issue of criticalIssues) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• ${issue.message}\n  _Recommendation: ${issue.recommendation}_`,
        },
      });
    }
  }

  // Add warnings
  if (warnings.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Warnings:*',
      },
    });

    for (const warning of warnings) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• ${warning.message}\n  _Recommendation: ${warning.recommendation}_`,
        },
      });
    }
  }

  // Add metrics
  if (Object.keys(metrics).length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Metrics:*',
      },
    });

    const metricFields = [];
    if (metrics.totalPeople !== undefined) {
      metricFields.push({
        type: 'mrkdwn',
        text: `*Total People:*\n${metrics.totalPeople.toLocaleString()}`,
      });
    }
    if (metrics.pendingDeadLetters !== undefined) {
      metricFields.push({
        type: 'mrkdwn',
        text: `*Pending Dead Letters:*\n${metrics.pendingDeadLetters}`,
      });
    }
    if (metrics.canonicalIdCoverage !== undefined) {
      metricFields.push({
        type: 'mrkdwn',
        text: `*Canonical ID Coverage:*\n${metrics.canonicalIdCoverage.toFixed(1)}%`,
      });
    }

    if (metricFields.length > 0) {
      blocks.push({
        type: 'section',
        fields: metricFields,
      });
    }
  }

  // Add timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Checked at: ${new Date(report.timestamp).toLocaleString()}`,
      },
    ],
  });

  try {
    // Send to Slack
    await axios.post(SLACK_WEBHOOK_URL, { blocks }, {
      headers: { 'Content-Type': 'application/json' },
    });

    logger.info('Health alert sent to Slack', { status });

    return true;
  } catch (err) {
    logger.error('Failed to send health alert', {
      error: err.message,
      stack: err.stack,
    });
    return false;
  }
}

module.exports = {
  sendSlackAlert,
  sendAlertIfNeeded,
  processPendingAlerts,
  sendHealthAlert,
};
