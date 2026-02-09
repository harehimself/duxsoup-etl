const { DEBOUNCE_WINDOW_MS } = require("../constants/limits");

/**
 * In-memory debounce for Phase 2 entity upserts.
 *
 * DuxSoup fires 3-5 webhooks for the same profile within 30-60 s.
 * Each has a unique event_key so Phase 1 (observation write) still
 * runs, but repeating the full person/company/location upsert
 * pipeline is wasteful.  The first call for a given key runs
 * Phase 2 normally; subsequent calls within the window skip it.
 *
 * Lazy cleanup: expired entries are purged on every shouldSkip() call.
 */

const _cache = new Map();

/**
 * Check whether Phase 2 should be skipped for this key.
 *
 * @param {string} key - Deduplication key (duxsoupId)
 * @returns {boolean} true if key was recently processed (skip Phase 2)
 */
function shouldSkip(key) {
  const now = Date.now();

  // Lazy cleanup of expired entries
  for (const [k, expiresAt] of _cache) {
    if (expiresAt <= now) {
      _cache.delete(k);
    }
  }

  const expiresAt = _cache.get(key);
  if (expiresAt !== undefined && expiresAt > now) {
    return true; // Still within debounce window — skip
  }

  // First occurrence (or expired) — mark and proceed
  _cache.set(key, now + DEBOUNCE_WINDOW_MS);
  return false;
}

/**
 * Reset debounce state. Intended for testing only.
 */
function clear() {
  _cache.clear();
}

/**
 * Debugging helper — returns current cache stats.
 */
function getStats() {
  return { size: _cache.size, keys: [..._cache.keys()] };
}

module.exports = { shouldSkip, clear, getStats };
