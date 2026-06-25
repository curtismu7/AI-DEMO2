/**
 * @file oauthService.test.js
 * @description Unit tests for OAuthService (admin OAuth client).
 *
 * Critical coverage areas:
 *  1.  PKCE helpers — generateCodeVerifier / generateCodeChallenge
 *  2.  generateAuthorizationUrl — client_id, redirect_uri, PKCE params, state, scopes, nonce
 *  3.  exchangeCodeForToken — PKCE with Basic Auth, PKCE public client, non-PKCE paths
 *  4.  exchangeCodeForToken — error propagation (pingoneError / pingoneDesc)
 *  5.  revokeToken — best-effort (never throws)
 */

const axios = require('axios');

// ---- mock axios before requiring the service --------------------------------
jest.mock('axios');

// ---- mock debug helpers (no-ops) -------------------------------------------
jest.mock('../../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
jest.mock('../../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));

// ---- controlled config fixture ---------------------------------------------
const MOCK_CONFIG = {
  environmentId:          'env-test-111',
  _region:                'com',
  _base:                  'https://auth.pingone.com/env-test-111/as',
  authorizationEndpoint:  'https://auth.pingone.com/env-test-111/as/authorize',
  tokenEndpoint:          'https://auth.pingone.com/env-test-111/as/token',
  userInfoEndpoint:       'https://auth.pingone.com/env-test-111/as/userinfo',
  jwksEndpoint:           'https://auth.pingone.com/env-test-111/as/jwks',
  issuer:                 'https://auth.pingone.com/env-test-111/as',
  clientId:               'test-admin-client-id',
  clientSecret:           'test-admin-client-secret',
  redirectUri:            'https://banking-demo-puce.vercel.app/api/auth/oauth/callback',
  cibaEndpoint:           'https://auth.pingone.com/env-test-111/as/bc-authorize',
  scopes:                 ['openid', 'profile', 'email'],
  sessionSecret:          'test-sess-secret',
  adminRole:              'admin',
  authorizeUsesPiFlow:    false,
  tokenEndpointAuthMethod: 'basic',
};

jest.mock('../../config/oauth', () => MOCK_CONFIG);

// ---- load SUT after mocks are in place -------------------------------------
// oauthService exports a singleton instance (not the class)
const svcSingleton = require('../../services/oauthService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeService(configOverrides = {}) {
  // Each test gets the singleton but with isolated config values via MOCK_CONFIG overrides.
  // Save current values so afterEach can restore them.
  const saved = {};
  for (const key of Object.keys(configOverrides)) {
    saved[key] = MOCK_CONFIG[key];
    MOCK_CONFIG[key] = configOverrides[key];
  }
  svcSingleton._testSavedConfig = saved;
  return svcSingleton;
}

function restoreService() {
  const saved = svcSingleton._testSavedConfig || {};
  for (const [k, v] of Object.entries(saved)) {
    MOCK_CONFIG[k] = v;
  }
  svcSingleton._testSavedConfig = {};
}

function parseBody(postCallArg) {
  // axios.post receives an object body (not URLSearchParams) in exchangeCodeForToken
  return postCallArg;
}

// ---------------------------------------------------------------------------
// 1. PKCE helpers
// ---------------------------------------------------------------------------
describe('PKCE helpers', () => {
  const svc = svcSingleton;

  test('generateCodeVerifier returns a 128-char hex string', () => {
    const v = svc.generateCodeVerifier();
    expect(typeof v).toBe('string');
    expect(v).toHaveLength(128); // 64 bytes → 128 hex chars
    expect(/^[0-9a-f]+$/.test(v)).toBe(true);
  });

  test('generateCodeVerifier returns a different value each call', () => {
    expect(svc.generateCodeVerifier()).not.toBe(svc.generateCodeVerifier());
  });

  test('generateCodeChallenge returns a base64url-encoded SHA-256 digest', () => {
    const verifier = 'abc123';
    const challenge = svc.generateCodeChallenge(verifier);
    // base64url: no +, no /, no =
    expect(/^[A-Za-z0-9\-_]+$/.test(challenge)).toBe(true);
    // Deterministic for same input
    expect(svc.generateCodeChallenge(verifier)).toBe(challenge);
    // Different verifiers produce different challenges
    expect(svc.generateCodeChallenge('xyz')).not.toBe(challenge);
  });
});

// ---------------------------------------------------------------------------
// 2. generateAuthorizationUrl
// ---------------------------------------------------------------------------
describe('generateAuthorizationUrl', () => {
  const svc = svcSingleton;

  function parse(url) {
    const u = new URL(url);
    return { base: u.origin + u.pathname, params: Object.fromEntries(u.searchParams) };
  }

  test('base URL uses configured authorizationEndpoint', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv', MOCK_CONFIG.redirectUri);
    expect(parse(url).base).toBe(MOCK_CONFIG.authorizationEndpoint);
  });

  test('includes correct client_id', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv', MOCK_CONFIG.redirectUri);
    expect(parse(url).params.client_id).toBe(MOCK_CONFIG.clientId);
  });

  test('includes provided redirect_uri', () => {
    const customRedirect = 'https://example.com/callback';
    const url = svc.generateAuthorizationUrl('st', 'cv', customRedirect);
    expect(parse(url).params.redirect_uri).toBe(customRedirect);
  });

  test('falls back to config.redirectUri when none provided', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    expect(parse(url).params.redirect_uri).toBe(MOCK_CONFIG.redirectUri);
  });

  test('includes the provided state value', () => {
    const url = svc.generateAuthorizationUrl('my-csrf-state', 'cv');
    expect(parse(url).params.state).toBe('my-csrf-state');
  });

  test('includes login_hint=demoAdmin for admin authorize URL', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    expect(parse(url).params.login_hint).toBe('demoAdmin');
  });

  test('includes response_type=code', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    expect(parse(url).params.response_type).toBe('code');
    expect(parse(url).params.response_mode).toBeUndefined();
  });

  test('uses response_type=pi.flow and response_mode=pi.flow when authorizeUsesPiFlow', () => {
    makeService({ authorizeUsesPiFlow: true });
    try {
      const url = svcSingleton.generateAuthorizationUrl('st', 'cv', MOCK_CONFIG.redirectUri);
      const p = parse(url).params;
      expect(p.response_type).toBe('pi.flow');
      expect(p.response_mode).toBe('pi.flow');
      expect(p.code_challenge_method).toBe('S256');
    } finally {
      restoreService();
    }
  });

  test('includes all configured scopes space-separated', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    const scope = parse(url).params.scope;
    for (const s of MOCK_CONFIG.scopes) expect(scope).toContain(s);
  });

  test('includes code_challenge derived from codeVerifier', () => {
    const verifier = 'test-verifier-xyz';
    const expectedChallenge = svc.generateCodeChallenge(verifier);
    const url = svc.generateAuthorizationUrl('st', verifier);
    expect(parse(url).params.code_challenge).toBe(expectedChallenge);
  });

  test('includes code_challenge_method=S256', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    expect(parse(url).params.code_challenge_method).toBe('S256');
  });

  test('includes nonce when provided', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv', undefined, 'my-nonce');
    expect(parse(url).params.nonce).toBe('my-nonce');
  });

  test('omits nonce when not provided', () => {
    const url = svc.generateAuthorizationUrl('st', 'cv');
    expect(parse(url).params.nonce).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. exchangeCodeForToken — happy paths
// ---------------------------------------------------------------------------
describe('exchangeCodeForToken — request body', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService({}); // singleton with default MOCK_CONFIG
    axios.post.mockResolvedValue({
      data: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    });
  });

  // Helper: parse the URLSearchParams string body from axios.post call
  function getCallBody(callIndex = 0) {
    const raw = axios.post.mock.calls[callIndex][1];
    return Object.fromEntries(new URLSearchParams(raw));
  }
  function getCallHeaders(callIndex = 0) {
    return axios.post.mock.calls[callIndex][2]?.headers || {};
  }

  test('always sends grant_type=authorization_code', async () => {
    await svc.exchangeCodeForToken('code-abc', 'verifier-123');
    const body = getCallBody();
    expect(body.grant_type).toBe('authorization_code');
  });

  test('always sends the correct client_id', async () => {
    await svc.exchangeCodeForToken('code-abc', 'verifier-123');
    const body = getCallBody();
    expect(body.client_id).toBe(MOCK_CONFIG.clientId);
  });

  test('sends the provided code', async () => {
    await svc.exchangeCodeForToken('my-auth-code', 'verifier-123');
    const body = getCallBody();
    expect(body.code).toBe('my-auth-code');
  });

  // --- PKCE + confidential client (has secret) ----------------------------
  describe('PKCE path with client_secret configured (confidential client)', () => {
    test('sends code_verifier in body', async () => {
      await svc.exchangeCodeForToken('code', 'my-verifier');
      expect(getCallBody().code_verifier).toBe('my-verifier');
    });

    test('sends client_secret via Basic Auth header (not in body)', async () => {
      // config.clientSecret is set to 'test-admin-client-secret' in MOCK_CONFIG
      await svc.exchangeCodeForToken('code', 'my-verifier');
      const body = getCallBody();
      const headers = getCallHeaders();
      // Secret must NOT appear in body
      expect(body.client_secret).toBeUndefined();
      // Secret MUST appear in Authorization: Basic <base64(id:secret)>
      expect(headers['Authorization']).toMatch(/^Basic /);
      const decoded = Buffer.from(headers['Authorization'].replace('Basic ', ''), 'base64').toString();
      expect(decoded).toBe(`${encodeURIComponent(MOCK_CONFIG.clientId)}:${encodeURIComponent(MOCK_CONFIG.clientSecret)}`);
    });

    test('sends client_secret in body when tokenEndpointAuthMethod is post', async () => {
      const prev = MOCK_CONFIG.tokenEndpointAuthMethod;
      MOCK_CONFIG.tokenEndpointAuthMethod = 'post';
      try {
        await svc.exchangeCodeForToken('code', 'my-verifier');
        const body = getCallBody();
        const headers = getCallHeaders();
        expect(body.client_secret).toBe(MOCK_CONFIG.clientSecret);
        expect(headers.Authorization).toBeUndefined();
      } finally {
        MOCK_CONFIG.tokenEndpointAuthMethod = prev;
      }
    });
  });

  // --- PKCE + public client (no secret) ------------------------------------
  describe('PKCE path, no secret configured (public client)', () => {
    beforeEach(() => {
      restoreService();
      svc = makeService({ clientSecret: '' });
    });
    afterEach(() => restoreService());

    test('sends code_verifier in body', async () => {
      await svc.exchangeCodeForToken('code', 'my-verifier');
      expect(getCallBody().code_verifier).toBe('my-verifier');
    });

    test('does NOT send Authorization header', async () => {
      await svc.exchangeCodeForToken('code', 'my-verifier');
      expect(getCallHeaders()['Authorization']).toBeUndefined();
    });
  });

  // --- non-PKCE, secret configured -----------------------------------------
  describe('non-PKCE path, secret configured', () => {
    test('sends client_secret via Basic Auth header', async () => {
      await svc.exchangeCodeForToken('code', null);
      const headers = getCallHeaders();
      expect(headers['Authorization']).toMatch(/^Basic /);
    });

    test('does NOT send code_verifier', async () => {
      await svc.exchangeCodeForToken('code', null);
      expect(getCallBody().code_verifier).toBeUndefined();
    });
  });

  // --- non-PKCE, no secret -------------------------------------------------
  describe('non-PKCE path, no secret configured', () => {
    beforeEach(() => {
      restoreService();
      svc = makeService({ clientSecret: '' });
    });
    afterEach(() => restoreService());

    test('sends neither Authorization header nor code_verifier', async () => {
      await svc.exchangeCodeForToken('code', undefined);
      const body = getCallBody();
      const headers = getCallHeaders();
      expect(body.client_secret).toBeUndefined();
      expect(body.code_verifier).toBeUndefined();
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  // --- redirect_uri handling -----------------------------------------------
  describe('redirect_uri resolution', () => {
    test('uses provided redirectUri', async () => {
      const custom = 'https://custom.example.com/cb';
      await svc.exchangeCodeForToken('code', 'v', custom);
      const body = getCallBody();
      expect(body.redirect_uri).toBe(custom);
    });

    test('falls back to config.redirectUri when not provided', async () => {
      await svc.exchangeCodeForToken('code', 'v');
      const body = getCallBody();
      expect(body.redirect_uri).toBe(MOCK_CONFIG.redirectUri);
    });
  });

  // --- token endpoint -------------------------------------------------------
  test('POSTs to the configured tokenEndpoint', async () => {
    await svc.exchangeCodeForToken('code', 'v');
    expect(axios.post.mock.calls[0][0]).toBe(MOCK_CONFIG.tokenEndpoint);
  });

  // --- return value ---------------------------------------------------------
  test('returns the full token response data', async () => {
    const result = await svc.exchangeCodeForToken('code', 'v');
    expect(result.access_token).toBe('mock-access-token');
    expect(result.refresh_token).toBe('mock-refresh-token');
    expect(result.expires_in).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// 4. exchangeCodeForToken — error propagation
// ---------------------------------------------------------------------------
describe('exchangeCodeForToken — error handling', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService({});
  });
  afterEach(() => restoreService());

  test('attaches pingoneError and pingoneDesc from PingOne response body', async () => {
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: 'invalid_client',
          error_description: 'The client authentication was invalid.',
        },
      },
    });

    await expect(svc.exchangeCodeForToken('c', 'v')).rejects.toMatchObject({
      pingoneError: 'invalid_client',
      pingoneDesc: 'The client authentication was invalid.',
    });
  });

  test('error message includes the PingOne error code and description', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'invalid_grant', error_description: 'Code expired.' } },
    });

    await expect(svc.exchangeCodeForToken('c', 'v')).rejects.toThrow(
      /invalid_grant.*Code expired/
    );
  });

  test('falls back gracefully when PingOne provides no error body', async () => {
    axios.post.mockRejectedValue(new Error('Network error'));

    const err = await svc.exchangeCodeForToken('c', 'v').catch((e) => e);
    expect(err.pingoneError).toBe('token_exchange_failed');
    expect(err.pingoneDesc).toBe('');
    expect(err.message).toMatch(/Failed to exchange/);
  });

  test('pingoneDesc is empty string when error_description is absent', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'server_error' } },
    });

    const err = await svc.exchangeCodeForToken('c', 'v').catch((e) => e);
    expect(err.pingoneError).toBe('server_error');
    expect(err.pingoneDesc).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5. generateState
