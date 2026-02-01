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

  // Coverage thresholds - ratchet prevents regression; raise as coverage improves
  coverageThreshold: {
    global: {
      branches: 35,
      functions: 25,
      lines: 30,
      statements: 30,
    },
  },

  // Verbose output
  verbose: true,
};
