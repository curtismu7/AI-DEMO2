/**
 * Jest Configuration for OAuth Integration Tests
 * 
 * This configuration is specifically for running integration tests
 * for the OAuth scope-based authorization system.
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/src/__tests__/*integration*.test.js',
    '**/src/__tests__/oauth-*.test.js',
    '**/src/__tests__/scope-*.test.js'
  ],
  
  // Setup files
  setupFilesAfterEnv: [
    '<rootDir>/src/__tests__/setup.js'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  collectCoverageFrom: [
    'middleware/auth.js',
    'middleware/oauthErrorHandler.js',
    'routes/oauth*.js',
    'services/oauth*.js',
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/**/*.test.js'
  ],
  
  coverageDirectory: 'coverage/integration',
  
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    },
    './middleware/auth.js': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './middleware/oauthErrorHandler.js': {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    }
  },
  
  // Test timeout (integration tests may take longer)
  testTimeout: 30000,
  
  // Verbose output for detailed test results
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Module name mapping for easier imports
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@middleware/(.*)$': '<rootDir>/middleware/$1',
    '^@routes/(.*)$': '<rootDir>/routes/$1',
    '^@services/(.*)$': '<rootDir>/services/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1'
  },
  
  // Global setup and teardown
  globalSetup: '<rootDir>/src/__tests__/globalSetup.js',
  globalTeardown: '<rootDir>/src/__tests__/globalTeardown.js',
  
  // Transform configuration
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Module file extensions
  moduleFileExtensions: ['js', 'json'],
  
  // Test results processor
  testResultsProcessor: '<rootDir>/src/__tests__/testResultsProcessor.js',
  
  // Reporters
  reporters: [
    'default',
    [
      'jest-html-reporters',
      {
        publicPath: './coverage/integration/html-report',
        filename: 'integration-test-report.html',
        expand: true,
        hideIcon: false,
        pageTitle: 'OAuth Integration Test Report'
      }
    ]
  ],
  
  // Error handling
  errorOnDeprecated: true,
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,
  
  // Maximum worker processes
  maxWorkers: '50%'
};