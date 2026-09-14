'use strict';

// C2/I6: the vault key a rotation writes to must be derived on the SERVER from
// the same table refresh-service-envs reads back. The page used to invent one
// from the app's display name, which can never equal a real vault entry — the
// new secret landed under a dead key while the live key kept the old value.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API_ENV = path.join(ROOT, 'demo_api_server', '.env');

const { getRotatableVaultKeyMap } = require('../scripts/refresh-service-envs');

const ENV_TEXT = [
  'PINGONE_ENVIRONMENT_ID=env-1',
  'PINGONE_REGION=com',
  'PINGONE_WORKER_CLIENT_ID=worker-id',
  'PINGONE_WORKER_CLIENT_SECRET=worker-secret',
].join('\n');

// resolveApps' real shape: logicalKey -> { id, clientId, name, via }.
const RESOLVED = {
  mcpGateway:     { id: 'app-gw',  clientId: 'cid-gw',  name: 'GW',  via: 'clientId' },
  mcpExchanger:   { id: 'app-ex',  clientId: 'cid-ex',  name: 'EX',  via: 'clientId' },
  step9Exchanger: { id: 'app-s9',  clientId: 'cid-s9',  name: 'S9',  via: 'clientId' },
  aiAgent:        { id: 'app-ai',  clientId: 'cid-ai',  name: 'AI',  via: 'clientId' },
  agent:          { id: 'app-ag',  clientId: 'cid-ag',  name: 'AG',  via: 'clientId' },
  mcpServer:      { id: 'app-ms',  clientId: 'cid-ms',  name: 'MS',  via: 'clientId' },
  worker:         { id: 'app-wk',  clientId: 'worker-id', name: 'WK', via: 'clientId' },
};

function deps() {
  return {
    getWorkerToken: jest.fn().mockResolvedValue('tok'),
    resolveApps: jest.fn().mockResolvedValue(RESOLVED),
    // The worker's own id/secret are mandatory env vars, so now that the
    // worker is itself a DIRECT_VAULT_KEY_ENV_PAIRS entry, the "direct apps"
    // lookup is never empty — listAllApps always runs. Default it to a no-op
    // mock so tests that don't care about direct apps don't hit the network.
    listAllApps: jest.fn().mockResolvedValue([]),
    // Default to "vault has nothing for this key" so every existing test
    // keeps falling back to apiVars's PINGONE_WORKER_CLIENT_SECRET exactly
    // as before this mock was added.
    loadVaultSecrets: jest.fn().mockResolvedValue({}),
  };
}

describe('getRotatableVaultKeyMap', () => {
  let realExists;
  let realRead;

  beforeEach(() => {
    realExists = fs.existsSync;
    realRead = fs.readFileSync;
    fs.existsSync = (p) => (p === API_ENV ? true : realExists(p));
    fs.readFileSync = (p, enc) => (p === API_ENV ? ENV_TEXT : realRead(p, enc));
  });
  afterEach(() => {
    fs.existsSync = realExists;
    fs.readFileSync = realRead;
  });

  test('maps each rotatable app to the vault entry refresh-service-envs reads back', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(map['cid-gw']).toBe('PINGONE_MCP_GATEWAY_CLIENT_SECRET');
    expect(map['cid-ex']).toBe('PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET');
    expect(map['cid-s9']).toBe('PINGONE_MCP_EXCHANGER_CLIENT_SECRET');
    expect(map['cid-ai']).toBe('PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET');
    expect(map['cid-ag']).toBe('AGENT_CLIENT_SECRET');
  });

  test('excludes an app with no vault-key counterpart in the creds block', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(map['cid-ms']).toBeUndefined();
  });

  test('is keyed by application id as well, which is all POST /start receives', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(map['app-gw']).toBe('PINGONE_MCP_GATEWAY_CLIENT_SECRET');
  });

  test('never invents a key from a display name', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(Object.values(map)).not.toContain('GW_CLIENT_SECRET');
  });

  test('throws rather than returning an empty map when worker creds are absent', async () => {
    fs.readFileSync = (p, enc) => (p === API_ENV ? 'PINGONE_REGION=com' : realRead(p, enc));
    await expect(getRotatableVaultKeyMap(deps())).rejects.toThrow(/worker credentials/i);
  });

  // Finding 3 (2026-09-13 fix-wave): this function had its own, separate
  // worker-token resolution that never got main()'s vault-first fix — GET
  // /apps and POST /start's preflight both call it, so every call to either
  // endpoint 502'd after a worker rotation, not just a repeat rotation of
  // the worker itself. Mirrors refreshServiceEnvsWorkerVaultFirst.test.js's
  // proof for main().
  test('prefers a vault-supplied worker secret over the stale .env value', async () => {
    const d = deps();
    d.loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'new-rotated-secret' });
    await getRotatableVaultKeyMap(d);
    expect(d.getWorkerToken).toHaveBeenCalledWith('env-1', 'worker-id', 'new-rotated-secret', 'com');
  });

  // 2026-09-13 TECH_DEBT fix: mirrors refreshServiceEnvsWorkerVaultFirst.test.js's
  // proof for main() — this function has its own separate worker-token
  // resolution and needs the same retry.
  test('retries with the .env value when the vault-supplied secret fails to mint', async () => {
    const d = deps();
    d.getWorkerToken = jest.fn()
      .mockRejectedValueOnce(new Error('invalid_client'))
      .mockResolvedValueOnce('tok');
    d.loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'stale-vault-secret' });
    await getRotatableVaultKeyMap(d);
    expect(d.getWorkerToken).toHaveBeenCalledTimes(2);
    expect(d.getWorkerToken).toHaveBeenNthCalledWith(1, 'env-1', 'worker-id', 'stale-vault-secret', 'com');
    expect(d.getWorkerToken).toHaveBeenNthCalledWith(2, 'env-1', 'worker-id', 'worker-secret', 'com');
  });

  test('when the .env value is identical to the vault value, the original error propagates (no second attempt)', async () => {
    const d = deps();
    d.getWorkerToken = jest.fn().mockRejectedValue(new Error('invalid_client'));
    // ENV_TEXT's PINGONE_WORKER_CLIENT_SECRET is 'worker-secret' — same as the vault value here.
    d.loadVaultSecrets = jest.fn().mockResolvedValue({ PINGONE_WORKER_CLIENT_SECRET: 'worker-secret' });
    await expect(getRotatableVaultKeyMap(d)).rejects.toThrow('invalid_client');
    expect(d.getWorkerToken).toHaveBeenCalledTimes(1);
  });
});

