const { BACKOFF_CAP_MINUTES } = require("../constants/limits");

/**
 * Calculate the next eligible replay time using exponential backoff.
 *
 * Formula: lastReplayAt + min(2^attempts, cap) minutes
 * Progression: 2m, 4m, 8m, 16m, 32m, 64m, 128m, 256m, 512m, 720m (capped)
 *
 * @param {Date} lastReplayAt - When the last replay was attempted
 * @param {number} attempts - Number of replay attempts so far (after increment)
 * @param {number} [capMinutes] - Maximum delay in minutes (defaults to BACKOFF_CAP_MINUTES)
 * @returns {Date} The earliest time the record is eligible for replay
 */
function calculateNextReplayAt(
  lastReplayAt,
  attempts,
  capMinutes = BACKOFF_CAP_MINUTES,
) {
  const delayMinutes = Math.min(Math.pow(2, attempts), capMinutes);
  const delayMs = delayMinutes * 60 * 1000;
  return new Date(lastReplayAt.getTime() + delayMs);
}

module.exports = { calculateNextReplayAt };
