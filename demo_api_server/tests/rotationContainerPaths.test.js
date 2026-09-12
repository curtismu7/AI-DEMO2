'use strict';

// Task 8 — the rotation feature is deployed in the BFF container, where the
// sources are bind-mounted TWICE:
//   /app   demo_api_server, with the image's own linux node_modules beside it
//   /repo  the whole host checkout, whose demo_api_server/node_modules is the
//          raw macOS/arm64 tree (its lmdb binding cannot load under Linux)
// Every demo_api_server path the rotation CLIs build must therefore land on
// /app, and refresh-service-envs' own two roots must not be derived from each
// other. Both defects are invisible natively, where the layouts collapse onto
// the same directories — hence these tests simulate the container explicitly.

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_API_ROOT = path.join(REPO_ROOT, 'demo_api_server');

/** Make fs.existsSync('/app/services') answer `inContainer`, everything else real. */
function stubContainerDetection(inContainer) {
  const real = fs.existsSync;
  jest.spyOn(fs, 'existsSync').mockImplementation(
    (p) => (p === '/app/services' ? inContainer : real(p)),
  );
}

/** The demo_api_server modules the CLIs require, published under /app. */
function virtualAppModules() {
  jest.doMock('/app/services/pingOneSecretRotation', () => ({
    isWorkerApp: () => false,
    regenerateClientSecret: async () => 's',
    verifySecret: async () => ({ ok: true, code: 'token_issued' }),
    fingerprint: () => 'deadbeef',
  }), { virtual: true });
  jest.doMock('/app/lib/vault', () => ({ openVault: async () => ({ close() {} }) }), { virtual: true });
  jest.doMock('/app/scripts/refresh-service-envs', () => ({
    propagateServiceEnvs: async () => {},
  }), { virtual: true });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('scripts/rotate-app-secret.js — DEMO_API_SERVER_ROOT', () => {
  test('container: resolves demo_api_server modules through /app, not /repo', () => {
    jest.resetModules();
    stubContainerDetection(true);
    virtualAppModules();
    const mod = require('../../scripts/rotate-app-secret');
    expect(mod.DEMO_API_SERVER_ROOT).toBe('/app');
  });

  test('native: unchanged — REPO_ROOT/demo_api_server', () => {
    jest.resetModules();
    stubContainerDetection(false);
    const mod = require('../../scripts/rotate-app-secret');
    expect(mod.DEMO_API_SERVER_ROOT).toBe(NATIVE_API_ROOT);
  });
});

describe('scripts/lib/rotateAppSecretCli.js — DEMO_API_SERVER_ROOT', () => {
  test('container: every demo_api_server require AND spawned CLI path uses /app', () => {
    jest.resetModules();
    stubContainerDetection(true);
    virtualAppModules();
    const mod = require('../../scripts/lib/rotateAppSecretCli');
    expect(mod.DEMO_API_SERVER_ROOT).toBe('/app');
    // The two node subprocesses: each resolves ITS OWN node_modules from where
    // the script file sits, so /repo here reintroduces the darwin lmdb binding.
    expect(mod.VAULT_CLI).toBe('/app/scripts/vault.js');
    expect(mod.DESCRIBE_APP_CLI).toBe('/app/scripts/describeApp.js');
  });

  test('native: unchanged — REPO_ROOT/demo_api_server for both CLIs', () => {
    jest.resetModules();
    stubContainerDetection(false);
    const mod = require('../../scripts/lib/rotateAppSecretCli');
    expect(mod.DEMO_API_SERVER_ROOT).toBe(NATIVE_API_ROOT);
    expect(mod.VAULT_CLI).toBe(path.join(NATIVE_API_ROOT, 'scripts/vault.js'));
    expect(mod.DESCRIBE_APP_CLI).toBe(path.join(NATIVE_API_ROOT, 'scripts/describeApp.js'));
  });
});

describe('refresh-service-envs.js — API_ROOT vs ROOT', () => {
  const saved = process.env.CODE_SEARCH_REPO_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.CODE_SEARCH_REPO_ROOT;
    else process.env.CODE_SEARCH_REPO_ROOT = saved;
  });

  test('API_ROOT is one level above scripts/, so /app/scripts → /app', () => {
    jest.resetModules();
    const modPath = require.resolve('../scripts/refresh-service-envs');
    const mod = require('../scripts/refresh-service-envs');
    expect(mod.API_ROOT).toBe(path.resolve(path.dirname(modPath), '..'));
    expect(mod.API_ENV).toBe(path.join(mod.API_ROOT, '.env'));
  });

  test('container: ROOT follows CODE_SEARCH_REPO_ROOT while API_ENV stays on /app', () => {
    jest.resetModules();
    process.env.CODE_SEARCH_REPO_ROOT = '/repo';
    const mod = require('../scripts/refresh-service-envs');
    // Pre-fix, ROOT was path.resolve(__dirname, '..', '..') — '/' in the
    // container, so scope-topology.json and demo_api_server/.env were both
    // read from paths that do not exist and getRotatableVaultKeyMap() threw,
    // 502ing GET /api/secret-rotation/apps.
    expect(mod.ROOT).toBe('/repo');
    // ...and API_ENV must NOT be rebuilt from ROOT: /app and /repo are two
    // different mounts, only one of which carries the loadable node_modules.
    expect(mod.API_ENV).not.toBe(path.join('/repo', 'demo_api_server', '.env'));
    expect(mod.API_ENV).toBe(path.join(mod.API_ROOT, '.env'));
  });

  test('native: ROOT is still the repo root when the env var is unset', () => {
    jest.resetModules();
    delete process.env.CODE_SEARCH_REPO_ROOT;
    const mod = require('../scripts/refresh-service-envs');
    expect(mod.ROOT).toBe(REPO_ROOT);
    expect(mod.API_ENV).toBe(path.join(REPO_ROOT, 'demo_api_server', '.env'));
  });
});
