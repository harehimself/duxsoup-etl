/**
 * Application Error Classes
 *
 * Standardized error handling with error codes and HTTP status codes
 */

/**
 * Application Error
 *
 * Structured error with error code and HTTP status
 *
 * @param {String} code - Error code (e.g., 'INVALID_INPUT', 'NOT_FOUND')
 * @param {String} message - Human-readable error message
 * @param {Number} statusCode - HTTP status code (default: 400)
 */
class AppError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation Error
 *
 * Error for invalid input data
 */
class ValidationError extends AppError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Not Found Error
 *
 * Error for resources that don't exist
 */
class NotFoundError extends AppError {
  constructor(resource, identifier) {
    super('NOT_FOUND', `${resource} not found: ${identifier}`, 404);
    this.name = 'NotFoundError';
    this.resource = resource;
    this.identifier = identifier;
  }
}

/**
 * Conflict Error
 *
 * Error for duplicate resources or conflicting operations
 */
class ConflictError extends AppError {
  constructor(message) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Internal Server Error
 *
 * Error for unexpected server errors
 */
class InternalError extends AppError {
  constructor(message) {
    super('INTERNAL_ERROR', message || 'An unexpected error occurred', 500);
    this.name = 'InternalError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  InternalError,
};
