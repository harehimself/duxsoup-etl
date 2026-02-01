const nodemailer = require("nodemailer");
const twilio = require("twilio");
const logger = require("../utils/logger");

/**
 * Notification Service
 *
 * Sends health alerts via:
 * - Email: For all warnings and critical issues (detailed reports)
 * - SMS: For critical issues only (brief alerts)
 */

// Email configuration
const EMAIL_ENABLED = !!process.env.SMTP_HOST && !!process.env.SMTP_USER;
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: EMAIL_ENABLED
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
};

const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO;

// SMS configuration
const SMS_ENABLED =
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;

const twilioClient = SMS_ENABLED
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const SMS_FROM = process.env.TWILIO_FROM_NUMBER;
const SMS_TO = process.env.TWILIO_TO_NUMBER;

/**
 * Send health alert email
 *
 * @param {Object} report - Health report
 * @returns {Promise<Boolean>} True if sent successfully
 */
async function sendHealthEmail(report) {
  if (!EMAIL_ENABLED || !ALERT_EMAIL_TO) {
    logger.debug("Email not configured, skipping email alert");
    return false;
  }

  const {
    status,
    criticalIssues: _criticalIssues = [],
    warnings: _warnings = [],
    metrics: _metrics = {},
    timestamp: _timestamp,
  } = report;

  try {
    // Create email transporter
    const transporter = nodemailer.createTransport(SMTP_CONFIG);

    // Build email content
    const subject = `[${status.toUpperCase()}] DuxSoup ETL Health Alert`;

    const htmlBody = buildEmailHtml(report);
    const textBody = buildEmailText(report);

    // Send email
    const info = await transporter.sendMail({
      from: `"DuxSoup ETL" <${ALERT_EMAIL_FROM}>`,
      to: ALERT_EMAIL_TO,
      subject,
      text: textBody,
      html: htmlBody,
    });

    logger.info("Health alert email sent", {
      messageId: info.messageId,
      status,
      to: ALERT_EMAIL_TO,
    });

    return true;
  } catch (err) {
    logger.error("Failed to send health alert email", {
      error: err.message,
      stack: err.stack,
    });
    return false;
  }
}

/**
 * Send critical health alert SMS
 *
 * @param {Object} report - Health report
 * @returns {Promise<Boolean>} True if sent successfully
 */
async function sendHealthSMS(report) {
  // Only send SMS for critical issues
  if (report.status !== "critical") {
    return false;
  }

  if (!SMS_ENABLED || !SMS_TO) {
    logger.debug("SMS not configured, skipping SMS alert");
    return false;
  }

  try {
    const message = buildSMSMessage(report);

    const result = await twilioClient.messages.create({
      body: message,
      from: SMS_FROM,
      to: SMS_TO,
    });

    logger.info("Health alert SMS sent", {
      sid: result.sid,
      status: result.status,
      to: SMS_TO,
    });

    return true;
  } catch (err) {
    logger.error("Failed to send health alert SMS", {
      error: err.message,
      stack: err.stack,
    });
    return false;
  }
}

/**
 * Send health alerts (both email and SMS as appropriate)
 *
 * @param {Object} report - Health report
 * @returns {Promise<Object>} Results { emailSent, smsSent }
 */
async function sendHealthAlerts(report) {
  const results = {
    emailSent: false,
    smsSent: false,
  };

  // Send email for warnings and critical
  if (report.status === "warning" || report.status === "critical") {
    results.emailSent = await sendHealthEmail(report);
  }

  // Send SMS for critical only
  if (report.status === "critical") {
    results.smsSent = await sendHealthSMS(report);
  }

  return results;
}

/**
 * Build HTML email content
 *
 * @param {Object} report - Health report
 * @returns {String} HTML content
 */
