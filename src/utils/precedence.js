/**
 * Shared precedence logic for the Observation-Snapshot pattern.
 *
 * Used by person, company, and location controllers to decide whether an
 * incoming observation value should overwrite the current snapshot value.
 *
 * Rules (in order):
 *   1. Always accept if no existing value
 *   2. Never overwrite with empty/blank/NaN incoming
 *   3. Higher source precedence wins (visit > scan)
 *   4. Same source: newer observation wins
 */

const SOURCE_PRECEDENCE = { visit: 2, scan: 1 };

/**
 * Determine if incoming value should overwrite existing snapshot value.
 *
 * @param {Object|null} existingMeta - { value, observedAt, source, observationId }
 * @param {Object} incomingMeta - { value, observedAt, source, observationId }
 * @returns {boolean} True if incoming should overwrite existing
 */
function shouldOverwrite(existingMeta, incomingMeta) {
  // Always accept if no existing value
  if (
    !existingMeta ||
    existingMeta.value === null ||
    existingMeta.value === undefined
  ) {
    return true;
  }

  // Never overwrite with empty/blank incoming
  const v = incomingMeta.value;
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (typeof v === "number" && isNaN(v)) return false;

  // Source precedence: visit > scan
  const existingP = SOURCE_PRECEDENCE[existingMeta.source] || 0;
  const incomingP = SOURCE_PRECEDENCE[incomingMeta.source] || 0;

  if (incomingP > existingP) return true;
  if (incomingP < existingP) return false;

  // Same precedence: newer wins
  const existingTime = new Date(existingMeta.observedAt).getTime();
  const incomingTime = new Date(incomingMeta.observedAt).getTime();
  return incomingTime >= existingTime;
}

module.exports = { SOURCE_PRECEDENCE, shouldOverwrite };
