'use strict';

/**
 * A 428 "consent required" from /api/agent/invoke is satisfied by a fresh in-app PingOne MFA.
 *
 * routes/mfa.js sets req.session.stepUpVerified only after PingOne reports the challenge COMPLETED. The
 * pre-execution consent gate used to ignore it, so a Dot transfer could only ever answer 428. Now the
 * marker is the approval, spent on the request that uses it (single use, like the UC38 step-up).
 */

const express = require('express');
const request = require('supertest');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');

jest.mock('../services/intentAuthService', () => ({
  evaluateIntentAuthorization: jest.fn(async () => ({
    authorized: true,
    requires_consent: true,
    reason: "Intent 'transfer' requires HITL consent (policy rule)",
  })),
}));

jest.mock('../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async () => ({ reply: 'Transferred.', success: true, toolsCalled: ['create_transfer'], tokenEvents: [] })),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
  optionalAuthenticateToken: (req, _res, next) => {
    req.user = { sub: 'test-sub' };
    next();
  },
}));

// One shared session object, so a spent marker is visible to the next request.
const mockSession = { active_vertical: 'airlines' };
jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (req, _res, next) => {
    req.session = mockSession;
    next();
  },
  agentSessionMiddleware: (req, _res, next) => next(),
}));

let app;
beforeAll(() => {
  const router = require('../routes/agentInvokeRoute');
  app = express();
  app.use(express.json());
  app.use('/api', router);
});

const ask = () => request(app).post('/api/agent/invoke').send({ prompt: 'transfer $300 from checking to savings', vertical: 'airlines' });

describe('consent gate and PingOne MFA', () => {
  beforeEach(() => {
    processAgentMessage.mockClear();
    delete mockSession.stepUpVerified;
  });

  test('without a fresh MFA: 428, tells the client MFA satisfies it, nothing runs', async () => {
    const res = await ask();
    expect(res.status).toBe(428);
    expect(res.body).toMatchObject({ requiresConsent: true, stepUp: 'p1mfa' });
    expect(processAgentMessage).not.toHaveBeenCalled();
  });

  test('with a fresh MFA: the request runs, and the marker is spent', async () => {
    mockSession.stepUpVerified = Date.now() + 60_000;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(processAgentMessage).toHaveBeenCalledTimes(1);
    expect(mockSession.stepUpVerified).toBe(0);

    // single use: the same MFA does not approve a second transfer
    const again = await ask();
    expect(again.status).toBe(428);
    expect(processAgentMessage).toHaveBeenCalledTimes(1);
  });

  test('an expired MFA does not approve it', async () => {
    mockSession.stepUpVerified = Date.now() - 1000;
    const res = await ask();
    expect(res.status).toBe(428);
    expect(processAgentMessage).not.toHaveBeenCalled();
  });
});