// 2026-09-13: expanded from 5 apps to this demo's own admin/agent apps whose
// clientId is already known directly from .env — no PingOne name resolution
// needed. Confirmed with the user: worker, other engineers' personal tooling,
// and PKCE-only public clients (no secret) stay excluded.
describe('getRotatableVaultKeyMap — direct .env-known apps', () => {
  let realExists;
  let realRead;

  const DIRECT_ENV_TEXT = [
    ENV_TEXT,
    'PINGONE_ADMIN_CLIENT_ID=cid-admin',
    'PINGONE_FRAUD_WATCH_AGENT_CLIENT_ID=cid-fraud',
    'PINGONE_BALANCE_SWEEP_AGENT_CLIENT_ID=cid-balance',
    'ENTERPRISE_IDP_PINGONE_CLIENT_ID=cid-idp',
    'PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID=cid-a2a-investment',
  ].join('\n');

  const ALL_APPS = [
    { id: 'app-admin',   clientId: 'cid-admin' },
    { id: 'app-fraud',   clientId: 'cid-fraud' },
    { id: 'app-balance', clientId: 'cid-balance' },
    { id: 'app-idp',     clientId: 'cid-idp' },
    { id: 'app-a2a-inv', clientId: 'cid-a2a-investment' },
    // A app that is NOT in any rotatable table (e.g. Grafana Login, left out
    // deliberately) must never show up in the map.
    { id: 'app-grafana', clientId: 'cid-grafana' },
  ];

  function directDeps() {
    return {
      ...deps(),
      listAllApps: jest.fn().mockResolvedValue(ALL_APPS),
    };
  }

  beforeEach(() => {
    realExists = fs.existsSync;
    realRead = fs.readFileSync;
    fs.existsSync = (p) => (p === API_ENV ? true : realExists(p));
    fs.readFileSync = (p, enc) => (p === API_ENV ? DIRECT_ENV_TEXT : realRead(p, enc));
  });
  afterEach(() => {
    fs.existsSync = realExists;
    fs.readFileSync = realRead;
  });

  test('maps the admin, fraud/balance agent, IdP federation, and an A2A specialist app', async () => {
    const map = await getRotatableVaultKeyMap(directDeps());
    expect(map['cid-admin']).toBe('PINGONE_ADMIN_CLIENT_SECRET');
    expect(map['cid-fraud']).toBe('PINGONE_FRAUD_WATCH_AGENT_CLIENT_SECRET');
    expect(map['cid-balance']).toBe('PINGONE_BALANCE_SWEEP_AGENT_CLIENT_SECRET');
    expect(map['cid-idp']).toBe('ENTERPRISE_IDP_PINGONE_CLIENT_SECRET');
    expect(map['cid-a2a-investment']).toBe('PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET');
  });

  test('is keyed by application id too, which is all POST /start receives', async () => {
    const map = await getRotatableVaultKeyMap(directDeps());
    expect(map['app-admin']).toBe('PINGONE_ADMIN_CLIENT_SECRET');
    expect(map['app-a2a-inv']).toBe('PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET');
  });

  test('excludes an app with no direct .env mapping, even if it exists in PingOne', async () => {
    const map = await getRotatableVaultKeyMap(directDeps());
    expect(map['cid-grafana']).toBeUndefined();
    expect(map['app-grafana']).toBeUndefined();
  });

  // 2026-09-13: "never calls listAllApps when no direct apps are configured"
  // is no longer a reachable scenario — the worker's id/secret are mandatory
  // env vars, and the worker is now itself a DIRECT_VAULT_KEY_ENV_PAIRS entry,
  // so "no direct apps configured" can't happen. Test removed; superseded by
  // the "includes the worker" case below, which exercises the same listAllApps
  // call path this test used to assert never ran.

  // 2026-09-13: the worker is no longer excluded. Task 1's vault-first fix
  // inside main()'s own worker-token resolution is what makes rotating it
  // safe for the CLI's own mid-run propagation step; this map's job is just
  // to say "the worker is a rotatable app now", same as any other direct app.
  test('includes the worker once DIRECT_VAULT_KEY_ENV_PAIRS covers it, keyed by id and clientId', async () => {
    const allAppsWithWorker = [...ALL_APPS, { id: 'app-worker', clientId: 'worker-id' }];
    const map = await getRotatableVaultKeyMap({
      ...deps(),
      listAllApps: jest.fn().mockResolvedValue(allAppsWithWorker),
    });
    expect(map['worker-id']).toBe('PINGONE_WORKER_CLIENT_SECRET');
    expect(map['app-worker']).toBe('PINGONE_WORKER_CLIENT_SECRET');
  });
});
