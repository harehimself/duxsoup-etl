const { testNotifications } = require('../services/notificationService');
const logger = require('../utils/logger');

/**
 * Notification Controller
 *
 * Handles testing notification configuration
 */

/**
 * Test notification configuration
 *
 * POST /api/admin/test-notifications
 *
 * Sends test email and SMS to verify configuration
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 */
async function testNotificationsHandler(req, res, next) {
  try {
    logger.info('Testing notification configuration');

    const results = await testNotifications();

    res.json({
      success: true,
      data: {
        email: {
          configured: results.email.configured,
          sent: results.email.sent,
          error: results.email.error,
          message: results.email.configured
            ? results.email.sent
              ? 'Test email sent successfully'
              : `Failed to send: ${results.email.error}`
            : 'Email not configured (missing SMTP_HOST, SMTP_USER, or ALERT_EMAIL_TO)',
        },
        sms: {
          configured: results.sms.configured,
          sent: results.sms.sent,
          error: results.sms.error,
          message: results.sms.configured
            ? results.sms.sent
              ? 'Test SMS sent successfully'
              : `Failed to send: ${results.sms.error}`
            : 'SMS not configured (missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, or TWILIO_TO_NUMBER)',
        },
      },
    });
  } catch (err) {
    logger.error('Error testing notifications', {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = {
  testNotificationsHandler,
};
