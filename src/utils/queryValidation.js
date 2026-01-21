const { AppError } = require('./errors');

/**
 * Query Validation Utility
 *
 * Validates and sanitizes user-provided query filters to prevent:
 * - MongoDB injection attacks
 * - Performance-killing queries
 * - Excessive data extraction
 */

const ALLOWED_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$regex',
  '$options',
  '$exists',
  '$and',
  '$or',
];

const ALLOWED_SORT_FIELDS = [
  'snapshot.fullName',
  'snapshot.currentTitle',
  'snapshot.currentCompany',
  'snapshot.connections',
  'snapshot.city',
  'snapshot.state',
  'snapshot.country',
  'meta.lastObservedAt',
  'meta.observationsCount',
  'createdAt',
  'updatedAt',
  'derived.leadScore',
];

const ALLOWED_FILTER_FIELDS = [
  'snapshot.fullName',
  'snapshot.firstName',
  'snapshot.lastName',
  'snapshot.currentTitle',
  'snapshot.currentCompany',
  'snapshot.currentCompanyId',
  'snapshot.industry',
  'snapshot.location',
  'snapshot.city',
  'snapshot.state',
  'snapshot.stateCode',
  'snapshot.country',
  'snapshot.countryCode',
  'snapshot.connections',
  'snapshot.email',
  'snapshot.phone',
  'snapshot.degree',
  'snapshot.skills',
  'snapshot.roles.title',
  'snapshot.roles.companyName',
  'snapshot.roles.isCurrent',
  'snapshot.education.school',
  'snapshot.education.degree',
  'snapshot.education.field',
  'derived.leadScore',
  'derived.segment',
  'meta.lastObservedAt',
  'createdAt',
];

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

/**
 * Validate and sanitize query parameters
 *
 * @param {Object} queryParams - Raw query parameters from request
 * @param {Object} queryParams.filters - MongoDB filter object
 * @param {Object} queryParams.sort - Sort specification
 * @param {Number} queryParams.limit - Result limit
 * @param {Number} queryParams.skip - Results to skip (pagination)
 * @returns {Object} Validated query parameters
 * @throws {AppError} If validation fails
 */
function validateQuery(queryParams) {
  const { filters = {}, sort = {}, limit, skip = 0 } = queryParams;

  // Validate filters
  const sanitizedFilters = validateFilters(filters);

  // Validate sort
  const sanitizedSort = validateSort(sort);

  // Validate limit
  const sanitizedLimit = validateLimit(limit);

  // Validate skip
  const sanitizedSkip = validateSkip(skip);

  return {
    filters: sanitizedFilters,
    sort: sanitizedSort,
    limit: sanitizedLimit,
    skip: sanitizedSkip,
  };
}

/**
 * Validate filter object
 *
 * @param {Object} filters - Filter specification
 * @returns {Object} Sanitized filters
 * @throws {AppError} If filters contain disallowed operators or fields
 */
function validateFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  // Check for dangerous operators
  checkForDangerousOperators(filters);

  // Validate each field
  const sanitized = {};

  for (const [field, value] of Object.entries(filters)) {
    // Allow logical operators ($and, $or)
    if (field === '$and' || field === '$or') {
      if (!Array.isArray(value)) {
        throw new AppError(
          'INVALID_FILTER',
          `${field} must be an array of filter objects`,
        );
      }

      // Recursively validate nested filters
      sanitized[field] = value.map((subFilter) => validateFilters(subFilter));
      continue;
    }

    // Check if field is allowed
    if (!ALLOWED_FILTER_FIELDS.includes(field)) {
      throw new AppError(
        'INVALID_FILTER_FIELD',
        `Field "${field}" is not allowed for filtering. Allowed fields: ${ALLOWED_FILTER_FIELDS.join(', ')}`,
      );
    }

    // Validate operator
    if (typeof value === 'object' && value !== null) {
      for (const operator of Object.keys(value)) {
        if (!ALLOWED_FILTER_OPERATORS.includes(operator)) {
          throw new AppError(
            'INVALID_OPERATOR',
            `Operator "${operator}" is not allowed. Allowed operators: ${ALLOWED_FILTER_OPERATORS.join(', ')}`,
          );
        }
      }
    }

    sanitized[field] = value;
  }

  return sanitized;
}

/**
 * Check for dangerous MongoDB operators
 *
 * @param {Object} obj - Object to check
 * @throws {AppError} If dangerous operators found
 */
function checkForDangerousOperators(obj) {
  const dangerousOps = ['$where', '$expr', '$function', '$accumulator'];

  const checkRecursive = (o) => {
    if (!o || typeof o !== 'object') return;

    for (const key of Object.keys(o)) {
      if (dangerousOps.includes(key)) {
        throw new AppError(
          'FORBIDDEN_OPERATOR',
          `Operator "${key}" is not allowed for security reasons`,
        );
      }

      // Recursively check nested objects
      if (typeof o[key] === 'object') {
        checkRecursive(o[key]);
      }
    }
  };

  checkRecursive(obj);
}

/**
 * Validate sort specification
 *
 * @param {Object} sort - Sort specification
 * @returns {Object} Sanitized sort
 * @throws {AppError} If sort contains disallowed fields
 */
function validateSort(sort) {
  if (!sort || typeof sort !== 'object') {
    return {};
  }

  const sanitized = {};

  for (const [field, direction] of Object.entries(sort)) {
    if (!ALLOWED_SORT_FIELDS.includes(field)) {
      throw new AppError(
        'INVALID_SORT_FIELD',
        `Field "${field}" is not allowed for sorting. Allowed fields: ${ALLOWED_SORT_FIELDS.join(', ')}`,
      );
    }

    if (direction !== 1 && direction !== -1) {
      throw new AppError(
        'INVALID_SORT_DIRECTION',
        `Sort direction must be 1 (ascending) or -1 (descending)`,
      );
    }

    sanitized[field] = direction;
  }

  return sanitized;
}

/**
 * Validate limit parameter
 *
 * @param {Number} limit - Requested limit
 * @returns {Number} Sanitized limit
 * @throws {AppError} If limit is invalid
 */
function validateLimit(limit) {
  if (limit === undefined || limit === null) {
    return DEFAULT_LIMIT;
  }

  const parsed = parseInt(limit, 10);

  if (isNaN(parsed) || parsed < 1) {
    throw new AppError('INVALID_LIMIT', 'Limit must be a positive integer');
  }

  if (parsed > MAX_LIMIT) {
    throw new AppError(
      'LIMIT_EXCEEDED',
      `Limit cannot exceed ${MAX_LIMIT}. Use pagination for larger result sets.`,
    );
  }

  return parsed;
}

/**
 * Validate skip parameter
 *
 * @param {Number} skip - Requested skip
 * @returns {Number} Sanitized skip
 * @throws {AppError} If skip is invalid
 */
function validateSkip(skip) {
  if (skip === undefined || skip === null) {
    return 0;
  }

  const parsed = parseInt(skip, 10);

  if (isNaN(parsed) || parsed < 0) {
    throw new AppError('INVALID_SKIP', 'Skip must be a non-negative integer');
  }

  return parsed;
}

module.exports = {
  validateQuery,
  validateFilters,
  validateSort,
  validateLimit,
  validateSkip,
  ALLOWED_FILTER_FIELDS,
  ALLOWED_SORT_FIELDS,
  MAX_LIMIT,
  DEFAULT_LIMIT,
};
