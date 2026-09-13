'use strict';

// The rotation CLI calls propagateServiceEnvs() (this file's main(), exported
// as propagateServiceEnvs) AFTER vaultSet() has already written a freshly
// rotated worker secret to the vault, but BEFORE demo-api-server has been
// restarted — so apiVars.PINGONE_WORKER_CLIENT_SECRET (read from the raw
// .env file) is still the OLD, now-dead value at this point. Without this
// fix, main()'s own getWorkerToken() call fails with invalid_client and the
// other 11 services' .env files never get re-derived in that pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_ENV = path.join(ROOT, 'demo_api_server', '.env');

const ENV_TEXT = [
  'PINGONE_ENVIRONMENT_ID=env-1',
  'PINGONE_REGION=com',
  'PINGONE_WORKER_CLIENT_ID=worker-id',
  'PINGONE_WORKER_CLIENT_SECRET=old-dead-secret',
].join('\n');

describe('refresh-service-envs main() — worker token is vault-first', () => {
  let realExists;
  let realRead;
  let mod;

  beforeEach(() => {
    jest.resetModules();
    realExists = fs.existsSync;
    realRead = fs.readFileSync;
    fs.existsSync = (p) => (p === API_ENV ? true : realExists(p));
    fs.readFileSync = (p, enc) => (p === API_ENV ? ENV_TEXT : realRead(p, enc));
    mod = require('../scripts/refresh-service-envs');
  });

  afterEach(() => {
    fs.existsSync = realExists;
    fs.readFileSync = realRead;
  });

  test('prefers a vault-supplied worker secret over the stale .env value', async () => {
    const getWorkerToken = jest.fn().mockResolvedValue('tok');
    const loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'new-rotated-secret' });
    // main() takes no deps today — Step 3 adds an optional deps param so this
    // test (and only this test) can observe which secret reached getWorkerToken.
    await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets }).catch(() => {});
    expect(getWorkerToken).toHaveBeenCalledWith('env-1', 'worker-id', 'new-rotated-secret', 'com');
  });

  test('falls back to the .env value when the vault has nothing for this key', async () => {
    const getWorkerToken = jest.fn().mockResolvedValue('tok');
    const loadVaultSecrets = jest.fn().mockResolvedValue({});
    await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets }).catch(() => {});
    expect(getWorkerToken).toHaveBeenCalledWith('env-1', 'worker-id', 'old-dead-secret', 'com');
  });

  // 2026-09-13 TECH_DEBT fix: vault-vs-.env drift on this one credential must
  // not block the whole run — retry once with the .env value.
  test('retries with the .env value when the vault-supplied secret fails to mint', async () => {
    const getWorkerToken = jest.fn()
      .mockRejectedValueOnce(new Error('invalid_client'))
      .mockResolvedValueOnce('tok');
    const loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'stale-vault-secret' });
    await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets }).catch(() => {});
    expect(getWorkerToken).toHaveBeenCalledTimes(2);
    expect(getWorkerToken).toHaveBeenNthCalledWith(1, 'env-1', 'worker-id', 'stale-vault-secret', 'com');
    expect(getWorkerToken).toHaveBeenNthCalledWith(2, 'env-1', 'worker-id', 'old-dead-secret', 'com');
  });

  test('when the .env value is identical to the vault value, the original error propagates as a skip (no second attempt)', async () => {
    const getWorkerToken = jest.fn().mockRejectedValue(new Error('invalid_client'));
    // Vault value equals the .env value read from ENV_TEXT ('old-dead-secret') —
    // no real fallback available.
    const loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'old-dead-secret' });
    let caught = null;
    try {
      await mod.propagateServiceEnvs({ getWorkerToken, loadVaultSecrets });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.skipped).toBe(true); // degrades non-fatally exactly as before, not a new uncaught throw
    expect(getWorkerToken).toHaveBeenCalledTimes(1);
  });
});
