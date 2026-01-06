/**
 * Stable JSON stringification with sorted keys
 *
 * Ensures that the same logical payload always produces the same string,
 * regardless of key order in the original object.
 *
 * @param {*} obj - Object to stringify
 * @returns {string} Canonical JSON representation
 */
function stableStringify(obj) {
  if (obj === null) return 'null';
  if (obj === undefined) return undefined;
  if (typeof obj !== 'object') return JSON.stringify(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    const items = obj.map(item => stableStringify(item));
    return `[${items.join(',')}]`;
  }

  // Handle objects: sort keys alphabetically
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => {
    const value = stableStringify(obj[key]);
    return `${JSON.stringify(key)}:${value}`;
  });

  return `{${pairs.join(',')}}`;
}

module.exports = {
  stableStringify,
};
