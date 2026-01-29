require("dotenv").config();
const express = require("express");
const cors = require("cors");

const logger = require("./utils/logger");
const database = require("./utils/database");
const { validateEnvironment, getConfig } = require("./utils/env");
const apiRoutes = require("./routes/apiRoutes");

// Validate environment variables before starting
try {
  validateEnvironment();
} catch (error) {
  logger.error("Environment validation failed:", error);
  process.exit(1);
}

const config = getConfig();
const app = express();

// CORS configuration - restrictive by default
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : false; // Reject all cross-origin requests when not configured

if (!process.env.ALLOWED_ORIGINS) {
  logger.warn('ALLOWED_ORIGINS not set - CORS will reject all cross-origin browser requests. Server-to-server webhooks are unaffected.');
}

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({
  limit: '10mb',
  strict: true
}));

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Database readiness check - reject requests if DB is not ready
app.use((req, res, next) => {
  // Skip DB check for health endpoint
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  if (!database.isReady()) {
    const status = database.getConnectionStatus();
    logger.warn('Request rejected - database not ready', {
      path: req.path,
      method: req.method,
      dbState: status.readyStateText
    });

    return res.status(503).json({
      success: false,
      error: 'SERVICE_UNAVAILABLE',
      message: 'Database connection not ready. Please retry in a few seconds.',
      details: {
        dbState: status.readyStateText,
        readyState: status.readyState
      }
    });
  }

  next();
});

// Add API routes
app.use("/api", apiRoutes);

// Health check endpoint with database status
app.get("/health", async (req, res) => {
  const dbStatus = database.getConnectionStatus();
  const isHealthy = database.isReady();

  const response = {
    status: isHealthy ? "ok" : "degraded",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  };

  // Return 503 if database is not ready (helps load balancers detect unhealthy instances)
  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json(response);
});

app.get("/", (req, res) => {
  res.json({
    message: "DuxSoup ETL Server Running",
    endpoints: [
      "POST /api/webhook - Process DuxSoup data (payload includes 'type': 'visit' or 'scan')",
      "GET /health - Health check",
    ],
  });
});

// Initialize database connection and start server
async function startServer() {
  try {
    // Connect to MongoDB
    await database.connect();
    logger.info("Database connected successfully");

    // Start the server
    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.nodeEnv} mode`);

      // Start background job scheduler (if enabled)
      if (process.env.ENABLE_SCHEDULER !== 'false') {
        const { startScheduler } = require('./workers/scheduler');
        startScheduler();
      } else {
        logger.info('Background scheduler disabled (ENABLE_SCHEDULER=false)');
      }
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");

  // Stop scheduler
  try {
    const { stopScheduler } = require('./workers/scheduler');
    stopScheduler();
  } catch (err) {
    logger.error("Error stopping scheduler:", err);
  }

  await database.disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");

  // Stop scheduler
  try {
    const { stopScheduler } = require('./workers/scheduler');
    stopScheduler();
  } catch (err) {
    logger.error("Error stopping scheduler:", err);
  }

  await database.disconnect();
  process.exit(0);
});

startServer();
