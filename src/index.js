require("dotenv").config();
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const logger = require("./utils/logger");
const { connectDB } = require("./utils/database");
const apiRoutes = require('./routes/apiRoutes');

// Initialize MongoDB connection
const initializeApp = async () => {
  // Connect to MongoDB
  const dbConnected = await connectDB();
  if (dbConnected) {
    logger.info('Application starting with MongoDB support');
  } else {
    logger.warn('Application starting without MongoDB (running in memory mode)');
  }
  
  // Basic middleware
  app.use(express.json());

  // Add API routes
  app.use('/api', apiRoutes);

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ 
      status: "ok",
      mongodb: dbConnected ? "connected" : "unavailable",
      timestamp: new Date().toISOString()
    });
  });

  // Root endpoint
  app.get("/", (req, res) => {
    res.json({ 
      message: "DuxSoup LinkedIn ETL System",
      status: "running",
      mongodb: dbConnected ? "connected" : "unavailable",
      endpoints: {
        health: "/health",
        webhook: "/api/webhook",
        test: "/api/test"
      }
    });
  });

  // Start server
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`, {
      environment: process.env.NODE_ENV,
      mongodb: dbConnected ? "connected" : "unavailable"
    });
  });
};

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Graceful shutdown...');
  process.exit(0);
});

// Start the application
initializeApp().catch(error => {
  logger.error('Failed to initialize application:', error);
  process.exit(1);
});