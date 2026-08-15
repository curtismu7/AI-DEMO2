'use strict';

process.env.SESSION_SECRET = 'test-secret-for-mcp-authz-eval-tests-32ch';

// Final whole-branch review finding: agentInvokeRoute.js copied only the
// SINGULAR req._mcpAuthorizeEvaluation onto the response envelope, never the
// PLURAL req._mcpAuthorizeEvaluations — so the agent-invoke path (Demo Steps
// / scripted use-case chips, and the path that produced the original bug
// report) never returned the second Token Chain card even when
// bffMcpToolExecutor.js had stashed it on req. This proves the copy mirrors
// the singular field exactly, for both fields, at PHASE 5 of the route.
//
// processAgentMessage is mocked (per the existing agentInvokeRoute.intentToken.test.js
// pattern) — its mock implementation stamps req._mcpAuthorizeEvaluations directly,
// simulating what the real (un-mocked) executeBffTool -> bffMcpToolExecutor.js
// stash would have done deep inside the real agent call chain. Combined with
// bffMcpToolExecutor.authorizeEvaluationsStash.test.js (which proves that stash
// actually happens from a pipeline outcome), this proves the field's full path:
// pipeline outcome -> req._mcpAuthorizeEvaluations -> agentResponse.mcpAuthorizeEvaluations
// -> JSON response body.

// Note: setup.js calls jest.resetModules() in afterEach, which clears the module
// registry after every test — so each test re-requires everything after setting
// up mock factories, matching the pattern in agentInvokeRoute.intentToken.test.js.

jest.mock('../../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(),
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

test('POST /api/agent/invoke copies req._mcpAuthorizeEvaluations onto the response body, mirroring the singular field', async () => {
  const evaluations = [
    { decision: 'PERMIT', decisionId: 'gate-1', engine: 'pingone', decisionContext: 'McpFirstTool' },
    { decision: 'DENY', decisionId: 'limit-1', engine: 'pingone', decisionContext: 'TransactionAmount' },
  ];
  const { processAgentMessage } = require('../../services/demoAgentLangGraphService');
  processAgentMessage.mockImplementation(async ({ req }) => {
    // Simulate what bffMcpToolExecutor.js stashes on req deep inside the
    // real (un-mocked) agent call chain.
    req._mcpAuthorizeEvaluation = { decision: 'DENY', decisionId: 'limit-1' };
    req._mcpAuthorizeEvaluations = evaluations;
    return {
      toolsCalled: ['create_transfer'],
      response: 'Transfer failed: PingOne Authorize denied MCP tool access for this session.',
      tokenEvents: [],
      agentPath: 'heuristic',
      confidence: 0.95,
      success: false,
    };
  });

  const request = require('supertest');
  const app = buildApp();

  const res = await request(app)
    .post('/api/agent/invoke')
    .send({ prompt: 'transfer $2500 from checking to savings' })
    .expect(200);

  expect(res.body.mcpAuthorizeEvaluation).toEqual({ decision: 'DENY', decisionId: 'limit-1' });
  expect(res.body.mcpAuthorizeEvaluations).toEqual(evaluations);
});

test('POST /api/agent/invoke leaves mcpAuthorizeEvaluations absent when req never got stamped', async () => {
  const { processAgentMessage } = require('../../services/demoAgentLangGraphService');
  processAgentMessage.mockImplementation(async () => ({
    toolsCalled: ['get_my_accounts'],
    response: 'Here are your accounts.',
    tokenEvents: [],
    agentPath: 'heuristic',
    confidence: 0.95,
  }));

  const request = require('supertest');
  const app = buildApp();

  const res = await request(app)
    .post('/api/agent/invoke')
    .send({ prompt: 'show me my accounts' })
    .expect(200);

  expect(res.body.mcpAuthorizeEvaluations).toBeUndefined();
});
