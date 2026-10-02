'use strict';

// Delegated commerce under a PingFederate sign-in. Each registered agent is its
// own PingOne application so that it — not the generic agent — is the actor.
// PingFederate had no client for it, so under PingFederate the generic agent
// acted in its place and consent failed with a 502. The agent now gets a
// PingFederate client with the same id and secret.

const mockAxios = jest.fn();
jest.mock('axios', () => (...args) => mockAxios(...args));

const mockConfig = {};
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => mockConfig[key] ?? null),
  getOAuthProvider: jest.fn(() => mockConfig.__provider || 'pingone'),
}));
jest.mock('../services/oauthService', () => ({ getClientCredentialsTokenAs: jest.fn() }));
jest.mock('../services/pingOneClientService', () => ({
  createApplication: jest.fn(),
  cloneApplicationGrants: jest.fn(async () => {}),
  deleteApplication: jest.fn(async () => {}),
}));
jest.mock('../services/scopeTopology', () => ({ resourceUri: jest.fn(() => 'agentgateway.ping.demo') }));
jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({
  put: jest.fn((record) => record),
  get: jest.fn(),
  remove: jest.fn(),
  encryptClientSecret: jest.fn(() => 'encrypted'),
}));
jest.mock('../services/delegatedCommerceRuntime', () => ({ holdCredentials: jest.fn(), removeCredentials: jest.fn() }));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({ findActiveByActorAndGrantor: jest.fn(() => null) }));
jest.mock('../services/delegationService', () => ({ revokeDelegation: jest.fn() }));
jest.mock('../services/pingOneUserService', () => ({ initialize: jest.fn(), clearMayActIfMatches: jest.fn(async () => true) }));
jest.mock('../services/pfStandardTokenExchangeService', () => ({
  resolveConfig: jest.fn(() => ({ tokenEndpoint: 'https://pf.example.test/as/token.oauth2', agentActorScope: 'agent:invoke' })),
  getActorToken: jest.fn(),
}));

const oauthService = require('../services/oauthService');
const pingOneClientService = require('../services/pingOneClientService');
const store = require('../services/lmdb/delegatedCommerceStore.lmdb');
const pingOneUserService = require('../services/pingOneUserService');
const pfExchange = require('../services/pfStandardTokenExchangeService');
const pingFederateClientService = require('../services/pingFederateClientService');
const delegatedCommerceService = require('../services/delegatedCommerceService');

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

