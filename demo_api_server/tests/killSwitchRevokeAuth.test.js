/**
 * STOP AGENT's token revoke must authenticate as the client the token was issued to.
 *
 * Measured 2026-11-22 with a real demo-user token: a bare `token=` POST to PingOne's /revoke is refused
 * (401 invalid_client, "No client credentials included"), so the access and ID token stayed active after a
 * kill. The same call with client authentication revoked the access token and the refresh token.
 */
'use strict';

jest.mock('axios', () => ({
  post: jest.fn(),
  isAxiosError: () => false,
}));
jest.mock('../middleware/sessionConfig', () => ({
  store: {
    get: (_k, cb) => cb(null, null),
    set: (_k, _v, cb) => cb(null),
    destroy: (_k, cb) => cb(null),
    all: (cb) => cb(null, {}),
  },
}));
jest.mock('../services/auditLogService');
jest.mock('../services/agentLifecycleEvents');

// The two PingOne apps: end-user app (client_secret_post) and admin app (basic by default).
const mockUserCfg = {
  clientId: 'user-app-id', clientSecret: 'user-app-secret', tokenEndpointAuthMethod: 'client_secret_post',
  revocationEndpoint: 'https://auth.example.test/env/as/revoke',
};
const mockAdminCfg = {
  clientId: 'admin-app-id', clientSecret: 'admin-app-secret', tokenEndpointAuthMethod: 'basic',
  revocationEndpoint: 'https://auth.example.test/env/as/revoke', _base: 'https://auth.example.test/env/as',
};
jest.mock('../config/oauthUser', () => mockUserCfg);
jest.mock('../config/oauth', () => mockAdminCfg);

const axios = require('axios');
const killSwitchService = require('../services/killSwitchService');

const bodyOf = () => new URLSearchParams(axios.post.mock.calls[0][1]);
const optsOf = () => axios.post.mock.calls[0][2];

describe('killSwitchService.revokeTokenAtPingOne client authentication', () => {
  beforeEach(() => {
    axios.post.mockReset();
    axios.post.mockResolvedValue({ status: 200 });
    mockUserCfg.tokenEndpointAuthMethod = 'client_secret_post';
    mockUserCfg.clientSecret = 'user-app-secret';
  });

  test('an end-user session authenticates as the USER app, secret in the body', async () => {
    const r = await killSwitchService.revokeTokenAtPingOne('tok-1', { oauthType: 'user', tokenTypeHint: 'access_token' });
    expect(r.revoked).toBe(true);
    expect(axios.post.mock.calls[0][0]).toBe('https://auth.example.test/env/as/revoke');
    expect(bodyOf().get('token')).toBe('tok-1');
    expect(bodyOf().get('client_id')).toBe('user-app-id');
    expect(bodyOf().get('client_secret')).toBe('user-app-secret');
    expect(bodyOf().get('token_type_hint')).toBe('access_token');
    expect(optsOf().auth).toBeUndefined();
  });

  test('an admin session authenticates as the ADMIN app, with the Authorization header (basic)', async () => {
    await killSwitchService.revokeTokenAtPingOne('tok-2', { oauthType: 'admin' });
    expect(optsOf().auth).toEqual({ username: 'admin-app-id', password: 'admin-app-secret' });
    expect(bodyOf().get('client_secret')).toBeNull();
    expect(bodyOf().get('client_id')).toBeNull();
  });

  test('no session type defaults to the admin app (the previous config source)', async () => {
    await killSwitchService.revokeTokenAtPingOne('tok-3');
    expect(optsOf().auth).toEqual({ username: 'admin-app-id', password: 'admin-app-secret' });
  });

  test('a public (PKCE-only) app sends client_id and never a secret', async () => {
    mockUserCfg.tokenEndpointAuthMethod = 'none';
    await killSwitchService.revokeTokenAtPingOne('tok-4', { oauthType: 'user' });
    expect(bodyOf().get('client_id')).toBe('user-app-id');
    expect(bodyOf().get('client_secret')).toBeNull();
    expect(optsOf().auth).toBeUndefined();
  });

  test('no token: nothing is sent', async () => {
    expect(await killSwitchService.revokeTokenAtPingOne('')).toEqual({ revoked: false, error: 'no_token' });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('killAgent reports a failed revoke honestly', () => {
  beforeEach(() => axios.post.mockReset());

  test('revoke refused by PingOne: the step says so instead of "no token found"', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }));
    const res = await killSwitchService.killAgent('agent-revoke-auth-a', 'test', null,
      { accessToken: 'a', idToken: 'i' }, 'instance', null, 'user');
    const step = res.steps.find((s) => s.key === 'token_revocation');
    expect(step.detail).toMatch(/did not revoke/i);
    expect(step.detail).not.toMatch(/No valid access\/ID token found/);
  });

  test('no tokens on the session keeps the original wording', async () => {
    const res = await killSwitchService.killAgent('agent-revoke-auth-b', 'test', null, null, 'instance', null, 'user');
    const step = res.steps.find((s) => s.key === 'token_revocation');
    expect(step.detail).toMatch(/No valid access\/ID token found/);
  });

  test('revoke succeeds: the original success wording, and both tokens are sent as the user app', async () => {
    axios.post.mockResolvedValue({ status: 200 });
    const res = await killSwitchService.killAgent('agent-revoke-auth-c', 'test', null,
      { accessToken: 'a', idToken: 'i' }, 'instance', null, 'user');
    expect(res.steps.find((s) => s.key === 'token_revocation').detail).toMatch(/revoked \(RFC 7009\)/);
    const bodies = axios.post.mock.calls.map((c) => new URLSearchParams(c[1]));
    // RFC 7009 hints are access_token | refresh_token, so the ID token carries none
    expect(bodies.map((b) => b.get('token_type_hint'))).toEqual(expect.arrayContaining(['access_token', null]));
    expect(bodies).toHaveLength(2);
    bodies.forEach((b) => expect(b.get('client_id')).toBe('user-app-id'));
  });
});
