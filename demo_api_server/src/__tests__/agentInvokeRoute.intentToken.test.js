'use strict';

process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';

// Note: setup.js calls jest.resetModules() in afterEach, which clears the module
// registry after every test. To ensure each test gets a fresh, consistent set of
// mocks AND a router that references those mocks, we re-require everything inside
// each test (after setting up jest.mock factories which survive resetModules).

jest.mock('../../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async () => ({
    toolsCalled: ['get_my_accounts'],
    response: 'Here are your accounts.',
    tokenEvents: [],
    agentPath: 'heuristic',
    confidence: 0.95,
  })),
}));
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (_req, _res, next) => {
    _req.user = { sub: 'user-test-123' };
    _req.session = {
      id: 'sess-test',
      user: { oauthId: 'user-test-123', email: 'test@example.com' },
      oauthTokens: { accessToken: 'tok' },
    };
    _req.tokenEvents = [];
    next();
  },
  optionalAuthenticateToken: (_req, _res, next) => {
    _req.user = { sub: 'user-test-123' };
    _req.session = {
      id: 'sess-test',
      user: { oauthId: 'user-test-123', email: 'test@example.com' },
      oauthTokens: { accessToken: 'tok' },
    };
    _req.tokenEvents = [];
    next();
  },
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));
jest.mock('../../services/promptGuard', () => ({
  guardPromptInput: jest.fn(() => null),
}));
jest.mock('../../services/lmdb/reportStore.lmdb', () => ({
  saveRun: jest.fn(),
}));

function buildApp() {
  const express = require('express');
  const router = require('../../routes/agentInvokeRoute');
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

test('POST /api/agent/invoke mints an intent token and attaches it to req', async () => {
  const request = require('supertest');
  const { processAgentMessage } = require('../../services/demoAgentLangGraphService');
  const configStore = require('../../services/configStore');

  // Default: ff_intent_token_enabled not set to 'false' → enabled
  configStore.getEffective.mockImplementation(() => null);

  const app = buildApp();

  await request(app)
    .post('/api/agent/invoke')
    .send({ prompt: 'show me my accounts' })
    .expect(200);

  expect(processAgentMessage).toHaveBeenCalledTimes(1);
  const callArgs = processAgentMessage.mock.calls[0][0];
  // The intent token must be attached to req before processAgentMessage is called
  expect(callArgs.req).toBeDefined();
  expect(callArgs.req.intentToken).toBeDefined();
  expect(typeof callArgs.req.intentToken).toBe('string');
  expect(callArgs.req.intentToken.split('.').length).toBe(3);
});

test('POST /api/agent/invoke does NOT mint intent token when ff_intent_token_enabled is false', async () => {
  const request = require('supertest');
  const { processAgentMessage } = require('../../services/demoAgentLangGraphService');
  const configStore = require('../../services/configStore');

  // Disable the feature flag; return null for all other keys
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'ff_intent_token_enabled') return 'false';
    return null;
  });

  const app = buildApp();

  await request(app)
    .post('/api/agent/invoke')
    .send({ prompt: 'show me my accounts' })
    .expect(200);

  expect(processAgentMessage).toHaveBeenCalledTimes(1);
  const callArgs = processAgentMessage.mock.calls[0][0];
  expect(callArgs.req).toBeDefined();
  // req.intentToken must NOT be set when the flag is disabled
  expect(callArgs.req.intentToken).toBeUndefined();
});
