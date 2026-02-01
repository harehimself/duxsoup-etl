const mongoose = require("mongoose");

/**
 * Connect to test MongoDB instance
 * Note: For unit tests, we'll mock mongoose models instead
 * This is only used for integration tests
 */
const connect = async () => {
  // Skip if already connected
  if (mongoose.connection.readyState === 1) {
    return;
  }

  const uri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/duxsoup-etl-test";

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
  } catch (_error) {
    console.warn("Could not connect to test database. Using mocks for tests.");
    // For unit tests, we'll mock the database instead
  }
};

/**
 * Drop database and close the connection
 */
const closeDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.connection.dropDatabase();
    } catch (_error) {
      // Ignore errors if database doesn't exist
    }
    await mongoose.connection.close();
  }
};

/**
 * Remove all data from all collections
 */
const clearDatabase = async () => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  const collections = mongoose.connection.collections;

  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

/**
 * Create a mock mongoose model for testing
 */
const createMockModel = (_name) => {
  const mockModel = jest.fn();

  // Mock instance methods
  mockModel.prototype.save = jest.fn().mockResolvedValue({});

  // Mock static methods
  mockModel.findOne = jest.fn();
  mockModel.findById = jest.fn();
  mockModel.find = jest.fn();
  mockModel.findOneAndUpdate = jest.fn();
  mockModel.updateOne = jest.fn();
  mockModel.deleteOne = jest.fn();
  mockModel.create = jest.fn();

  return mockModel;
};

module.exports = {
  connect,
  closeDatabase,
  clearDatabase,
  createMockModel,
};
