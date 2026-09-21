'use strict';

const mockRecords = new Map();
jest.mock('../../services/lmdb/personalAgentCimdStore.lmdb', () => ({
  put: (record) => mockRecords.set(record.userKey, record),
  get: (userKey) => mockRecords.get(userKey) || null,
  loadAll: () => [...mockRecords.entries()],
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
});
