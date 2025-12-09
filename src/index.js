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

// Security and middleware configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
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

// Add API routes
app.use("/api", apiRoutes);

// Health check endpoint with database status
app.get("/health", async (req, res) => {
  const dbStatus = database.getConnectionStatus();
  res.json({
    status: "ok",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
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
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await database.disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await database.disconnect();
  process.exit(0);
});

startServer();
