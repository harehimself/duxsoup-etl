const mongoose = require("mongoose");
const logger = require("./logger");

class Database {
  constructor() {
    this.connectionReady = false;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Register listeners BEFORE connection attempt
    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connected");
      this.connectionReady = true;
    });

    mongoose.connection.on("error", (error) => {
      logger.error("MongoDB connection error:", error);
      this.connectionReady = false;
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn(
        "MongoDB disconnected - webhooks will fail until reconnected",
      );
      this.connectionReady = false;
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected successfully");
      this.connectionReady = true;
    });
  }

  async connect() {
    // Use Mongoose's readyState (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)
    if (mongoose.connection.readyState === 1) {
      logger.info("MongoDB already connected");
      return;
    }

    try {
      const mongoUri = process.env.MONGODB_URI;

      if (!mongoUri) {
        logger.warn("MONGODB_URI not found in environment variables");
        throw new Error("MongoDB URI is required");
      }

      logger.info("Attempting to connect to MongoDB...");

      await mongoose.connect(mongoUri, {
        dbName: process.env.MONGODB_DB_NAME || "duxsoup",
        serverSelectionTimeoutMS: 30000, // Increased from 5s to 30s for slow cloud starts
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2,
      });

      // Wait for connection to be fully ready (readyState === 1)
      if (mongoose.connection.readyState !== 1) {
        throw new Error(
          `MongoDB connection not ready. State: ${mongoose.connection.readyState}`,
        );
      }

      this.connectionReady = true;
      logger.info("MongoDB connected successfully", {
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        readyState: mongoose.connection.readyState,
      });
    } catch (error) {
      logger.error("Failed to connect to MongoDB:", {
        error: error.message,
        stack: error.stack,
      });
      this.connectionReady = false;
      throw error;
    }
  }

  async disconnect() {
    if (mongoose.connection.readyState === 0) {
      logger.info("MongoDB already disconnected");
      return;
    }

    try {
      await mongoose.disconnect();
      this.connectionReady = false;
      logger.info("MongoDB disconnected successfully");
    } catch (error) {
      logger.error("Error disconnecting from MongoDB:", error);
      throw error;
    }
  }

  getConnectionStatus() {
    const readyStateMap = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    };

    return {
      isConnected: mongoose.connection.readyState === 1,
      connectionReady: this.connectionReady,
      readyState: mongoose.connection.readyState,
      readyStateText:
        readyStateMap[mongoose.connection.readyState] || "unknown",
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    };
  }

  /**
   * Check if database is ready to accept operations
   * Use this in middleware to prevent processing when DB is down
   */
  isReady() {
    return mongoose.connection.readyState === 1 && this.connectionReady;
  }
}

module.exports = new Database();
