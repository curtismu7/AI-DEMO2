'use strict';

jest.mock('../../services/pingOneAuthorizeService', () => ({
  ...jest.requireActual('../../services/pingOneAuthorizeService'),
  isWorkerCredentialReady: jest.fn(() => true),
  evaluateDecisionEndpoint: jest.fn(),
  peekWorkerToken: jest.fn(),
}));
jest.mock('../../middleware/auth', () => ({
  ...jest.requireActual('../../middleware/auth'),
  authenticateToken: (req, _res, next) => { req.user = { sub: 'u1' }; next(); },
}));

const express = require('express');
const request = require('supertest');
const svc = require('../../services/pingOneAuthorizeService');
const router = require('../../routes/authorize');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ client_id: 'demo-bff-mcp-client', aud: ['https://api.pingone.com'] })}.sig`;

const app = express();
app.use(express.json());
app.use('/api/authorize', router);

const post = () => request(app).post('/api/authorize/evaluate-endpoint')
  .send({ endpointId: 'ep1', parameters: { Amount: 12500 } });

beforeEach(() => {
  svc.evaluateDecisionEndpoint.mockResolvedValue({
    decision: 'DENY', policyEvalMs: 41, ruleName: 'Step-up above $10,000', ruleCode: 'step-up', raw: {},
    _debug: { request: { method: 'POST', url: 'u', body: { parameters: { Amount: 12500 } } }, response: { decision: 'DENY' } },
  });
});

describe('POST /evaluate-endpoint inspector facts', () => {
  test('returns rule facts and a worker-token event without the raw token', async () => {
    svc.peekWorkerToken.mockReturnValue(TOKEN);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.policyEvalMs).toBe(41);
    expect(res.body.ruleName).toBe('Step-up above $10,000');
    expect(res.body.ruleCode).toBe('step-up');
    expect(res.body.workerTokenCached).toBe(true);
    expect(res.body.tokenEvents[0].id).toBe('worker-token');
    expect(res.body.tokenEvents[0].claims.aud).toEqual(['https://api.pingone.com']);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  test('no cached token gives empty tokenEvents and workerTokenCached false', async () => {
    svc.peekWorkerToken.mockReturnValue(null);
    const res = await post();
    expect(res.body.tokenEvents).toEqual([]);
    expect(res.body.workerTokenCached).toBe(false);
  });
});
