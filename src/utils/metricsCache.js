/**
 * Simple in-memory TTL cache for expensive health metric aggregations.
 *
 * No external dependencies — uses a plain Map with expiry timestamps.
 */

const DEFAULT_TTL_MS =
  parseInt(process.env.HEALTH_CACHE_TTL_MS, 10) || 5 * 60 * 1000; // 5 minutes

const store = new Map();

/**
 * Return cached data if fresh, otherwise call fetchFn and cache the result.
 *
 * @param {string}   key      Cache key (e.g. 'ingestion', 'dashboard')
 * @param {Function} fetchFn  Async function that produces the data
 * @param {number}   [ttlMs]  Override TTL for this call (0 = skip cache)
 * @returns {Promise<*>}      Cached or freshly-fetched data
 */
async function getOrFetch(key, fetchFn, ttlMs = DEFAULT_TTL_MS) {
  if (ttlMs > 0) {
    const cached = store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const data = await fetchFn();

  if (ttlMs > 0) {
    store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  return data;
}

/** Remove a single cache entry. */
function invalidate(key) {
  store.delete(key);
}

/** Remove all cache entries. */
function invalidateAll() {
  store.clear();
}

/** Debugging helper — returns current cache state. */
function getStats() {
  return {
    size: store.size,
    keys: [...store.keys()],
  };
}

module.exports = { getOrFetch, invalidate, invalidateAll, getStats };
