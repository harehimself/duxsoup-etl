const logger = require('./logger');

/**
 * Validates that all required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  const requiredVars = ['MONGODB_URI'];
  const missing = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Validate PORT if provided
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be a valid port number (1-65535)');
    }
  }

  logger.info('Environment variables validated successfully');
}

/**
 * Gets environment configuration
 * @returns {Object} Configuration object
 */
function getConfig() {
  // Validate READ_SOURCE if provided
  const readSource = process.env.READ_SOURCE || 'hybrid';
  const validReadSources = ['hybrid', 'people', 'legacy'];

  if (!validReadSources.includes(readSource)) {
    throw new Error(
      `Invalid READ_SOURCE: ${readSource}. Must be one of: ${validReadSources.join(', ')}`
    );
  }

  return {
    port: parseInt(process.env.PORT, 10) || 3000,
    mongoUri: process.env.MONGODB_URI,
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'],
    readSource: readSource, // hybrid (default) | people | legacy
  };
}

module.exports = {
  validateEnvironment,
  getConfig
};
