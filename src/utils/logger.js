const winston = require("winston");

const isProduction = process.env.NODE_ENV === "production";

/**
 * Log sampling filter.
 * In production, samples debug-level logs at the configured rate (default 10%)
 * to reduce log volume without losing visibility.
 */
const LOG_SAMPLE_RATE = parseFloat(process.env.LOG_SAMPLE_RATE) || 0.1;

const samplingFilter = winston.format((info) => {
  if (
    isProduction &&
    info.level === "debug" &&
    Math.random() > LOG_SAMPLE_RATE
  ) {
    return false;
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    samplingFilter(),
    winston.format.json(),
  ),
  defaultMeta: { service: "duxsoup-etl" },
  transports: [
    // In production: structured JSON to stdout (for log aggregators)
    // In development: colorized human-readable output
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          )
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
    }),
  ],
});

// Add file transport in production
if (isProduction) {
  logger.add(
    new winston.transports.File({
      filename: "error.log",
      level: "error",
    }),
  );
  logger.add(
    new winston.transports.File({
      filename: "combined.log",
    }),
  );
}

module.exports = logger;
