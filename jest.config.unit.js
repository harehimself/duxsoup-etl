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

  // Coverage thresholds - fail CI if coverage drops below these values
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 60,
      statements: 60,
    },
  },

  // Verbose output
  verbose: true,
};
