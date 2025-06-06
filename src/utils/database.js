const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      logger.warn('MongoDB URI not provided. Running without database.');
      return false;
    }
    
    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    logger.info(`MongoDB Connected: ${conn.connection.host}`, {
      database: conn.connection.name,
      readyState: conn.connection.readyState
    });
    
    return true;
  } catch (error) {
    logger.error('Error connecting to MongoDB:', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

// Graceful disconnection
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error.message);
  }
};

module.exports = { connectDB, disconnectDB };