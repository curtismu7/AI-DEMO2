'use strict';
/**
 * Regression: GET/DELETE /api/api-calls/tokens trusted a caller-supplied
 * ?sessionId= query param verbatim, with no check that it belonged to the
 * requester. routes/oauth.js stores each user's full raw OAuth access token
 * into this bucket on login, keyed by their express-session id — so any
 * signed-in user who learned or guessed another user's session id could
 * read (or clear) that user's raw bearer token via this endpoint, enabling
 * impersonation of downstream banking/MCP calls.
 *
 * Fix: both routes now always scope to req.session.id (or 'default'),
 * ignoring any caller-supplied sessionId override — unlike GET/DELETE
 * /api/api-calls, whose sessionId scoping is a deliberate cross-session
 * debug feature for generic (non-token) call logs.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/apiCallTrackerService', () => ({
  GLOBAL_SESSION_ID: '__global__',
  trackApiCall: jest.fn(),
  getApiCalls: jest.fn(() => []),
  clearApiCalls: jest.fn(),
  getApiCallStats: jest.fn(() => ({})),
  trackToken: jest.fn(),
  getSessionTokens: jest.fn((sessionId) => [{ sessionId, accessToken: `token-for-${sessionId}` }]),
  clearSessionTokens: jest.fn(),
}));

const { getSessionTokens, clearSessionTokens } = require('../services/apiCallTrackerService');
const router = require('../routes/apiCallTracker');

function buildApp(callerSessionId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { id: callerSessionId };
    next();
  });
  app.use('/api/api-calls', router);
  return app;
}

describe('apiCallTracker /tokens — session isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /tokens ignores a caller-supplied sessionId and reads only the caller\'s own session', async () => {
    const app = buildApp('attacker-session');

    const res = await request(app).get('/api/api-calls/tokens?sessionId=victim-session');

    expect(res.status).toBe(200);
    expect(getSessionTokens).toHaveBeenCalledWith('attacker-session');
    expect(getSessionTokens).not.toHaveBeenCalledWith('victim-session');
    expect(res.body.sessionId).toBe('attacker-session');
  });

  test('DELETE /tokens ignores a caller-supplied sessionId and clears only the caller\'s own session', async () => {
    const app = buildApp('attacker-session');

    const res = await request(app).delete('/api/api-calls/tokens?sessionId=victim-session');

    expect(res.status).toBe(200);
    expect(clearSessionTokens).toHaveBeenCalledWith('attacker-session');
    expect(clearSessionTokens).not.toHaveBeenCalledWith('victim-session');
  });
});
