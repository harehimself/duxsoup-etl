module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Coverage configuration
  coverageDirectory: 'coverage/unit',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!**/node_modules/**',
  ],

  // Only run unit tests (exclude integration tests)
  testMatch: [
    '**/__tests__/**/*.test.js',
    '!**/__tests__/**/*.integration.test.js',
  ],

  // Timeout for unit tests (shorter)
  testTimeout: 5000,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Verbose output
  verbose: true,
};
