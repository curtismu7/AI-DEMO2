module.exports = {
  testEnvironment: 'node',
  // uuid v9+ and jose v6+ are ESM-only; Jest runs CJS — redirect to minimal CJS shims.
  // jose arrives transitively via @a2a-js/sdk's bundled CJS (dist/*.cjs), which
  // `require("jose")`s at module scope for its unused agent-card-signature helper —
  // without this mapping, any test requiring server.js (which mounts the A2A
  // protocol router) fails at require-time with a jose ESM SyntaxError.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__tests__/__mocks__/uuid-cjs.js',
    '^jose$': '<rootDir>/src/__tests__/__mocks__/jose-cjs.js',
  },
  // CI runs many suites in parallel across packages; cap workers to reduce flaky supertest/socket errors.
  ...(process.env.CI === 'true' ? { maxWorkers: 2 } : {}),
  // Runs setup.js before each test file so env vars (SKIP_TOKEN_SIGNATURE_VALIDATION,
  // DEBUG_TOKENS, etc.) are set before any module is require()'d by the test.
  // globalSetup runs once before all suites. Loads .env.test-tokens if present
  // (written by scripts/extract-browser-token.js after a browser login).
  globalSetup: '<rootDir>/src/__tests__/setup/loadBrowserToken.js',
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  collectCoverageFrom: [
    'middleware/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    '!**/node_modules/**'
  ],
  // Conservative global coverage floor (code-maturity item 4). Set a few points
  // BELOW current coverage (measured full-suite, runInBand: statements 48.4%,
  // branches 39.7%, functions 50.2%, lines 49.1%) so it guards against a
  // regression without blocking today's PRs. Enforced only when --coverage is
  // passed — the dedicated `coverage` CI job runs the full suite that way; the
  // sharded `api-server` job does NOT (each shard sees 1/4 of the tests, so a
  // threshold there would fail on every shard). Raise these as coverage climbs.
  coverageThreshold: {
    global: {
      statements: 45,
      branches: 36,
      functions: 47,
      lines: 45,
    },
  },
  testMatch: [
    '**/src/__tests__/**/*.test.js',
    '**/tests/**/*.test.js',
  ],
  // Exclude git worktrees created by Claude Code and Kilo agents — they mirror
  // the repo structure and would otherwise double-run (or fail to load) every suite.
  // Also exclude tests/real/ — the real-call HTTP suite runs ONLY via
  // jest.real.config.js, which registers the skipIfNoSession global in its
  // suiteSetup.js. Under the default config that global is undefined, so every
  // real test throws `ReferenceError: skipIfNoSession is not defined` (was
  // breaking CI — the default testMatch '**/tests/**' picked them up).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/\\.claude/worktrees/',
    '/\\.kilo/worktrees/',
    '/tests/real/',
  ],
  reporters: [
    'default',
    '<rootDir>/src/__tests__/setup/markdownReporter.js',
    // CI-only per-file start logger so a hung test names itself in the logs
    // (the default reporter only prints on completion). No-op locally.
    '<rootDir>/src/__tests__/setup/ciFileStartReporter.js',
  ],
  verbose: true,
  silent: true // Suppress console output during tests
};