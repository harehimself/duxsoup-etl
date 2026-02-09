/**
 * Array size limits for Person snapshot fields.
 *
 * Caps prevent unbounded growth from deduplication edge cases
 * or exceptionally long career histories. When a cap is hit,
 * the entry is dropped and a warning is logged.
 */

const MAX_ROLES = parseInt(process.env.MAX_PERSON_ROLES || "50", 10);
const MAX_EDUCATION = parseInt(process.env.MAX_PERSON_EDUCATION || "20", 10);
const MAX_SKILLS = parseInt(process.env.MAX_PERSON_SKILLS || "100", 10);
const DEBOUNCE_WINDOW_MS = parseInt(
  process.env.DEBOUNCE_WINDOW_MS || "30000",
  10,
);

module.exports = {
  MAX_ROLES,
  MAX_EDUCATION,
  MAX_SKILLS,
  DEBOUNCE_WINDOW_MS,
};
