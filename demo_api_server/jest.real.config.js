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
  // Same worktree self-detect jest.config.js got in PR #950, which this file
  // never received: the excludes exist so the MAIN checkout's run does not
  // double-execute suites living inside agent worktrees, but they also made every
  // real suite unrunnable FROM a worktree — "No tests found", which reads as
  // clean. Working from a worktree is the required practice here, so the only way
  // to run a real test was `--testPathIgnorePatterns=<something>`, and that flag
  // REPLACES the list rather than appending: on 2026-08-03 it swallowed the
  // following positional argument as a second pattern and ran all 66 real suites
  // against the live stack instead of the one requested. Dropping the excludes
  // when already inside a worktree removes the need for the override entirely.
  testPathIgnorePatterns: [
    '/node_modules/',
    ...(/\/\.(claude|kilo)\/worktrees\//.test(__dirname)
      ? []
      : ['/\\.claude/worktrees/', '/\\.kilo/worktrees/']),
  ],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid-cjs.js',
  },
};
