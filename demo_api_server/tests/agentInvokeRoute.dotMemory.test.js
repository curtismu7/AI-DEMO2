'use strict';

// Dot working memory on the invoke path: a preference-shaped prompt after a
// successful run saves to the dot's own memory and the response names what was
// remembered; an ordinary prompt saves nothing. The store is real (LMDB via
// LMDB_PATH test override) so the route→store wiring is exercised, while the
// agent and auth layers are stubbed as in agentInvokeRoute.workloadAgents.test.js.

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { sub: 'dot-user-1' };
    next();
  },
}));
jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (req, _res, next) => {
    req.session = {
      id: 'session-dot-1',
      user: { sub: 'dot-user-1' },
      oauthTokens: { accessToken: 'session-token' },
    };
    req.agentContext = { tokenEvents: [] };
    req.tokenEvents = [];
    next();
  },
}));
jest.mock('../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async () => ({ reply: 'Done.', success: true, toolsCalled: [], tokenEvents: [] })),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => 'false'),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/lmdb/reportStore.lmdb', () => ({ saveRun: jest.fn() }));
jest.mock('../services/lmdb/conversationStore.lmdb', () => ({ saveMessage: jest.fn() }));

const { createDotMemoryStore } = require('../services/lmdb/dotMemoryStore.lmdb');

const app = express();
app.use('/api', require('../routes/agentInvokeRoute'));

// Isolated store per test run: point the route's singleton at a throwaway env.
let store;
beforeAll(() => {
  store = createDotMemoryStore({ now: () => Date.now() });
});
beforeEach(() => {
  require('../services/demoAgentLangGraphService').processAgentMessage.mockClear();
});

const invoke = (prompt) => request(app)
  .post('/api/agent/invoke')
  // Bearer token present so optionalAuthenticateToken resolves the subject —
  // without it the route treats the call as a guest (req.user = null) and
  // memories would scope to the guest bucket, not the sub.
  .set('Authorization', 'Bearer test-token')
  .send({ prompt, vertical: 'banking' });

describe('dot working memory on /api/agent/invoke', () => {
  test('a preference prompt saves a memory and the response names it', async () => {
    const res = await invoke('Always use a concise, technical tone in summaries. What is my balance?');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dotMemories).toEqual(['Always use a concise, technical tone in summaries.']);

    const store = createDotMemoryStore();
    const memories = store.getMemories('dot-user-1');
    expect(memories).toHaveLength(1);
    expect(memories[0].text).toBe('Always use a concise, technical tone in summaries.');
  });

  test('an ordinary prompt saves nothing', async () => {
    const before = createDotMemoryStore().getMemories('dot-user-1').length;
    const res = await invoke('What is my checking balance?');
    expect(res.status).toBe(200);
    expect(res.body.dotMemories).toBeUndefined();
    expect(createDotMemoryStore().getMemories('dot-user-1').length).toBe(before);
  });
});