function buildEmailHtml(report) {
  const {
    status,
    criticalIssues = [],
    warnings = [],
    metrics = {},
    timestamp,
  } = report;

  const emoji =
    status === "critical" ? "🚨" : status === "warning" ? "⚠️" : "✅";
  const color =
    status === "critical"
      ? "#dc3545"
      : status === "warning"
        ? "#ffc107"
        : "#28a745";

  let html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 5px; }
    .section { margin: 20px 0; }
    .issue { background: #f8f9fa; padding: 10px; margin: 5px 0; border-left: 3px solid ${color}; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .footer { color: #666; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${emoji} DuxSoup ETL Health Alert: ${status.toUpperCase()}</h1>
    <p>Checked at: ${new Date(timestamp).toLocaleString()}</p>
  </div>
`;

  // Critical issues
  if (criticalIssues.length > 0) {
    html += `
  <div class="section">
    <h2>🔴 Critical Issues</h2>
`;
    criticalIssues.forEach((issue) => {
      html += `
    <div class="issue">
      <strong>${issue.message}</strong><br>
      <em>Recommendation: ${issue.recommendation}</em>
    </div>
`;
    });
    html += `  </div>`;
  }

  // Warnings
  if (warnings.length > 0) {
    html += `
  <div class="section">
    <h2>⚠️ Warnings</h2>
`;
    warnings.forEach((warning) => {
      html += `
    <div class="issue">
      <strong>${warning.message}</strong><br>
      <em>Recommendation: ${warning.recommendation}</em>
    </div>
`;
    });
    html += `  </div>`;
  }

  // Metrics
  if (Object.keys(metrics).length > 0) {
    html += `
  <div class="section">
    <h2>📊 Metrics</h2>
`;
    if (metrics.totalPeople !== undefined) {
      html += `    <div class="metric"><strong>Total People:</strong> ${metrics.totalPeople.toLocaleString()}</div>`;
    }
    if (metrics.pendingDeadLetters !== undefined) {
      html += `    <div class="metric"><strong>Pending Dead Letters:</strong> ${metrics.pendingDeadLetters}</div>`;
    }
    if (metrics.canonicalIdCoverage !== undefined) {
      html += `    <div class="metric"><strong>Canonical ID Coverage:</strong> ${metrics.canonicalIdCoverage.toFixed(1)}%</div>`;
    }
    if (metrics.failedAgainDeadLetters !== undefined) {
      html += `    <div class="metric"><strong>Failed Again Dead Letters:</strong> ${metrics.failedAgainDeadLetters}</div>`;
    }
    html += `  </div>`;
  }

  html += `
  <div class="footer">
    <p>This is an automated health alert from DuxSoup ETL.</p>
  </div>
</body>
</html>
`;

  return html;
}

/**
 * Build plain text email content
 *
 * @param {Object} report - Health report
 * @returns {String} Text content
 */
function buildEmailText(report) {
  const {
    status,
    criticalIssues = [],
    warnings = [],
    metrics = {},
    timestamp,
  } = report;

  let text = `DuxSoup ETL Health Alert: ${status.toUpperCase()}\n`;
  text += `Checked at: ${new Date(timestamp).toLocaleString()}\n\n`;

  if (criticalIssues.length > 0) {
    text += `CRITICAL ISSUES:\n`;
    criticalIssues.forEach((issue) => {
      text += `  - ${issue.message}\n`;
      text += `    Recommendation: ${issue.recommendation}\n`;
    });
    text += `\n`;
  }

  if (warnings.length > 0) {
    text += `WARNINGS:\n`;
    warnings.forEach((warning) => {
      text += `  - ${warning.message}\n`;
      text += `    Recommendation: ${warning.recommendation}\n`;
    });
    text += `\n`;
  }

  if (Object.keys(metrics).length > 0) {
    text += `METRICS:\n`;
    if (metrics.totalPeople !== undefined) {
      text += `  Total People: ${metrics.totalPeople.toLocaleString()}\n`;
    }
    if (metrics.pendingDeadLetters !== undefined) {
      text += `  Pending Dead Letters: ${metrics.pendingDeadLetters}\n`;
    }
    if (metrics.canonicalIdCoverage !== undefined) {
      text += `  Canonical ID Coverage: ${metrics.canonicalIdCoverage.toFixed(1)}%\n`;
    }
  }

  return text;
}

/**
 * Build SMS message (brief)
 *
 * @param {Object} report - Health report
 * @returns {String} SMS message
 */
function buildSMSMessage(report) {
  const { criticalIssues = [] } = report;

  let message = `🚨 DuxSoup ETL CRITICAL:\n`;

  if (criticalIssues.length > 0) {
    // Include first 2 critical issues (SMS has character limit)
    criticalIssues.slice(0, 2).forEach((issue) => {
      message += `• ${issue.message}\n`;
    });

    if (criticalIssues.length > 2) {
      message += `+ ${criticalIssues.length - 2} more issues\n`;
    }
  }

  message += `Check email for details.`;

  // Ensure SMS is under 160 characters if possible
  if (message.length > 160) {
    message = `🚨 DuxSoup ETL: ${criticalIssues.length} critical issues. Check email for details.`;
  }

  return message;
}

/**
 * Test notification configuration
 *
 * @returns {Promise<Object>} Test results
 */
async function testNotifications() {
  const results = {
    email: {
      configured: EMAIL_ENABLED && !!ALERT_EMAIL_TO,
      sent: false,
      error: null,
    },
    sms: {
      configured: SMS_ENABLED && !!SMS_TO,
      sent: false,
      error: null,
    },
  };

  // Test email
  if (results.email.configured) {
    const testReport = {
      status: "warning",
      timestamp: new Date(),
      warnings: [
        {
          message: "This is a test notification",
          recommendation: "No action needed - configuration test",
        },
      ],
      metrics: {
        totalPeople: 12345,
      },
    };

    try {
      results.email.sent = await sendHealthEmail(testReport);
    } catch (err) {
      results.email.error = err.message;
    }
  }

  // Test SMS
  if (results.sms.configured) {
    try {
      const result = await twilioClient.messages.create({
        body: "🧪 DuxSoup ETL test SMS - configuration working!",
        from: SMS_FROM,
        to: SMS_TO,
      });
      results.sms.sent = result.status === "queued" || result.status === "sent";
    } catch (err) {
      results.sms.error = err.message;
    }
  }

  return results;
}

module.exports = {
  sendHealthAlerts,
  sendHealthEmail,
  sendHealthSMS,
  testNotifications,
};
