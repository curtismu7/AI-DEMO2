'use strict';

jest.mock('../../services/oauthUserService', () => ({ refreshAccessToken: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ refreshAccessToken: jest.fn() }));
jest.mock('../../services/tokenChainService', () => ({
  trackTokenEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/configStore', () => ({
  getOAuthProvider: jest.fn(() => 'pingone'),
}));

const oauthUserService = require('../../services/oauthUserService');
const configStore = require('../../services/configStore');
const { refreshIfExpiring } = require('../../middleware/tokenRefresh');

function makeSession(seed, shared) {
  return {
    ...structuredClone(seed),
    save(callback) {
      Object.assign(shared, structuredClone({
        oauthTokens: this.oauthTokens,
        oauthType: this.oauthType,
        oauthProvider: this.oauthProvider,
        user: this.user,
      }));
      callback(null);
    },
    reload(callback) {
      Object.assign(this, structuredClone(shared));
      callback(null);
    },
  };
}

function makeRequest(session) {
  return { session, sessionID: 'session-1', path: '/api/accounts/my' };
}

function makeResponse() {
  const headers = {};
  return {
    headers,
    getHeader(name) { return headers[name]; },
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getOAuthProvider.mockReturnValue('pingone');
});

test('a concurrent request waits for refresh and reloads the saved token before continuing', async () => {
  const original = {
    oauthTokens: {
      accessToken: 'expired-access',
      refreshToken: 'rotating-refresh',
      expiresAt: Date.now() - 1000,
    },
    oauthType: 'user',
    oauthProvider: 'pingone',
    user: { oauthId: 'user-1', oauthProvider: 'pingone_sso' },
  };
  const shared = structuredClone(original);
  let releaseRefresh;
  oauthUserService.refreshAccessToken.mockReturnValue(new Promise((resolve) => {
    releaseRefresh = resolve;
  }));

  const firstReq = makeRequest(makeSession(original, shared));
  const secondReq = makeRequest(makeSession(original, shared));
  const secondReload = jest.spyOn(secondReq.session, 'reload');
  const firstNext = jest.fn();
  const secondNext = jest.fn();
  const first = refreshIfExpiring(firstReq, makeResponse(), firstNext);
  await Promise.resolve();
  const second = refreshIfExpiring(secondReq, makeResponse(), secondNext);
  await Promise.resolve();

  expect(secondNext).not.toHaveBeenCalled();
  releaseRefresh({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 });
  await Promise.all([first, second]);

  expect(oauthUserService.refreshAccessToken).toHaveBeenCalledTimes(1);
  expect(secondReq.session.oauthTokens.accessToken).toBe('fresh-access');
  expect(secondReq.session.oauthTokens.refreshToken).toBe('fresh-refresh');
  expect(secondReload).toHaveBeenCalledTimes(1);
  expect(secondNext).toHaveBeenCalledTimes(1);
});

test('a session from the previous provider is cleared without sending its refresh token to the selected provider', async () => {
  const shared = {};
  const session = makeSession({
    oauthTokens: {
      accessToken: 'pf-access',
      refreshToken: 'pf-refresh',
      expiresAt: Date.now() + 60_000,
    },
    oauthType: 'user',
    oauthProvider: 'pingfederate',
    user: { oauthId: 'user-1', oauthProvider: 'pingfederate' },
  }, shared);
  const req = makeRequest(session);
  const res = makeResponse();
  const next = jest.fn();

  await refreshIfExpiring(req, res, next);

  expect(oauthUserService.refreshAccessToken).not.toHaveBeenCalled();
  expect(session.oauthTokens).toBeUndefined();
  expect(shared.oauthTokens).toBeUndefined();
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.headers['Set-Cookie']).toContain('_auth=');
});

test('an expired token is refreshed on a route outside the old prefix list (/api/verticals/me)', async () => {
  // SE 2026-10-20 19:19Z: /api/verticals/*, /api/agent/invoke failed "jwt expired" because refresh
  // was only mounted on a fixed list of prefixes. The middleware itself is path-agnostic.
  const original = {
    oauthTokens: { accessToken: 'expired-access', refreshToken: 'r1', expiresAt: Date.now() - 1000 },
    oauthType: 'user',
    oauthProvider: 'pingone',
    user: { oauthId: 'user-1', oauthProvider: 'pingone_sso' },
  };
  const shared = structuredClone(original);
  oauthUserService.refreshAccessToken.mockResolvedValue({ access_token: 'fresh-access', refresh_token: 'r2', expires_in: 3600 });
  const req = { ...makeRequest(makeSession(original, shared)), path: '/api/verticals/me', originalUrl: '/api/verticals/me' };
  const next = jest.fn();

  await refreshIfExpiring(req, makeResponse(), next);

  expect(oauthUserService.refreshAccessToken).toHaveBeenCalledWith('r1');
  expect(req.session.oauthTokens.accessToken).toBe('fresh-access');
  expect(next).toHaveBeenCalledTimes(1);
});
