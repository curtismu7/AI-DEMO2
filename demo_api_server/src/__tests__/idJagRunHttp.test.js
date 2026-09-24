'use strict';

const express = require('express');
const request = require('supertest');

const mockExecuteBffTool = jest.fn();
jest.mock('../../services/bffMcpToolExecutor', () => ({ executeBffTool: (...args) => mockExecuteBffTool(...args) }));
const mockProcessAgentMessage = jest.fn();
jest.mock('../../services/demoAgentLangGraphService', () => ({ processAgentMessage: (...args) => mockProcessAgentMessage(...args) }));
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { sub: 'user-1' };
    req.session = { id: 'session-1', oauthType: 'user', user: { id: 'user-1' }, oauthTokens: { accessToken: 'user-token' } };
    req.tokenEvents = [];
    next();
  },
  optionalAuthenticateToken: (req, _res, next) => {
    req.user = { sub: 'user-1' };
    req.session = { id: 'session-1', oauthType: 'user', user: { id: 'user-1' }, oauthTokens: { accessToken: 'user-token' } };
    req.tokenEvents = [];
    next();
  },
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = { get: (_id, cb) => cb(null, {
      user: { id: 'user-1' }, oauthType: 'user', oauthProvider: 'pingfederate',
      oauthTokens: { accessToken: 'user-token' },
    }) };
    require('../../services/agentRunContext').setRunContext('session-1', {
      useCaseId: 'enterprise-managed-mcp-authorization',
    }).toolNames = ['get_my_accounts'];
    next();
  });
  app.use('/internal', require('../../routes/agentTool'));
  return app;
}

test('agent tool response carries the ID-JAG login error and safe target', async () => {
  const error = new Error('PingFederate login required');
  error.code = 'id_jag_login_required';
  error.httpStatus = 401;
  error.loginTarget = '/pingfederate-id-jag/demo';
  mockExecuteBffTool.mockRejectedValueOnce(error);
  const res = await request(buildApp()).post('/internal/agent-tool')
    .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
    .send({ sessionId: 'session-1', tool: 'get_my_accounts', args: {} });
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ error: 'id_jag_login_required', loginTarget: error.loginTarget });
});

test('agent invoke response carries the ID-JAG provider error and safe target', async () => {
  const error = new Error('PingFederate login required');
  error.code = 'id_jag_provider_required';
  error.httpStatus = 401;
  error.loginTarget = '/pingfederate-id-jag/demo';
  mockProcessAgentMessage.mockRejectedValueOnce(error);
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../routes/agentInvokeRoute'));
  const res = await request(app).post('/api/agent/invoke').send({ prompt: 'show my balance' });
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ error: 'id_jag_provider_required', loginTarget: error.loginTarget });
});

test('UC40 invoke is rejected before a successful heuristic reply can mask the provider guard', async () => {
  mockProcessAgentMessage.mockResolvedValueOnce({ reply: 'ordinary response', success: true });
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../routes/agentInvokeRoute'));
  const res = await request(app).post('/api/agent/invoke')
    .send({ prompt: 'show my balance', useCaseId: 'enterprise-managed-mcp-authorization' });
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ error: 'id_jag_provider_required', loginTarget: '/pingfederate-id-jag/demo' });
  expect(mockProcessAgentMessage).not.toHaveBeenCalled();
});

test('UC40 demo-agent message is rejected before agent execution', async () => {
  mockProcessAgentMessage.mockResolvedValueOnce({ reply: 'ordinary response', success: true });
  const app = express();
  app.use(express.json());
  app.use('/api/demo-agent', require('../../routes/demoAgentRoutes'));
  const res = await request(app).post('/api/demo-agent/message')
    .send({ message: 'show my balance', useCaseId: 'enterprise-managed-mcp-authorization' });
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ error: 'id_jag_provider_required', loginTarget: '/pingfederate-id-jag/demo' });
  expect(mockProcessAgentMessage).not.toHaveBeenCalled();
});
