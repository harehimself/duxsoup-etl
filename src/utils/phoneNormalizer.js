/**
 * Phone Number Normalizer
 *
 * Normalizes phone numbers to E.164 format (+15551234567) using libphonenumber-js.
 * Falls back to digit-stripped form for unparseable input.
 *
 * Follows the same warn-only pattern as normalizeEmail() in personController.js.
 */

const { parsePhoneNumber } = require("libphonenumber-js/min");
const logger = require("./logger");

const DEFAULT_COUNTRY = process.env.DEFAULT_PHONE_COUNTRY || "US";

/**
 * Normalize a phone number to E.164 format.
 *
 * @param {*} value - Raw phone string from webhook
 * @param {string} [defaultCountry] - ISO 3166-1 alpha-2 country code for numberless parsing
 * @returns {string|null} E.164 phone string, digit-stripped fallback, or null
 */
function normalizePhone(value, defaultCountry) {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === "" || str === "+") return null;

  const country = defaultCountry || DEFAULT_COUNTRY;

  try {
    const parsed = parsePhoneNumber(str, country);

    if (!parsed.isValid()) {
      logger.warn("Phone number fails validation", {
        phone: str,
        country,
      });
    }

    return parsed.format("E.164");
  } catch (_err) {
    // parsePhoneNumber throws on completely unparseable input
    const stripped = str.replace(/[^\d+]/g, "");
    if (!stripped || stripped === "+") return null;

    logger.warn("Phone number unparseable, using digit-stripped fallback", {
      phone: str,
      fallback: stripped,
    });

    return stripped;
  }
}

module.exports = { normalizePhone, DEFAULT_COUNTRY };
