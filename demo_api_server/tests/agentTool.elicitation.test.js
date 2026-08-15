'use strict';

/**
 * /internal/agent-tool normalizes a gateway ELICITATION obligation the same
 * way it already normalizes HITL/step-up: into the single hitlRequired
 * envelope demo_agent_service's extractHitlInterrupt() reads generically
 * (hitlRequired, consentId, reason, message) — no agent-service code change
 * needed. `reason: 'elicitation_required'` is what lets the UI (a later,
 * separate change) pick the elicitation retry args (_elicitation_confirmed
 * + _elicitation_id) instead of _hitl_challenge_id.
 */

const express = require('express');
const supertest = require('supertest');

jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(),
}));
jest.mock('../services/a2aDelegationService', () => ({
  isA2aEnabled: () => false,
}));

const { executeBffTool } = require('../services/bffMcpToolExecutor');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = {
      get: (_id, cb) => cb(null, { user: { id: 'u1' }, oauthTokens: { accessToken: 'tok' } }),
    };
    next();
  });
  app.use('/internal', require('../routes/agentTool'));
  return app;
}

describe('/internal/agent-tool — ELICITATION obligation', () => {
  const post = (body) =>
    supertest(buildApp())
      .post('/internal/agent-tool')
      .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
      .send(body);

  it('normalizes elicitation_required into the generic hitlRequired envelope', async () => {
    executeBffTool.mockResolvedValueOnce(JSON.stringify({
      error: 'elicitation_required',
      isError: false,
      elicitationId: 'elic-1',
      prompt: 'Confirm create_withdrawal?',
      toolName: 'create_withdrawal',
      message: 'Confirm create_withdrawal?',
    }));

    const res = await post({ tool: 'create_withdrawal', args: { from_account_id: 'a1', amount: 100 }, sessionId: 's1' });

    expect(res.status).toBe(200);
    expect(res.body.result.hitlRequired).toBe(true);
    expect(res.body.result.consentId).toBe('elic-1');
    expect(res.body.result.reason).toBe('elicitation_required');
    expect(res.body.result.message).toBe('Confirm create_withdrawal?');
    expect(res.body.result.tool).toBe('create_withdrawal');
    // Not the HITL/step-up shape.
    expect(res.body.result.stepUp).toBeFalsy();
  });
});
