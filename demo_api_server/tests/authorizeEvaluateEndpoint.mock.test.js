'use strict';

// Inspector console "Mock" mode: POST /api/authorize/evaluate-endpoint with mode:'mock' answers from the simulated
// engine, needs no worker or endpoint, and leaves the Live path as it was.
jest.mock('../services/configStore', () => ({ get: jest.fn(() => null), getEffective: jest.fn(() => null) }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', sub: 'u1', role: 'user' }; next(); },
  optionalAuthenticateToken: (_req, _res, next) => next(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  getRecentDecisions: jest.fn(), getDecisionEndpoints: jest.fn(), isConfigured: jest.fn(() => false),
  isWorkerCredentialReady: jest.fn(() => false), provisionDemoDecisionEndpoints: jest.fn(), evaluateTransaction: jest.fn(),
  evaluateDecisionEndpoint: jest.fn(), isMcpDelegationDecisionReady: jest.fn(() => false), peekWorkerToken: jest.fn(),
}));
jest.mock('../services/simulatedAuthorizeService', () => ({
  getSimulatedRecentDecisions: jest.fn(() => []),
  evaluateTransaction: jest.fn(async ({ amount }) => (amount > 2000
    ? { decision: 'DENY', stepUpRequired: false, path: 'simulated', decisionId: 'sim-1', raw: { parameters: {} } }
    : { decision: 'PERMIT', stepUpRequired: false, path: 'simulated', decisionId: 'sim-2', raw: { parameters: {} } })),
  evaluateMcpFirstTool: jest.fn(async ({ toolName }) => ({ decision: 'PERMIT', stepUpRequired: false, consentRequired: toolName === 'create_transfer', path: 'simulated-mcp', decisionId: 'sim-mcp-1', raw: {} })),
  getDenyAmountUsd: jest.fn(() => 2000), getStepUpAmountUsd: jest.fn(() => 500), getConfirmAmountUsd: jest.fn(() => 250),
  getConsentTypes: jest.fn(() => []), getStepUpTypes: jest.fn(() => []), isSimulatedModeEnabled: jest.fn(() => true),
}));
jest.mock('../services/transactionAuthorizationService', () => ({ getAuthorizationStatusSummary: jest.fn(() => ({})) }));
jest.mock('../services/mcpToolAuthorizationService', () => ({ getMcpFirstToolGateStatus: jest.fn(() => ({})) }));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const express = require('express');
const request = require('supertest');
const pingone = require('../services/pingOneAuthorizeService');
const sim = require('../services/simulatedAuthorizeService');

const app = express();
app.use(express.json());
app.use('/api/authorize', require('../routes/authorize'));
const post = (body) => request(app).post('/api/authorize/evaluate-endpoint').send(body);

describe('evaluate-endpoint mode:mock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers a Transaction from the simulated engine with no worker and no endpoint', async () => {
    const res = await post({ mode: 'mock', parameters: { Amount: 5000, TransactionType: 'transfer', UserId: 'u' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, decision: 'DENY', engine: 'simulated', decisionId: 'sim-1', endpointId: null });
    expect(sim.evaluateTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, type: 'transfer', userId: 'u' }));
    expect(pingone.isWorkerCredentialReady).not.toHaveBeenCalled();
    expect(pingone.evaluateDecisionEndpoint).not.toHaveBeenCalled();
  });

  it('answers an MCP tool request and carries the consent flag', async () => {
    const res = await post({ mode: 'mock', parameters: { DecisionContext: 'McpFirstTool', ToolName: 'create_transfer', UserId: 'u', HitlApproved: true } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ engine: 'simulated', consentRequired: true, hitlRequired: true });
    expect(sim.evaluateMcpFirstTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'create_transfer', hitlApproved: true }));
  });

  it('says so for a request the simulated engine cannot read, and for a bad body', async () => {
    const unsupported = await post({ mode: 'mock', parameters: { Foo: 'bar' } });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error).toBe('mock_unsupported_request');
    expect((await post({ mode: 'mock', parameters: [] })).status).toBe(400);
  });

  it('leaves Live as it was: still needs worker credentials', async () => {
    const res = await post({ endpointId: 'ep1', parameters: { Amount: 1 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('pingone_not_configured');
  });
});
