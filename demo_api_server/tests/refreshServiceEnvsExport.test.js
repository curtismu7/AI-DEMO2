'use strict';

describe('refresh-service-envs exports', () => {
  test('exposes propagateServiceEnvs for programmatic callers', () => {
    const mod = require('../scripts/refresh-service-envs');
    expect(typeof mod.propagateServiceEnvs).toBe('function');
  });

  test('still exports the helpers its existing tests use', () => {
    const mod = require('../scripts/refresh-service-envs');
    expect(typeof mod.loadVaultSecrets).toBe('function');
    expect(typeof mod.writeEnvFile).toBe('function');
    expect(typeof mod.dotenvxPlain).toBe('function');
  });
});
