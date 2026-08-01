module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // ESM-only packages — Jest runs CJS, so redirect them to minimal CJS shims.
  // uuid v9+: shim returns RFC 4122 v4 UUIDs via Node crypto.
  // jose v6+: shim returns stub functions; tests mock the callers.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/src/__mocks__/uuid-cjs.js',
    '^jose$': '<rootDir>/src/__mocks__/jose-cjs.js',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};