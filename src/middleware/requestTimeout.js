const logger = require("../utils/logger");

/**
 * Request timeout middleware factory
 *
 * Returns middleware that aborts the request with 503 if it hasn't
 * completed within the given number of milliseconds.
 *
 * @param {Number} ms - Timeout in milliseconds
 * @returns {Function} Express middleware
 */
function requestTimeout(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;

      logger.warn("Request timed out", {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        timeoutMs: ms,
      });

      res.status(503).json({
        success: false,
        error: "REQUEST_TIMEOUT",
        message: `Request timed out after ${ms}ms`,
      });
    }, ms);

    // Clear timer when response finishes (success or error)
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

module.exports = requestTimeout;
