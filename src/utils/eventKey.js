const crypto = require('crypto');

/**
 * Compute idempotent event key from webhook payload
 *
 * Prevents duplicate observations when webhooks are retried.
 * Hash components: userid + type + time + id
 *
 * @param {Object} payload - Webhook payload
 * @returns {string} SHA1 hash for idempotency
 */
function computeEventKey(payload) {
  const components = [
    payload.userid || 'no-user',
    payload.type || 'unknown',
    payload.time || payload.data?.VisitTime || payload.data?.ScanTime || Date.now(),
    payload.id || payload.data?.id || 'no-id',
  ];

  const keyString = components.join('|');

  return crypto
    .createHash('sha1')
    .update(keyString)
    .digest('hex');
}

module.exports = {
  computeEventKey,
};
