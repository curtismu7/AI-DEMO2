'use strict';

const mockCreateBrowserRiskEvaluation = jest.fn();
const mockGetEffective = jest.fn();

jest.mock('../services/pingOneProtectService', () => ({
  createBrowserRiskEvaluation: (...args) => mockCreateBrowserRiskEvaluation(...args),
}));
jest.mock('../services/configStore', () => ({ getEffective: (...args) => mockGetEffective(...args) }));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const protectAuthentication = require('../routes/protectAuthentication');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({ secret: 'test-only-secret', resave: false, saveUninitialized: false }));
  app.use('/api/protect-auth', protectAuthentication);
  return app;
}

function evaluation(level, recommendedAction = 'ALLOW') {
  return {
    id: `eval-${level.toLowerCase()}`,
    result: { level, recommendedAction },
    details: { botDetection: { level: 'LOW', status: 'COMPLETE', detected: { rule: { id: 'rule-1' } } } },
  };
}

function start(agent, body = { userId: 'alice@example.com', signalsData: 'sdk-signals' }) {
  return agent
    .post('/api/protect-auth/evaluations')
    .set('x-protect-auth-csrf', '1')
    .set('X-Forwarded-For', '203.0.113.9')
    .set('User-Agent', 'Test Browser/1.0')
    .send(body);
}

describe('/api/protect-auth browser risk evaluations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEffective.mockImplementation((key) => ({
      PINGONE_ENVIRONMENT_ID: 'environment-1',
      PINGONE_SDK_DEMO_CLIENT_ID: 'public-client-1',
    })[key]);
  });

  test('valid input returns a sanitized Protect response without an authentication flow handle', async () => {
    mockCreateBrowserRiskEvaluation.mockResolvedValue(evaluation('LOW'));
    const app = buildApp();
    const browser = request.agent(app);

    const res = await start(browser);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      level: 'LOW',
      recommendedAction: 'ALLOW',
      botDetection: { level: 'LOW', status: 'COMPLETE', detectedRuleId: 'rule-1' },
    });
    expect(res.body).not.toHaveProperty('flowId');
    expect(res.body).not.toHaveProperty('evaluationId');
    expect(JSON.stringify(res.body)).not.toContain('eval-low');
    expect(mockCreateBrowserRiskEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'alice@example.com',
      ip: '203.0.113.9',
      userAgent: 'Test Browser/1.0',
      signalsData: 'sdk-signals',
      targetResourceId: 'public-client-1',
      sessionId: expect.any(String),
    }));
  });

  test('HIGH risk is returned as a Protect evaluation result without starting a sign-in outcome update', async () => {
    mockCreateBrowserRiskEvaluation.mockResolvedValue(evaluation('HIGH', 'DENY'));
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(200);
    expect(res.body.level).toBe('HIGH');
  });

  test('an unknown risk level is rejected and never returned as a result', async () => {
    mockCreateBrowserRiskEvaluation.mockResolvedValue(evaluation('UNKNOWN'));
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('unknown_risk_result');
  });

  test('rejects malformed requests before calling Protect', async () => {
    const app = buildApp();
    const noCsrf = await request(app).post('/api/protect-auth/evaluations').send({ userId: 'alice', signalsData: 'x' });
    expect(noCsrf.status).toBe(403);

    const noUser = await start(request.agent(app), { signalsData: 'x' });
    expect(noUser.status).toBe(400);

    const tooLarge = await start(request.agent(app), { userId: 'alice', signalsData: 'x'.repeat(70 * 1024) });
    expect(tooLarge.status).toBe(413);
    expect(mockCreateBrowserRiskEvaluation).not.toHaveBeenCalled();
  });

  test('missing environment or Protect target config returns an explicit unavailable error', async () => {
    mockGetEffective.mockReturnValue('');
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('protect_evaluation_not_configured');
    expect(mockCreateBrowserRiskEvaluation).not.toHaveBeenCalled();
  });
});