// ---------------------------------------------------------------------------
describe('generateState', () => {
  const svc = svcSingleton;

  test('returns a 64-char hex string', () => {
    const s = svc.generateState();
    expect(s).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(s)).toBe(true);
  });

  test('returns unique values on successive calls', () => {
    expect(svc.generateState()).not.toBe(svc.generateState());
  });
});

// ---------------------------------------------------------------------------
// 6. revokeToken — best-effort (must not throw)
// ---------------------------------------------------------------------------
describe('revokeToken', () => {
  let svc;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService({});
  });
  afterEach(() => restoreService());

  test('resolves without throwing on success', async () => {
    axios.post.mockResolvedValue({ status: 200, data: {} });
    await expect(svc.revokeToken('some-token', 'access_token')).resolves.not.toThrow();
  });

  test('resolves without throwing even when PingOne returns an error', async () => {
    axios.post.mockRejectedValue(new Error('revocation_endpoint_unreachable'));
    await expect(svc.revokeToken('some-token', 'access_token')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. createUserFromOAuth — email fallback from idTokenClaims
//
// Regression: when PingOne's /userinfo endpoint omitted the email claim
// (common before attribute mapping is configured), userEmail was null in the
// session debug even though the user's account had an email in PingOne.
// Fix: oauthUser.js callback now merges idTokenClaims into userInfo so that
// createUserFromOAuth receives email from the ID token when userinfo omits it.
// ---------------------------------------------------------------------------
describe('createUserFromOAuth — email / name fallbacks', () => {
  // createUserFromOAuth is a method on the OAuthService singleton.
  // We access the real implementation directly (no mocking needed).
  const OAuthServiceClass = (() => {
    // Re-require to get the constructor, not the singleton
    jest.isolateModules(() => {});
    const mod = jest.requireActual('../../services/oauthService');
    // The module exports a singleton — reach the constructor via its prototype
    return Object.getPrototypeOf(mod).constructor;
  })();

  // Use the exported singleton directly — createUserFromOAuth is pure/synchronous
  const svc = (() => {
    jest.resetModules();
    jest.mock('../../config/oauth', () => MOCK_CONFIG);
    jest.mock('../../utils/oauthDebugFlags', () => ({ isOAuthVerboseDebug: () => false }));
    jest.mock('../../utils/oauthVerboseLogger', () => ({ verboseOAuthLog: jest.fn() }));
    return jest.requireActual('../../services/oauthService');
  })();

  it('picks email from userinfo.email (primary path)', () => {
    const user = svc.createUserFromOAuth({ sub: 'u1', email: 'alice@example.com', given_name: 'Alice' });
    expect(user.email).toBe('alice@example.com');
  });

  it('falls back to email_address when email is missing (PingOne alternate claim)', () => {
    // Regression: before the fix, email was null when only email_address was present.
    const user = svc.createUserFromOAuth({ sub: 'u1', email_address: 'bob@example.com' });
    expect(user.email).toBe('bob@example.com');
  });

  it('returns null for email when no email claim exists and logs a warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const user = svc.createUserFromOAuth({ sub: 'u1' });
    expect(user.email).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No email in userinfo'), expect.any(String));
    warnSpy.mockRestore();
  });

  it('builds firstName / lastName from given_name and family_name', () => {
    const user = svc.createUserFromOAuth({ sub: 'u1', given_name: 'Carol', family_name: 'Jones' });
    expect(user.firstName).toBe('Carol');
    expect(user.lastName).toBe('Jones');
  });

  it('falls back to splitting name when given_name / family_name are absent', () => {
    const user = svc.createUserFromOAuth({ sub: 'u1', name: 'Dave Smith' });
    expect(user.firstName).toBe('Dave');
    expect(user.lastName).toBe('Smith');
  });

  it('id and oauthId are set from sub', () => {
    const user = svc.createUserFromOAuth({ sub: 'pingone-uuid-123', email: 'e@e.com' });
    expect(user.id).toBe('pingone-uuid-123');
    expect(user.oauthId).toBe('pingone-uuid-123');
  });
});

// ---------------------------------------------------------------------------
// token exchange — client authentication method
// ---------------------------------------------------------------------------
// Verifies that all 5 token-requesting methods honour the CLIENT_SECRET_BASIC /
// CLIENT_SECRET_POST auth strategy via applyTokenEndpointAuth / applyAdminTokenEndpointClientAuth.
// Auth method routing: admin client uses config.tokenEndpointAuthMethod; agent CC uses
// AGENT_TOKEN_ENDPOINT_AUTH_METHOD; explicit-credential methods accept a method param.
// ---------------------------------------------------------------------------
describe('token exchange — client authentication method', () => {
  const ACCESS_TOKEN_RESPONSE = { data: { access_token: 'tok.mock.jwt' } };

  beforeEach(() => {
    axios.post.mockResolvedValue(ACCESS_TOKEN_RESPONSE);
  });
  afterEach(() => {
    axios.post.mockClear();
  });

  /** Extract body params and request headers from the first axios.post call */
  function lastPostCall() {
    const [, bodyStr, config] = axios.post.mock.calls[0];
    return { params: new URLSearchParams(bodyStr), headers: config?.headers || {} };
  }

  // -----------------------------------------------------------------------
  describe('performTokenExchange — admin client auth', () => {
    it('basic: Authorization header sent, no client_secret in body', async () => {
      const svc = makeService({ tokenEndpointAuthMethod: 'basic' });
      await svc.performTokenExchange('user.token', 'https://mcp', ['read']);
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
      restoreService();
    });

    it('post: client_secret in body, no Authorization header', async () => {
      const svc = makeService({ tokenEndpointAuthMethod: 'post' });
      await svc.performTokenExchange('user.token', 'https://mcp', ['read']);
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBe('test-admin-client-secret');
      expect(headers.Authorization).toBeUndefined();
      restoreService();
    });

    it('grant_type is always in body regardless of auth method', async () => {
      await svcSingleton.performTokenExchange('t', 'https://aud', ['s']);
      const { params } = lastPostCall();
      expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    });
  });

  // -----------------------------------------------------------------------
  describe('performTokenExchangeWithActor — admin client auth', () => {
    it('basic: Authorization header sent, no client_secret in body', async () => {
      const svc = makeService({ tokenEndpointAuthMethod: 'basic' });
      await svc.performTokenExchangeWithActor('user.token', 'agent.token', 'https://mcp', ['read']);
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
      restoreService();
    });

    it('post: client_secret in body, no Authorization header', async () => {
      const svc = makeService({ tokenEndpointAuthMethod: 'post' });
      await svc.performTokenExchangeWithActor('user.token', 'agent.token', 'https://mcp', ['read']);
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBe('test-admin-client-secret');
      expect(headers.Authorization).toBeUndefined();
      restoreService();
    });
  });

  // -----------------------------------------------------------------------
  describe('getAgentClientCredentialsToken — AGENT_TOKEN_ENDPOINT_AUTH_METHOD', () => {
    // Cache original env values to restore after each test
    let origClientId, origClientSecret, origAuthMethod;

    beforeEach(() => {
      origClientId     = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID;
      origClientSecret = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET;
      origAuthMethod   = process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD;
      process.env.PINGONE_WORKER_TOKEN_CLIENT_ID     = 'agent-client-id';
      process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET = 'agent-client-secret';
    });

    afterEach(() => {
      if (origClientId === undefined) delete process.env.PINGONE_WORKER_TOKEN_CLIENT_ID;
      else process.env.PINGONE_WORKER_TOKEN_CLIENT_ID = origClientId;
      if (origClientSecret === undefined) delete process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET;
      else process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET = origClientSecret;
      if (origAuthMethod === undefined) delete process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD;
      else process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD = origAuthMethod;
    });

    it('default (unset): Authorization header sent, no client_secret in body', async () => {
      delete process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD;
      await svcSingleton.getAgentClientCredentialsToken();
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
    });

    it('AGENT_TOKEN_ENDPOINT_AUTH_METHOD=post: client_secret in body, no Authorization header', async () => {
      process.env.AGENT_TOKEN_ENDPOINT_AUTH_METHOD = 'post';
      await svcSingleton.getAgentClientCredentialsToken();
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBe('agent-client-secret');
      expect(headers.Authorization).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  describe('getClientCredentialsTokenAs — explicit method param', () => {
    it('method=basic: Authorization header sent, no client_secret in body', async () => {
      await svcSingleton.getClientCredentialsTokenAs('cc-client', 'cc-secret', 'https://aud', 'basic');
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
    });

    it('method=post: client_secret in body, no Authorization header', async () => {
      await svcSingleton.getClientCredentialsTokenAs('cc-client', 'cc-secret', 'https://aud', 'post');
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBe('cc-secret');
      expect(headers.Authorization).toBeUndefined();
    });

    it('no method arg (default=basic): Authorization header sent', async () => {
      await svcSingleton.getClientCredentialsTokenAs('cc-client', 'cc-secret', 'https://aud');
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
    });

    it('grant_type=client_credentials is always in body', async () => {
      await svcSingleton.getClientCredentialsTokenAs('cid', 'csec', 'https://aud', 'post');
      const { params } = lastPostCall();
      expect(params.get('grant_type')).toBe('client_credentials');
    });
  });

  // -----------------------------------------------------------------------
  describe('performTokenExchangeAs — explicit method param', () => {
    it('method=basic: Authorization header sent, no client_secret in body', async () => {
      await svcSingleton.performTokenExchangeAs('subj', 'actor', 'xch-client', 'xch-secret', 'https://aud', ['scope:x'], 'basic');
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
    });

    it('method=post: client_secret in body, no Authorization header', async () => {
      await svcSingleton.performTokenExchangeAs('subj', 'actor', 'xch-client', 'xch-secret', 'https://aud', ['scope:x'], 'post');
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBe('xch-secret');
      expect(headers.Authorization).toBeUndefined();
    });

    it('no method arg (default=basic): Authorization header sent', async () => {
      await svcSingleton.performTokenExchangeAs('subj', 'actor', 'xch-client', 'xch-secret', 'https://aud', ['scope:x']);
      const { params, headers } = lastPostCall();
      expect(params.get('client_secret')).toBeNull();
      expect(headers.Authorization).toMatch(/^Basic /);
    });
  });
});
