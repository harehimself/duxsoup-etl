const logger = require('../utils/logger');

/**
 * Webhook Authentication Middleware
 *
 * Validates incoming webhook requests using a shared secret.
 * Checks the X-Webhook-Secret header or Authorization: Bearer <token>.
 *
 * When WEBHOOK_SECRET is not set, all requests pass through (with a startup warning).
 */

let warnedOnce = false;

function webhookAuth(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;

  // If no secret configured, pass through
  if (!secret) {
    if (!warnedOnce) {
      logger.warn('WEBHOOK_SECRET not set - webhook endpoint is unauthenticated');
      warnedOnce = true;
    }
    return next();
  }

  // Check X-Webhook-Secret header
  const headerSecret = req.headers['x-webhook-secret'];
  if (headerSecret === secret) {
    return next();
  }

  // Check Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1] === secret) {
      return next();
    }
  }

  logger.warn('Webhook authentication failed', {
    ip: req.ip,
    path: req.path,
    method: req.method,
  });

  return res.status(401).json({
    success: false,
    error: 'UNAUTHORIZED',
    message: 'Invalid or missing webhook secret',
  });
}

module.exports = webhookAuth;
