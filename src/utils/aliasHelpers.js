/**
 * Alias utility functions
 * Shared utilities for deduplicating and managing entity aliases
 */

/**
 * Deduplicate aliases by type:value combination
 * Filters out invalid aliases (missing type or value) and removes duplicates
 *
 * @param {Array<{type: string, value: string}>} aliases - Array of alias objects
 * @returns {Array<{type: string, value: string}>} Deduplicated array of aliases
 *
 * @example
 * const aliases = [
 *   { type: 'salesNavId', value: 'ACwAAA123' },
 *   { type: 'salesNavId', value: 'ACwAAA123' }, // duplicate
 *   { type: 'publicUrl', value: 'john-doe' },
 *   { type: 'invalid' }, // missing value, will be filtered out
 * ];
 * const unique = dedupeAliases(aliases);
 * // Returns: [{ type: 'salesNavId', value: 'ACwAAA123' }, { type: 'publicUrl', value: 'john-doe' }]
 */
function dedupeAliases(aliases = []) {
  const seen = new Set();
  const unique = [];

  aliases.forEach(alias => {
    if (!alias?.type || !alias?.value) return;
    const key = `${alias.type}:${alias.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(alias);
  });

  return unique;
}

module.exports = {
  dedupeAliases,
};
