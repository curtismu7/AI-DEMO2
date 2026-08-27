/**
 * @file oauthUserService.pkceNoClientAuth.test.js
 * @description Regression: customer sign-in broke on 2026-08-24 and stayed broken.
 *
 * The PingOne app "Demo AI App - User Login" was migrated to
 * tokenEndpointAuthMethod NONE (PKCE-only public client) while the BFF kept a
 * now-obsolete user_client_secret. Every code-for-token exchange therefore sent
 * `client_secret`, and PingOne answered:
 *
 *   invalid_client — Request denied: Unsupported authentication method
 *
 * which surfaced as /dashboard?error=callback_failed&detail=invalid_client and
 * rendered as a signed-out (guest) dashboard — so it did not look like an auth
 * bug at all.
 *
 * Verified against the LIVE token endpoint while diagnosing, same app, using a
 * deliberately invalid code so only client auth was under test:
 *   - no client auth           -> invalid_grant   (client auth accepted)
 *   - client_secret=<dummy>    -> invalid_client, Unsupported authentication method
 *   - Basic <id:dummy>         -> invalid_client, Unsupported authentication method
 *   - client_secret=  (EMPTY)  -> invalid_client, Unsupported authentication method
 *
 * That last row is why "only send it when non-empty" was never sufficient: the
 * old guard asked whether a secret EXISTS; the app cares whether client
 * authentication is USED at all.
 */
'use strict';

const mockStore = {};

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => (key in mockStore ? mockStore[key] : '')),
  isUserOAuthConfigured: () => true,
}));

const axios = require('axios');
// config/oauthUser exposes lazy getters that hit configStore on every read, so
// mutating mockStore between tests is enough — no module reloading needed.
const svc = require('../../services/oauthUserService');

const AUTH_METHOD_KEY = 'user_token_endpoint_auth_method';
const SECRET_KEY = 'user_client_secret';

/** The params the service actually put on the wire. */
function sentParams() {
  const [, body] = axios.post.mock.calls[0];
  return new URLSearchParams(body);
}

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  Object.assign(mockStore, {
    user_client_id: 'client-abc',
    user_redirect_uri: 'https://local.ping-devops.com:4000/api/auth/oauth/user/callback',
    pingone_environment_id: 'env-1',
    pingone_region: 'com',
  });
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { access_token: 'at', id_token: 'it' } });
});

describe('exchangeCodeForToken — client authentication', () => {
  it('sends client_secret when a secret is set and no auth method is configured (unchanged behaviour)', async () => {
    mockStore[SECRET_KEY] = 'a-real-secret';
    await svc.exchangeCodeForToken('code-1', 'verifier-1');
    expect(sentParams().get('client_secret')).toBe('a-real-secret');
  });

  // The actual fix.
  it('does NOT send client_secret when the app is PKCE-only (none), even though a secret exists', async () => {
    mockStore[SECRET_KEY] = 'a-stale-secret';
    mockStore[AUTH_METHOD_KEY] = 'none';
    await svc.exchangeCodeForToken('code-1', 'verifier-1');

    const p = sentParams();
    expect(p.has('client_secret')).toBe(false);
    // Dropping client auth must not drop PKCE with it.
    expect(p.get('code_verifier')).toBe('verifier-1');
    expect(p.get('client_id')).toBe('client-abc');
    expect(p.get('grant_type')).toBe('authorization_code');
  });

  it.each(['none', 'NONE', ' None '])('treats %j case- and whitespace-insensitively', async (method) => {
    mockStore[SECRET_KEY] = 'a-stale-secret';
    mockStore[AUTH_METHOD_KEY] = method;
    await svc.exchangeCodeForToken('code-1', 'verifier-1');
    expect(sentParams().has('client_secret')).toBe(false);
  });

  // An empty client_secret= is rejected exactly like a wrong one, so "no secret
  // configured" must mean the parameter is absent, not blank.
  it('never sends an empty client_secret parameter when no secret is configured', async () => {
    mockStore[SECRET_KEY] = '';
    await svc.exchangeCodeForToken('code-1', 'verifier-1');
    expect(sentParams().has('client_secret')).toBe(false);
  });

  it('leaves a confidential app alone when the method is something other than none', async () => {
    mockStore[SECRET_KEY] = 'a-real-secret';
    mockStore[AUTH_METHOD_KEY] = 'basic';
    await svc.exchangeCodeForToken('code-1', 'verifier-1');
    expect(sentParams().get('client_secret')).toBe('a-real-secret');
  });
});
