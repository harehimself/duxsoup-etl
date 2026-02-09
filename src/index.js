require("dotenv").config({ override: true });
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const { sanitize: mongoSanitize } = require("express-mongo-sanitize");
const crypto = require("crypto");

const swaggerUi = require("swagger-ui-express");

const logger = require("./utils/logger");
const database = require("./utils/database");
const { validateEnvironment, getConfig } = require("./utils/env");
const LeaderElectionService = require("./services/leaderElectionService");
const requestTimeout = require("./middleware/requestTimeout");
const apiRoutes = require("./routes/apiRoutes");
const openapiSpec = require("./openapi");

// Module-level reference for shutdown handlers
let leaderElection = null;

// Validate environment variables before starting
try {
  validateEnvironment();
} catch (error) {
  logger.error("Environment validation failed:", error);
  process.exit(1);
}

const config = getConfig();
const app = express();

// Trust first proxy (Render's reverse proxy) for correct req.ip and rate limiting
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// Response compression
app.use(compression());

// Sanitize MongoDB operator injection from req.body, req.query, req.params
// Note: express-mongo-sanitize middleware is incompatible with Express 5
// (req.query is a read-only getter in Express 5), so we call sanitize() directly
app.use((req, res, next) => {
  if (req.body) mongoSanitize(req.body);
  if (req.query) mongoSanitize(req.query);
  if (req.params) mongoSanitize(req.params);
  next();
});

// Request correlation IDs
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});

// CORS configuration - restrictive by default
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : false; // Reject all cross-origin requests when not configured

if (!process.env.ALLOWED_ORIGINS) {
  logger.warn(
    "ALLOWED_ORIGINS not set - CORS will reject all cross-origin browser requests. Server-to-server webhooks are unaffected.",
  );
}

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  express.json({
    limit: "10mb",
    strict: true,
  }),
);

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    requestId: req.id,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  next();
});

// Database readiness check - reject requests if DB is not ready
app.use((req, res, next) => {
  // Skip DB check for health endpoint
  if (req.path === "/health" || req.path === "/") {
    return next();
  }

  if (!database.isReady()) {
    const status = database.getConnectionStatus();
    logger.warn("Request rejected - database not ready", {
      path: req.path,
      method: req.method,
      dbState: status.readyStateText,
    });

    return res.status(503).json({
      success: false,
      error: "SERVICE_UNAVAILABLE",
      message: "Database connection not ready. Please retry in a few seconds.",
      details: {
        dbState: status.readyStateText,
        readyState: status.readyState,
      },
    });
  }

  next();
});

// OpenAPI spec (JSON) and Swagger UI
app.get("/api/docs/openapi.json", (req, res) => res.json(openapiSpec));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Add API routes with default 30s timeout
app.use("/api", requestTimeout(30000), apiRoutes);

// Health check endpoint - ALWAYS returns 200 for Render health checks
// This endpoint must be simple and always succeed, even during startup
app.get("/health", requestTimeout(5000), async (req, res) => {
  const dbStatus = database.getConnectionStatus();
  const isHealthy = database.isReady();

  const response = {
    status: isHealthy ? "ok" : "starting",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  };

  // Always return 200 - Render needs this to pass health checks during startup
  // Database readiness is reported in the response body for monitoring
  res.status(200).json(response);
});

app.get("/", (req, res) => {
  res.json({
    message: "DuxSoup ETL Server Running",
    endpoints: [
      "POST /api/webhook - Process DuxSoup data (payload includes 'type': 'visit' or 'scan')",
      "GET /health - Health check",
      "GET /api/docs - Interactive API documentation (Swagger UI)",
      "GET /api/docs/openapi.json - OpenAPI 3.0 specification",
    ],
  });
});

// Global error handler - must be after all route definitions
app.use((err, req, res, _next) => {
  logger.error("Unhandled error", {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const status = err.status || err.statusCode || 500;
  const response = {
    success: false,
    error: "INTERNAL_ERROR",
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : err.message,
  };

  res.status(status).json(response);
});

// Initialize server - start listening IMMEDIATELY, then connect to DB
async function startServer() {
  // CRITICAL: Start HTTP server BEFORE connecting to database
  // This allows Render health checks to succeed during DB connection phase
  const port = parseInt(process.env.PORT, 10) || config.port;
  const host = "0.0.0.0";

  const server = app.listen(port, host, () => {
    logger.info("HTTP server started successfully", {
      port,
      host,
      nodeEnv: config.nodeEnv,
      message: `Listening on ${host}:${port}`,
    });
    logger.info(`Health check endpoint: http://${host}:${port}/health`);
  });

  // Now connect to database asynchronously (in background)
  // Server continues to respond to health checks during connection
  try {
    logger.info("Connecting to MongoDB...");
    await database.connect();
    logger.info("Database connected successfully");

    // Start background job scheduler (if enabled) after DB is ready
    if (process.env.ENABLE_SCHEDULER !== "false") {
      // Leader election: only one instance runs cron jobs
      leaderElection = new LeaderElectionService({
        instanceId: config.schedulerInstanceId,
        ttlSeconds: config.leaderLockTtlSeconds,
        renewIntervalSeconds: config.leaderRenewIntervalSeconds,
      });

      const isLeader = await leaderElection.tryAcquire();
      if (isLeader) {
        leaderElection.startRenewal();
      }

      const { startScheduler } = require("./workers/scheduler");
      startScheduler(isLeader);
      logger.info(
        isLeader
          ? "Background scheduler started (leader)"
          : "Background scheduler skipped (not leader)",
      );
    } else {
      logger.info("Background scheduler disabled (ENABLE_SCHEDULER=false)");
    }
  } catch (error) {
    logger.error("Failed to connect to database:", error);
    logger.warn(
      "Server continues running but database operations will fail until connection succeeds",
    );
    // DO NOT exit - let the server keep running and retry DB connection
  }

  return server;
}

// Handle graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  // Stop scheduler
  try {
    const { stopScheduler } = require("./workers/scheduler");
    stopScheduler();
  } catch (err) {
    logger.error("Error stopping scheduler:", err);
  }

  // Release leader lock before disconnecting DB
  if (leaderElection) {
    try {
      leaderElection.stopRenewal();
      await leaderElection.release();
    } catch (err) {
      logger.error("Error releasing leader lock:", err);
    }
  }

  await database.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

startServer();
