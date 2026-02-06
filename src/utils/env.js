const crypto = require("crypto");
const logger = require("./logger");

/**
 * Validates that all required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  const requiredVars = ["MONGODB_URI"];
  const missing = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(", ")}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Validate PORT if provided
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be a valid port number (1-65535)");
    }
  }

  logger.info("Environment variables validated successfully");
}

/**
 * Gets environment configuration
 * @returns {Object} Configuration object
 */
function getConfig() {
  return {
    port: parseInt(process.env.PORT, 10) || 3000,
    mongoUri: process.env.MONGODB_URI,
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["*"],
    schedulerInstanceId: process.env.INSTANCE_ID || crypto.randomUUID(),
    leaderLockTtlSeconds:
      parseInt(process.env.LEADER_LOCK_TTL_SECONDS, 10) || 30,
    leaderRenewIntervalSeconds:
      parseInt(process.env.LEADER_RENEW_INTERVAL_SECONDS, 10) || 10,
  };
}

module.exports = {
  validateEnvironment,
  getConfig,
};
