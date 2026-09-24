'use strict';

const mockCreateAuthenticationEvaluation = jest.fn();
const mockCompleteEvaluation = jest.fn();
const mockGetEffective = jest.fn();

jest.mock('../services/pingOneProtectService', () => ({
  createAuthenticationEvaluation: (...args) => mockCreateAuthenticationEvaluation(...args),
  completeEvaluation: (...args) => mockCompleteEvaluation(...args),
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
  return { id: `eval-${level.toLowerCase()}`, result: { level, recommendedAction } };
}

function start(agent, body = { userId: 'alice@example.com', signalsData: 'sdk-signals' }) {
  return agent
    .post('/api/protect-auth/evaluations')
    .set('x-protect-auth-csrf', '1')
    .set('X-Forwarded-For', '203.0.113.9')
    .set('User-Agent', 'Test Browser/1.0')
    .send(body);
}

describe('/api/protect-auth session-bound evaluations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEffective.mockImplementation((key) => ({
      PINGONE_ENVIRONMENT_ID: 'environment-1',
      PINGONE_SDK_DEMO_CLIENT_ID: 'public-client-1',
    })[key]);
    mockCompleteEvaluation.mockResolvedValue(undefined);
  });

  test('valid input returns risk only and stores the evaluation for that browser session', async () => {
    mockCreateAuthenticationEvaluation.mockResolvedValue(evaluation('LOW'));
    const app = buildApp();
    const browser = request.agent(app);

    const res = await start(browser);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flowId: expect.any(String), level: 'LOW', recommendedAction: 'ALLOW' });
    expect(res.body).not.toHaveProperty('evaluationId');
    expect(JSON.stringify(res.body)).not.toContain('eval-low');
    expect(mockCreateAuthenticationEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'alice@example.com',
      ip: '203.0.113.9',
      userAgent: 'Test Browser/1.0',
      signalsData: 'sdk-signals',
      targetResourceId: 'public-client-1',
      sessionId: expect.any(String),
    }));
  });

  test('HIGH is reported as failed to Protect before the block result is returned', async () => {
    mockCreateAuthenticationEvaluation.mockResolvedValue(evaluation('HIGH', 'DENY'));
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(200);
    expect(res.body.level).toBe('HIGH');
    expect(mockCompleteEvaluation).toHaveBeenCalledWith('eval-high', 'FAILED');
  });

  test('an unknown risk level is completed as failed and never returned as a branch', async () => {
    mockCreateAuthenticationEvaluation.mockResolvedValue(evaluation('UNKNOWN'));
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('unknown_risk_result');
    expect(mockCompleteEvaluation).toHaveBeenCalledWith('eval-unknown', 'FAILED');
  });

  test('a risk evaluation can be completed once from its creating browser session', async () => {
    mockCreateAuthenticationEvaluation.mockResolvedValue(evaluation('MEDIUM', 'MFA'));
    const browser = request.agent(buildApp());
    const started = await start(browser);

    const completed = await browser
      .post('/api/protect-auth/completions')
      .set('x-protect-auth-csrf', '1')
      .send({ flowId: started.body.flowId, completionStatus: 'SUCCESS' });

    expect(completed.status).toBe(204);
    expect(mockCompleteEvaluation).toHaveBeenCalledWith('eval-medium', 'SUCCESS');

    const replay = await browser
      .post('/api/protect-auth/completions')
      .set('x-protect-auth-csrf', '1')
      .send({ flowId: started.body.flowId, completionStatus: 'SUCCESS' });
    expect(replay.status).toBe(404);
    expect(mockCompleteEvaluation).toHaveBeenCalledTimes(1);
  });

  test('another browser session cannot complete an evaluation it did not create', async () => {
    mockCreateAuthenticationEvaluation.mockResolvedValue(evaluation('LOW'));
    const app = buildApp();
    const firstBrowser = request.agent(app);
    const started = await start(firstBrowser);

    const res = await request(app)
      .post('/api/protect-auth/completions')
      .set('x-protect-auth-csrf', '1')
      .send({ flowId: started.body.flowId, completionStatus: 'SUCCESS' });

    expect(res.status).toBe(404);
    expect(mockCompleteEvaluation).not.toHaveBeenCalled();
  });

  test('rejects malformed requests before calling Protect', async () => {
    const app = buildApp();
    const noCsrf = await request(app).post('/api/protect-auth/evaluations').send({ userId: 'alice', signalsData: 'x' });
    expect(noCsrf.status).toBe(403);

    const noUser = await start(request.agent(app), { signalsData: 'x' });
    expect(noUser.status).toBe(400);

    const tooLarge = await start(request.agent(app), { userId: 'alice', signalsData: 'x'.repeat(70 * 1024) });
    expect(tooLarge.status).toBe(413);
    expect(mockCreateAuthenticationEvaluation).not.toHaveBeenCalled();
  });

  test('missing environment or OIDC client config returns an explicit unavailable error', async () => {
    mockGetEffective.mockReturnValue('');
    const res = await start(request.agent(buildApp()));

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('protect_auth_not_configured');
    expect(mockCreateAuthenticationEvaluation).not.toHaveBeenCalled();
  });
});
