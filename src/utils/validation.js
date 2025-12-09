const logger = require('./logger');

/**
 * Validates webhook payload structure and required fields
 * @param {Object} payload - The webhook payload
 * @param {string} type - The webhook type ('visit' or 'scan')
 * @returns {Object} { isValid: boolean, error: string|null, profileData: Object|null }
 */
function validateWebhookPayload(payload, type) {
  // Check if data property exists
  if (!payload || !payload.data) {
    logger.warn(`${type} webhook received without expected "data" property`, { payload });
    return {
      isValid: false,
      error: `Invalid ${type} payload structure: Missing "data" property in webhook payload`,
      profileData: null
    };
  }

  const profileData = payload.data;

  // Validate id field
  if (!profileData.id || typeof profileData.id !== 'string' || profileData.id.trim() === '') {
    logger.warn(`${type} webhook received with missing, null, or empty "id" in data property`, { payload });
    return {
      isValid: false,
      error: `Invalid ${type} payload: Missing or invalid "id". The "id" field must be a non-empty string.`,
      profileData: null
    };
  }

  return {
    isValid: true,
    error: null,
    profileData
  };
}

/**
 * Validates required fields in profile data
 * @param {Object} profileData - The profile data object
 * @param {Array<string>} requiredFields - Array of required field names
 * @param {string} type - The webhook type ('visit' or 'scan')
 * @returns {Object} { isValid: boolean, error: string|null, missingFields: Array<string> }
 */
function validateRequiredFields(profileData, requiredFields, type) {
  const missingFields = requiredFields.filter(field => !profileData[field]);

  if (missingFields.length > 0) {
    logger.warn(`Missing required fields for ${type}`, {
      id: profileData.id,
      missingFields
    });
    return {
      isValid: false,
      error: 'Missing required fields',
      missingFields
    };
  }

  return {
    isValid: true,
    error: null,
    missingFields: []
  };
}

/**
 * Creates a standardized error response
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {Object} Formatted error response
 */
function createErrorResponse(message, details = {}) {
  const response = {
    error: message
  };

  if (details.missingFields) {
    response.missingFields = details.missingFields;
  }

  if (details.required) {
    response.required = details.required;
  }

  if (details.message) {
    response.message = details.message;
  }

  return response;
}

/**
 * Creates a standardized success response
 * @param {string} type - The webhook type
 * @param {Object} document - The MongoDB document
 * @param {Object} profileData - The original profile data
 * @returns {Object} Formatted success response
 */
function createSuccessResponse(type, document, profileData) {
  const timeField = type === 'visit' ? 'VisitTime' : 'ScanTime';

  return {
    success: true,
    message: `${type.charAt(0).toUpperCase() + type.slice(1)} data processed successfully`,
    data: {
      id: document._id,
      duxsoupId: profileData.id,
      profile: profileData.Profile,
      [timeField.toLowerCase()]: profileData[timeField],
      firstName: profileData["First Name"],
      ...(type === 'scan' && { lastName: profileData["Last Name"] }),
      status: "processed"
    }
  };
}

/**
 * Handles database errors with appropriate logging and response
 * @param {Error} error - The error object
 * @param {string} type - The webhook type
 * @param {string} duxsoupId - The DuxSoup ID
 * @param {boolean} isProduction - Whether running in production
 * @returns {Object} Formatted error response
 */
function handleDatabaseError(error, type, duxsoupId, isProduction = false) {
  logger.error(`Error saving or updating ${type} data:`, {
    error: error.message,
    stack: error.stack,
    duxsoupId
  });

  const response = {
    error: `Failed to process ${type} data (database error)`,
    message: error.message
  };

  // Don't expose stack traces in production
  if (!isProduction && error.stack) {
    response.stack = error.stack;
  }

  return response;
}

module.exports = {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError
};
