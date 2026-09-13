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
});
