require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const logger = require("./utils/logger");
const database = require("./utils/database");
const apiRoutes = require("./routes/apiRoutes");

// Basic middleware
app.use(express.json());

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
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
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
