'use strict';

// Mock all external deps before any require
jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { id: 'u1', sub: 'u1', role: 'user' };
    next();
  },
}));

jest.mock('../services/agentPreflightService', () => ({
  evaluate: jest.fn(),
}));

// Silence all other authorize.js deps
jest.mock('../services/pingOneAuthorizeService', () => ({
  getRecentDecisions: jest.fn(),
  getDecisionEndpoints: jest.fn(),
  isConfigured: jest.fn(() => false),
  isWorkerCredentialReady: jest.fn(() => false),
  provisionDemoDecisionEndpoints: jest.fn(),
  evaluateTransaction: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));
jest.mock('../services/simulatedAuthorizeService', () => ({
  getSimulatedRecentDecisions: jest.fn(() => []),
  evaluateTransaction: jest.fn(),
  getDenyAmountUsd: jest.fn(() => 1000),
  getStepUpAmountUsd: jest.fn(() => 500),
  getConfirmAmountUsd: jest.fn(() => 100),
  getConsentTypes: jest.fn(() => []),
  getStepUpTypes: jest.fn(() => []),
  isSimulatedModeEnabled: jest.fn(() => true),
}));
jest.mock('../services/transactionAuthorizationService', () => ({
  getAuthorizationStatusSummary: jest.fn(() => ({})),
}));
jest.mock('../services/mcpToolAuthorizationService', () => ({
  getMcpFirstToolGateStatus: jest.fn(() => ({})),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

const express = require('express');
const request = require('supertest');
const agentPreflightService = require('../services/agentPreflightService');
const { evaluate: mockEvaluate } = agentPreflightService;

// Build the app once — the route module is cached by Jest, so rebuilding per-test
// does not help; using a shared app avoids any confusion.
const app = express();
app.use(express.json());
app.use('/api/authorize', require('../routes/authorize'));

describe('POST /api/authorize/pre-flight', () => {
  beforeEach(() => mockEvaluate.mockClear());

  test('400 when tool missing', async () => {
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tool_required');
  });

  test('400 when tool is empty string', async () => {
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tool_required');
  });

  test('400 when params is array', async () => {
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: 'get_accounts', params: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('params_invalid');
  });

  test('200 PERMIT decision forwarded', async () => {
    mockEvaluate.mockResolvedValueOnce({ decision: 'PERMIT', engine: 'simulated' });
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: 'get_accounts', params: {} });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('PERMIT');
    expect(mockEvaluate).toHaveBeenCalledWith(expect.objectContaining({ tool: 'get_accounts' }));
  });

  test('200 HITL decision with challengeId forwarded', async () => {
    mockEvaluate.mockResolvedValueOnce({
      decision: 'HITL',
      type: 'consent',
      challengeId: 'ch-123',
      expiresAt: '2099-01-01T00:00:00Z',
      directives: { type: 'consent', challengeId: 'ch-123' },
    });
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: 'create_transfer', params: { amount: 600 } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('HITL');
    expect(res.body.challengeId).toBe('ch-123');
  });

  test('500 when evaluate throws', async () => {
    mockEvaluate.mockRejectedValueOnce(new Error('unexpected'));
    const res = await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: 'get_accounts' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('preflight_error');
  });

  test('consentGiven=true forwarded to evaluate', async () => {
    mockEvaluate.mockResolvedValueOnce({ decision: 'PERMIT', reason: 'consent_given' });
    await request(app)
      .post('/api/authorize/pre-flight')
      .send({ tool: 'create_transfer', consentGiven: true });
    expect(mockEvaluate).toHaveBeenCalledWith(expect.objectContaining({ consentGiven: true }));
  });
});
