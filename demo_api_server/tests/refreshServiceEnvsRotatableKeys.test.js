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

  test('EXCLUDES the worker — rotating it destroys the credential this tool uses', async () => {
    const map = await getRotatableVaultKeyMap(deps());
    expect(map['worker-id']).toBeUndefined();
    expect(map['app-wk']).toBeUndefined();
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
});
