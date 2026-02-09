/**
 * Webhook Schema Validator — warn-only schema drift detection.
 *
 * Validates incoming DuxSoup webhook payloads against known JSON Schemas.
 * Violations are logged as warnings but NEVER cause the webhook to be
 * rejected. The goal is early detection of DuxSoup API changes before
 * they cause downstream failures (e.g., the education object-casting bug).
 *
 * Two categories of drift are detected:
 *   1. Type violations — a known field has an unexpected type
 *   2. Unknown fields  — a field not in the known-fields list appeared
 *
 * Usage:
 *   const { validateWebhookSchema } = require('./webhookSchemaValidator');
 *   const result = validateWebhookSchema(payload);
 *   // result.typeErrors   — array of type-mismatch descriptions
 *   // result.unknownFields — array of { path, key } for new fields
 */

const Ajv = require('ajv');
const logger = require('./logger');
const {
  envelopeSchema,
  visitDataSchema,
  scanDataSchema,
  ENVELOPE_KNOWN_FIELDS,
  VISIT_KNOWN_FIELDS,
  SCAN_KNOWN_FIELDS,
} = require('./webhookSchemas');

// Compile schemas once at module load
const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });

const validateEnvelope = ajv.compile(envelopeSchema);
const validateVisitData = ajv.compile(visitDataSchema);
const validateScanData = ajv.compile(scanDataSchema);

/**
 * Detect keys in an object that are not in the known-fields list.
 * @param {Object} obj - The object to check
 * @param {string[]} knownFields - List of expected field names
 * @param {string} path - Dot-path prefix for logging (e.g., "data")
 * @returns {Array<{path: string, key: string}>}
 */
function detectUnknownFields(obj, knownFields, path) {
  if (!obj || typeof obj !== 'object') return [];
  const known = new Set(knownFields);
  return Object.keys(obj)
    .filter(key => !known.has(key))
    .map(key => ({ path, key }));
}

/**
 * Format ajv errors into human-readable strings.
 * @param {Array} errors - ajv error objects
 * @param {string} prefix - Path prefix (e.g., "envelope" or "data")
 * @returns {string[]}
 */
function formatErrors(errors, prefix) {
  if (!errors) return [];
  return errors.map(err => {
    const path = `${prefix}${err.instancePath}`;
    if (err.keyword === 'type') {
      return `${path}: expected ${err.params.type}, got ${typeof err.data}`;
    }
    if (err.keyword === 'enum') {
      return `${path}: value "${err.data}" not in allowed values [${err.params.allowedValues.join(', ')}]`;
    }
    if (err.keyword === 'required') {
      return `${prefix}: missing required field "${err.params.missingProperty}"`;
    }
    if (err.keyword === 'minLength') {
      return `${path}: string is too short (min ${err.params.limit})`;
    }
    if (err.keyword === 'oneOf') {
      return `${path}: value does not match any expected schema`;
    }
    return `${path}: ${err.message}`;
  });
}

/**
 * Validate a webhook payload against the known schemas.
 *
 * This function NEVER throws. It returns a result object with any
 * violations found. The caller decides what to do (log warnings).
 *
 * @param {Object} payload - The raw webhook payload (req.body)
 * @returns {{
 *   valid: boolean,
 *   typeErrors: string[],
 *   unknownFields: Array<{path: string, key: string}>,
 *   type: string|null
 * }}
 */
function validateWebhookSchema(payload) {
  const result = {
    valid: true,
    typeErrors: [],
    unknownFields: [],
    type: null,
  };

  try {
    if (!payload || typeof payload !== 'object') {
      result.valid = false;
      result.typeErrors.push('payload: expected object, got ' + typeof payload);
      return result;
    }

    // Validate envelope
    const envelopeValid = validateEnvelope(payload);
    if (!envelopeValid) {
      result.typeErrors.push(...formatErrors(validateEnvelope.errors, 'envelope'));
      result.valid = false;
    }

    // Detect unknown envelope fields
    result.unknownFields.push(
      ...detectUnknownFields(payload, ENVELOPE_KNOWN_FIELDS, 'envelope')
    );

    // Determine type and validate data
    const type = payload.type;
    result.type = type;

    if (payload.data && typeof payload.data === 'object') {
      if (type === 'visit') {
        const dataValid = validateVisitData(payload.data);
        if (!dataValid) {
          result.typeErrors.push(...formatErrors(validateVisitData.errors, 'data'));
          result.valid = false;
        }
        result.unknownFields.push(
          ...detectUnknownFields(payload.data, VISIT_KNOWN_FIELDS, 'data')
        );
      } else if (type === 'scan') {
        const dataValid = validateScanData(payload.data);
        if (!dataValid) {
          result.typeErrors.push(...formatErrors(validateScanData.errors, 'data'));
          result.valid = false;
        }
        result.unknownFields.push(
          ...detectUnknownFields(payload.data, SCAN_KNOWN_FIELDS, 'data')
        );
      }
      // Unknown type — envelope validation already flagged it
    }
  } catch (err) {
    // Schema validation itself should never block webhook processing
    logger.error('Schema validation internal error', {
      error: err.message,
      stack: err.stack,
    });
    result.valid = false;
    result.typeErrors.push(`internal: ${err.message}`);
  }

  return result;
}

/**
 * Validate and log schema drift for a webhook payload.
 *
 * Convenience wrapper that calls validateWebhookSchema() and logs
 * any violations. Returns the result for testing/observability.
 *
 * @param {Object} payload - The raw webhook payload
 * @returns {Object} The validation result
 */
function validateAndLogSchema(payload) {
  const result = validateWebhookSchema(payload);

  if (result.typeErrors.length > 0) {
    logger.warn('Webhook schema type violations detected', {
      type: result.type,
      duxsoupId: payload?.data?.id || payload?.id,
      violations: result.typeErrors,
      count: result.typeErrors.length,
    });
  }

  if (result.unknownFields.length > 0) {
    logger.info('Webhook schema drift: unknown fields detected', {
      type: result.type,
      duxsoupId: payload?.data?.id || payload?.id,
      unknownFields: result.unknownFields,
      count: result.unknownFields.length,
    });
  }

  return result;
}

module.exports = {
  validateWebhookSchema,
  validateAndLogSchema,
  // Exported for testing
  detectUnknownFields,
  formatErrors,
};