const ENV_KEYS = ['PINGFEDERATE_ADMIN_API_BASE', 'PINGFEDERATE_ADMIN_PASSWORD', 'PINGFEDERATE_ADMIN_TLS_INSECURE'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const TEMPLATE = {
  clientId: 'pf-agent-actor', name: 'AI agent actor', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'],
  defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' },
  clientAuth: { type: 'SECRET', encryptedSecret: 'pf-encrypted-blob' },
  creationDate: '2026-09-01T00:00:00Z', modificationDate: '2026-09-02T00:00:00Z',
};

function pingFederateAnswers({ create = 201 } = {}) {
  mockAxios.mockImplementation(async ({ method, url }) => {
    if (method === 'GET') return { status: 200, data: TEMPLATE };
    if (method === 'POST') return { status: create, data: {} };
    if (method === 'DELETE') return { status: url.endsWith('/gone') ? 404 : 204, data: {} };
    return { status: 500, data: {} };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockConfig)) delete mockConfig[key];
  Object.assign(mockConfig, { pingone_ai_agent_client_id: 'p1-agent-template', pf_ai_agent_actor_client_id: 'pf-agent-actor' });
  process.env.PINGFEDERATE_ADMIN_API_BASE = 'https://pf.example.test:9999/pf-admin-api/v1';
  process.env.PINGFEDERATE_ADMIN_PASSWORD = 'admin-password';
  pingOneClientService.createApplication.mockResolvedValue({ id: 'agent-123', name: 'Shopper', clientSecret: 'agent-secret' });
  oauthService.getClientCredentialsTokenAs.mockResolvedValue(jwt({ client_id: 'agent-123', scope: 'agent:invoke' }));
  pfExchange.getActorToken.mockResolvedValue(jwt({ client_id: 'agent-123', scope: 'agent:invoke' }));
  pingFederateAnswers();
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('pingFederateClientService', () => {
  test('clones the AI-agent actor client under the agent\'s own id and secret', async () => {
    await pingFederateClientService.createAgentClient({ clientId: 'agent-123', clientSecret: 'agent-secret', name: 'Shopper' });

    const post = mockAxios.mock.calls.map(([arg]) => arg).find((arg) => arg.method === 'POST');
    expect(post.url).toBe('https://pf.example.test:9999/pf-admin-api/v1/oauth/clients');
    expect(post.data).toMatchObject({
      clientId: 'agent-123', name: 'Shopper', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'],
      defaultAccessTokenManagerRef: { id: 'aiDemoPfJwtAtm' }, clientAuth: { type: 'SECRET', secret: 'agent-secret' },
    });
    // The template's own secret and timestamps must not be copied onto the new client.
    expect(JSON.stringify(post.data)).not.toContain('pf-encrypted-blob');
    expect(post.data).not.toHaveProperty('creationDate');
  });

  test('deleting a client that is already gone is not an error', async () => {
    await expect(pingFederateClientService.deleteClient('gone')).resolves.toBe(false);
    await expect(pingFederateClientService.deleteClient('agent-123')).resolves.toBe(true);
  });

  test('a transport failure never carries the admin credentials out', async () => {
    mockAxios.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNREFUSED', config: { auth: { password: 'admin-password' } } }));
    const error = await pingFederateClientService.deleteClient('agent-123').catch((err) => err);
    expect(error.code).toBe('pf_admin_unreachable');
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('admin-password');
  });

  test('is not configured without an admin password', () => {
    delete process.env.PINGFEDERATE_ADMIN_PASSWORD;
    expect(pingFederateClientService.isConfigured()).toBe(false);
    mockConfig.PF_ADMIN_CONSOLE_PASSWORD = 'from-vault';
    expect(pingFederateClientService.isConfigured()).toBe(true);
  });
});

describe('register', () => {
  test('under PingFederate the agent gets a PingFederate client and proves itself there', async () => {
    mockConfig.__provider = 'pingfederate';

    const { registration } = await delegatedCommerceService.register({ name: 'Shopper', creatorUserId: 'admin-1' });

    expect(mockAxios.mock.calls.some(([arg]) => arg.method === 'POST' && arg.data.clientId === 'agent-123')).toBe(true);
    expect(pfExchange.getActorToken).toHaveBeenCalledWith(
      expect.objectContaining({ agentActorClientId: 'agent-123', agentActorClientSecret: 'agent-secret' }), 'agent',
    );
    expect(oauthService.getClientCredentialsTokenAs).not.toHaveBeenCalled();
    expect(registration.pfClient).toBe(true);
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ pfClient: true, applicationId: 'agent-123' }));
  });

  test('under PingFederate a failed PingFederate client fails the registration and removes the PingOne app', async () => {
    mockConfig.__provider = 'pingfederate';
    pingFederateAnswers({ create: 422 });

    await expect(delegatedCommerceService.register({ name: 'Shopper', creatorUserId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'pf_agent_client_create_failed' });
    expect(pingOneClientService.deleteApplication).toHaveBeenCalledWith('agent-123');
    expect(store.put).not.toHaveBeenCalled();
  });

  test('under PingOne a PingFederate failure does not fail the registration', async () => {
    pingFederateAnswers({ create: 500 });

    const { registration } = await delegatedCommerceService.register({ name: 'Shopper', creatorUserId: 'admin-1' });

    expect(registration.pfClient).toBe(false);
    expect(oauthService.getClientCredentialsTokenAs).toHaveBeenCalled();
    expect(pingOneClientService.deleteApplication).not.toHaveBeenCalled();
  });

  test('under PingOne with no PingFederate configured, PingFederate is never called', async () => {
    delete process.env.PINGFEDERATE_ADMIN_API_BASE;

    const { registration } = await delegatedCommerceService.register({ name: 'Shopper', creatorUserId: 'admin-1' });

    expect(mockAxios).not.toHaveBeenCalled();
    expect(registration.pfClient).toBe(false);
  });
});

describe('cleanup', () => {
  const record = {
    id: 'reg-1', applicationId: 'agent-123', marker: 'A&F delegated-commerce demo', creatorUserId: 'admin-1',
    claimedByUserId: 'demouser', claimedByPingOneUserId: 'p1-uuid', pfClient: true,
  };

  test('removes the PingFederate client and clears mayAct on the PingOne account', async () => {
    store.get.mockReturnValue(record);

    await delegatedCommerceService.cleanup('reg-1', 'admin-1');

    // The customer signed in through PingFederate: 'demouser' is not a PingOne id.
    expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('p1-uuid', 'agent-123');
    expect(mockAxios.mock.calls.some(([arg]) => arg.method === 'DELETE' && arg.url.endsWith('/oauth/clients/agent-123'))).toBe(true);
    expect(store.remove).toHaveBeenCalledWith('reg-1');
  });

  test('a registration with no PingFederate client does not call PingFederate', async () => {
    store.get.mockReturnValue({ ...record, pfClient: false, claimedByPingOneUserId: undefined });

    await delegatedCommerceService.cleanup('reg-1', 'admin-1');

    expect(mockAxios).not.toHaveBeenCalled();
    expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('demouser', 'agent-123');
  });
});
