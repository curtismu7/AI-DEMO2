'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/real/**/*.test.js'],
  globalSetup: '<rootDir>/tests/real/helpers/globalSetup.js',
  globalTeardown: '<rootDir>/tests/real/helpers/globalTeardown.js',
  setupFilesAfterEnv: ['<rootDir>/tests/real/helpers/suiteSetup.js'],
  testTimeout: 30000,
  forceExit: true,
  verbose: true,
  silent: false,
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/worktrees/', '/\\.kilo/worktrees/'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid-cjs.js',
  },
};
