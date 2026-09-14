'use strict';

const request = require('supertest');
const express = require('express');

// TECH_DEBT.md 2026-09-13 "HITL consent can be approved with no session":
// agentGuestSessionMiddleware lets a request with no session through with
// req.agentContext = null, so the /consent handler's ownership check
// (`entry.userId && userSub && ...`) used to be skipped entirely when
// userSub was null — letting anyone who knew a pending consentId approve it.
// This spec pins the fix: no session must 401 before the challenge is even
// looked up, a signed-in non-owner still 403s, and the legitimate owner path
// keeps working.

let mockSessionState = null; // null = guest (no session); otherwise { userSub }

jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (req, _res, next) => {
    if (mockSessionState) {
      req.session = { user: { id: mockSessionState.userSub, oauthId: mockSessionState.userSub } };
      req.agentContext = { userId: mockSessionState.userSub };
    } else {
      req.session = null;
      req.agentContext = null;
    }
    next();
  },
}));

jest.mock('../services/hitlServiceClient');
jest.mock('../middleware/hitlGatewayMiddleware', () => ({
  storeConsentRequest: jest.fn(),
  recordConsentDecision: jest.fn().mockResolvedValue({ decision: 'approved' }),
}));

const hitlServiceClient = require('../services/hitlServiceClient');
const { recordConsentDecision } = require('../middleware/hitlGatewayMiddleware');
const demoAgentRoutes = require('../routes/demoAgentRoutes');

const app = express();
app.use(express.json());
app.use('/api/demo-agent', demoAgentRoutes);

const CONSENT_ID = '11111111-1111-4111-8111-111111111111';

describe('POST /api/demo-agent/consent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionState = null;
  });

  test('no session + valid consentId -> 401 need_auth, challenge never looked up, decision never recorded', async () => {
    const res = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: CONSENT_ID, approved: true });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
    expect(res.body.need_auth).toBe(true);
    // Not leaking whether the challenge exists — lookup must not happen.
    expect(hitlServiceClient.getChallengeStatus).not.toHaveBeenCalled();
    expect(recordConsentDecision).not.toHaveBeenCalled();
  });

  test('signed-in user, challenge belongs to a different user -> 403, decision never recorded', async () => {
    mockSessionState = { userSub: 'user-a' };
    hitlServiceClient.getChallengeStatus.mockResolvedValue({
      userId: 'user-b',
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: CONSENT_ID, approved: true });

    expect(res.status).toBe(403);
    expect(recordConsentDecision).not.toHaveBeenCalled();
  });

  test('signed-in owner approving their own pending challenge -> succeeds as before', async () => {
    mockSessionState = { userSub: 'user-a' };
    hitlServiceClient.getChallengeStatus.mockResolvedValue({
      userId: 'user-a',
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: CONSENT_ID, approved: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: true, approved: true });
    expect(recordConsentDecision).toHaveBeenCalledWith(CONSENT_ID, 'approve');
  });

  test('signed-in owner rejecting their own pending challenge -> succeeds as before', async () => {
    mockSessionState = { userSub: 'user-a' };
    hitlServiceClient.getChallengeStatus.mockResolvedValue({
      userId: 'user-a',
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/demo-agent/consent')
      .send({ consentId: CONSENT_ID, approved: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: true, approved: false });
    expect(recordConsentDecision).toHaveBeenCalledWith(CONSENT_ID, 'reject');
  });
});
