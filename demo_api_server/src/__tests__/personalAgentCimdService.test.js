'use strict';

const mockRecords = new Map();
jest.mock('../../services/lmdb/personalAgentCimdStore.lmdb', () => ({
  put: (record) => mockRecords.set(record.userKey, record),
  get: (userKey) => mockRecords.get(userKey) || null,
  loadAll: () => [...mockRecords.entries()],
  remove: (userKey) => mockRecords.delete(userKey),
  clearAll: () => mockRecords.clear(),
}));
jest.mock('../../services/oauthClientRegistry', () => ({
  registerClientByUrl: jest.fn(async (url, _metadata, options) => {
    const response = await options.fetchImpl(url);
    const document = await response.json();
    return {
      ok: true,
      steps: [
        { step: 'fetch', status: 'success', engine: 'mock', detail: { url } },
        { step: 'validate', status: 'success', engine: 'mock', detail: { client_name: document.client_name } },
        { step: 'register', status: 'success', engine: 'mock', detail: { client_id: url } },
      ],
    };
  }),
  deleteClient: jest.fn(),
  clearRegistry: jest.fn(),
}));

const cimdService = require('../../services/personalAgentCimdService');
const cimdStore = require('../../services/lmdb/personalAgentCimdStore.lmdb');
const oauthClientRegistry = require('../../services/oauthClientRegistry');

describe('personal-agent CIMD facade', () => {
  const user = { id: 'user-123', oauthId: 'ping-sub-123', username: 'alex', email: 'alex@example.test' };
  const agent = { id: 'ping-agent-123', name: 'AI Agent - alex', type: 'AI_AGENT' };

  beforeEach(() => {
    cimdStore.clearAll();
    oauthClientRegistry.clearRegistry();
  });

  test('automatically registers a public-safe CIMD document linked to the PingOne agent', async () => {
    const result = await cimdService.registerPersonalAgentCimd(user, agent);

    expect(result.ok).toBe(true);
    expect(result.mocked).toBe(true);
    expect(result.pingoneAgentId).toBe(agent.id);
    expect(result.metadataUrl).toMatch(/\/api\/cimd\/personal-agents\/[^/]+\/client-metadata\.json$/);
    expect(result.clientId).toBe(result.metadataUrl);
    expect(result.steps.map((step) => step.step)).toEqual(['fetch', 'validate', 'register']);
    expect(result).not.toHaveProperty('client_secret');

    const saved = cimdService.getPersonalAgentCimd(user);
    expect(saved).toMatchObject({
      userKey: user.oauthId,
      pingoneAgentId: agent.id,
      registrationType: 'cimd-facade',
      status: 'registered',
      metadataUrl: result.metadataUrl,
    });
    expect(saved.metadata).not.toHaveProperty('client_secret');
  });

  test('is idempotent for the same user and PingOne agent', async () => {
    const first = await cimdService.registerPersonalAgentCimd(user, agent);
    const second = await cimdService.registerPersonalAgentCimd(user, agent);

    expect(second.created).toBe(false);
    expect(second.metadataUrl).toBe(first.metadataUrl);
    expect(cimdStore.loadAll()).toHaveLength(1);
  });

  test('does not disclose another user\'s registration', async () => {
    await cimdService.registerPersonalAgentCimd(user, agent);

    expect(cimdService.getPersonalAgentCimd({ oauthId: 'other-sub', id: 'other-id' })).toBeNull();
  });

  test('retries a failed registration for the same user and agent', async () => {
    oauthClientRegistry.registerClientByUrl.mockRejectedValueOnce(new Error('temporary registry outage'));

    const failed = await cimdService.registerPersonalAgentCimd(user, agent);
    expect(failed.status).toBe('failed');

    const retried = await cimdService.registerPersonalAgentCimd(user, agent);
    expect(retried.ok).toBe(true);
    expect(retried.status).toBe('registered');
    expect(retried.created).toBe(true);
    expect(oauthClientRegistry.registerClientByUrl).toHaveBeenCalledTimes(2);
  });

  test('sanitizes username characters before mock registry validation', async () => {
    const result = await cimdService.registerPersonalAgentCimd(
      { ...user, username: 'alex.smith+demo' },
      agent,
    );

    expect(result.metadata.client_name).toMatch(/^[A-Za-z0-9 _-]+$/);
    expect(result.status).toBe('registered');
  });

  test('removes the mocked registration during agent cleanup', async () => {
    const result = await cimdService.registerPersonalAgentCimd(user, agent);

    expect(await cimdService.removePersonalAgentCimd(user, agent.id)).toMatchObject({ removed: true });
    expect(oauthClientRegistry.deleteClient).toHaveBeenCalledWith(
      result.clientId,
      expect.objectContaining({ deletedBy: 'personal-agent-cimd-cleanup' }),
    );
    expect(cimdService.getPersonalAgentCimd(user)).toBeNull();
  });
});
