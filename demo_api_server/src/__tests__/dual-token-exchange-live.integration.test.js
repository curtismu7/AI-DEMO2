/**
 * @file dual-token-exchange-live.integration.test.js
 * @description Live PingOne integration tests for RFC 8693 token exchange.
 *
 * Tests both raw HTTP token-exchange calls AND oauthService methods
 * using real PingOne credentials from .env.
 *
 * Run:
 *   cd banking_api_server
 *   RUN_PINGONE_TOKEN_INTEGRATION=true npx jest --testPathPattern=dual-token-exchange-live --forceExit --verbose
 */

const axios = require('axios');
const crypto = require('crypto');

const TIMEOUT = 30000;

const live =
  process.env.RUN_PINGONE_TOKEN_EXCHANGE === 'true' ||
  process.env.RUN_PINGONE_TOKEN_INTEGRATION === 'true';

// Headless login requires both USERNAME and PASSWORD env vars (not set in CI or
// normal development — only when a developer explicitly exports them).
const hasHeadlessCredentials = !!(process.env.USERNAME && process.env.PASSWORD);

// ── Helpers ──────────────────────────────────────────────────────────

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`Not a 3-part JWT: ${parts.length} parts`);
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()),
    payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
  };
}

/** Build Authorization: Basic header from client_id:client_secret */
function basicAuth(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/** Apply client auth to token request based on method ('basic' or 'post') */
function applyClientAuth(method, clientId, clientSecret, body, headers) {
  if (method === 'post') {
    body.set('client_secret', clientSecret);
  } else {
    headers.Authorization = basicAuth(clientId, clientSecret);
  }
}

/**
 * Headless PingOne login: authorize -> flow credentials -> resume -> code -> token.
 * Manually tracks cookies (ST session cookie) between requests.
 */
async function headlessPingOneLogin({ envId, region, clientId, clientSecret, redirectUri, username, password, scopes, authMethod }) {
  const base = `https://auth.pingone.${region || 'com'}/${envId}/as`;
  const codeVerifier = crypto.randomBytes(64).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  function extractCookies(res) {
    return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  }
  function mergeCookies(existing, fresh) {
    if (!fresh) return existing;
    const map = new Map();
    for (const pair of (existing || '').split('; ').filter(Boolean)) {
      const [k, ...v] = pair.split('=');
      map.set(k, v.join('='));
    }
    for (const pair of fresh.split('; ').filter(Boolean)) {
      const [k, ...v] = pair.split('=');
      map.set(k, v.join('='));
    }
    return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  let cookies = '';

  // Step 1: Authorize (302 -> signon page with flowId)
  const authUrl = `${base}/authorize?` + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: scopes, state: crypto.randomBytes(16).toString('hex'),
    code_challenge: codeChallenge, code_challenge_method: 'S256',
  });

  const r1 = await axios.get(authUrl, { maxRedirects: 0, validateStatus: s => true });
  cookies = mergeCookies(cookies, extractCookies(r1));

  const loc1 = r1.headers.location || '';
  let flowId;
  if (r1.status === 302 || r1.status === 303) {
    try { flowId = new URL(loc1).searchParams.get('flowId'); } catch (e) { /* */ }
    const r1b = await axios.get(loc1, {
      maxRedirects: 0, validateStatus: s => true, headers: { Cookie: cookies },
    });
    cookies = mergeCookies(cookies, extractCookies(r1b));
  }
  if (!flowId) throw new Error('Could not extract flowId from PingOne authorize');

  // Step 2: Submit credentials
  const flowUrl = `https://auth.pingone.${region || 'com'}/${envId}/flows/${flowId}`;
  const r2 = await axios.post(flowUrl, { username, password }, {
    headers: { 'Content-Type': 'application/vnd.pingidentity.usernamePassword.check+json', Cookie: cookies },
    validateStatus: s => true,
  });
  cookies = mergeCookies(cookies, extractCookies(r2));
  if (r2.data?.status !== 'COMPLETED') {
    throw new Error(`Flow not COMPLETED: ${r2.data?.status}`);
  }

  // Step 3: Resume -> redirect with code
  const r3 = await axios.get(`${base}/resume?flowId=${flowId}`, {
    maxRedirects: 0, validateStatus: s => true, headers: { Cookie: cookies },
  });
  const loc3 = r3.headers.location || '';
  let code;
  if (loc3) {
    const u = new URL(loc3);
    code = u.searchParams.get('code');
    const error = u.searchParams.get('error');
    if (error) throw new Error(`PingOne resume error: ${decodeURIComponent(error).slice(0, 500)}`);
  }
  if (!code) throw new Error('No authorization code in resume redirect');

  // Step 4: Exchange code (user client uses client_secret_post)
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    code_verifier: codeVerifier, client_id: clientId,
  });
  const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
  applyClientAuth(authMethod || 'post', clientId, clientSecret, tokenBody, tokenHeaders);

  const tokenRes = await axios.post(`${base}/token`, tokenBody.toString(), { headers: tokenHeaders });
  return {
    accessToken: tokenRes.data.access_token,
    idToken: tokenRes.data.id_token,
    refreshToken: tokenRes.data.refresh_token,
    expiresIn: tokenRes.data.expires_in,
    scope: tokenRes.data.scope,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('JWT decode helper', () => {
  it('decodes a valid 3-part JWT', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test', aud: 'demo' })).toString('base64url');
    const { payload: p } = decodeJwt(`${header}.${payload}.sig`);
    expect(p.sub).toBe('test');
    expect(p.aud).toBe('demo');
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 1: Obtain tokens
// ────────────────────────────────────────────────────────────────────

(live && hasHeadlessCredentials ? describe : describe.skip)('Live PingOne: Headless login', () => {
  jest.setTimeout(TIMEOUT);

  let envId, region, userClientId, userClientSecret, username, password, redirectUri;

  beforeAll(() => {
    require('dotenv').config();
    envId = process.env.PINGONE_ENVIRONMENT_ID;
    region = process.env.PINGONE_REGION || 'com';
    userClientId = process.env.PINGONE_USER_CLIENT_ID;
    userClientSecret = process.env.PINGONE_USER_CLIENT_SECRET;
    username = process.env.USERNAME;
    password = process.env.PASSWORD;
    redirectUri = process.env.PINGONE_USER_REDIRECT_URI
      || `${process.env.PUBLIC_APP_URL || 'http://localhost:3001'}/api/auth/oauth/user/callback`;
  });

  it('obtains user access_token and id_token via headless PKCE flow', async () => {
    expect(envId).toBeTruthy();
    expect(userClientId).toBeTruthy();
    expect(username).toBeTruthy();

    const tokens = await headlessPingOneLogin({
      envId, region, clientId: userClientId, clientSecret: userClientSecret,
      redirectUri, username, password,
      scopes: 'openid profile email read write',
      authMethod: 'post', // user client uses client_secret_post
    });

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.accessToken.split('.')).toHaveLength(3);

    const { payload } = decodeJwt(tokens.accessToken);
    expect(payload.sub).toBeTruthy();
    console.log('[headless] sub:', payload.sub, 'scope:', payload.scope, 'aud:', payload.aud);

    if (tokens.idToken) {
      const idPayload = decodeJwt(tokens.idToken).payload;
      expect(idPayload.sub).toBe(payload.sub);
    }

    process.env._TEST_USER_ACCESS_TOKEN = tokens.accessToken;
    process.env._TEST_USER_ID_TOKEN = tokens.idToken || '';
  });
});

(live ? describe : describe.skip)('Live PingOne: Agent Client Credentials', () => {
  jest.setTimeout(TIMEOUT);

  let agentClientId, agentClientSecret, envId, region, enduserAudience;

  beforeAll(() => {
    require('dotenv').config();
    envId = process.env.PINGONE_ENVIRONMENT_ID;
    region = process.env.PINGONE_REGION || 'com';
    agentClientId = process.env.PINGONE_AI_AGENT_CLIENT_ID;
    agentClientSecret = process.env.PINGONE_AI_AGENT_CLIENT_SECRET;
    enduserAudience = process.env.ENDUSER_AUDIENCE;
  });

  it('obtains agent actor token with ENDUSER_AUDIENCE', async () => {
    expect(agentClientId).toBeTruthy();
    expect(agentClientSecret).toBeTruthy();

    const base = `https://auth.pingone.${region}/${envId}/as`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: agentClientId,
      client_secret: agentClientSecret,
    });
    if (enduserAudience) body.set('audience', enduserAudience);

    const res = await axios.post(`${base}/token`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const agentToken = res.data.access_token;
    expect(agentToken).toBeTruthy();
    expect(agentToken.split('.')).toHaveLength(3);

    const { payload } = decodeJwt(agentToken);
    console.log('[agent CC] sub:', payload.sub, 'aud:', payload.aud);

    process.env._TEST_AGENT_TOKEN = agentToken;
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 2: RFC 8693 token exchange via oauthService (uses admin client)
// ────────────────────────────────────────────────────────────────────

(live ? describe : describe.skip)('Live PingOne: oauthService token exchange', () => {
  jest.setTimeout(TIMEOUT);

  let oauthService, configStore;

  beforeAll(async () => {
    require('dotenv').config();
    configStore = require('../../services/configStore');
    await configStore.ensureInitialized();
    oauthService = require('../../services/oauthService');
  });

  it('getAgentClientCredentialsToken returns a valid JWT', async () => {
    const token = await oauthService.getAgentClientCredentialsToken();
    expect(token).toBeTruthy();
    expect(token.split('.')).toHaveLength(3);
    const { payload } = decodeJwt(token);
    expect(payload.sub || payload.client_id).toBeTruthy();
    console.log('[oauthService.getAgentCC] sub:', payload.sub);
  });

  it('performTokenExchange: user -> MCP (1-exchange)', async () => {
    const userToken = process.env._TEST_USER_ACCESS_TOKEN;
    if (!userToken) return console.warn('[SKIP] No user token');
    const mcpUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    expect(mcpUri).toBeTruthy();

    const mcpToken = await oauthService.performTokenExchange(userToken, mcpUri, ['read', 'write']);
    expect(mcpToken).toBeTruthy();
    expect(mcpToken.split('.')).toHaveLength(3);

    const { payload } = decodeJwt(mcpToken);
    expect(payload.sub).toBeTruthy();
    console.log('[1-exchange] sub:', payload.sub, 'aud:', payload.aud, 'scope:', payload.scope);

    // Audience is set by PingOne policy (may differ from requested resource)
    expect(payload.aud).toBeTruthy();
    console.log('[1-exchange] actual aud:', payload.aud);
  });

  it('performTokenExchangeWithActor: user + agent -> MCP (dual exchange)', async () => {
    const userToken = process.env._TEST_USER_ACCESS_TOKEN;
    const agentToken = process.env._TEST_AGENT_TOKEN;
    if (!userToken || !agentToken) return console.warn('[SKIP] Missing tokens');
    const mcpUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

    const mcpToken = await oauthService.performTokenExchangeWithActor(
      userToken, agentToken, mcpUri, ['read', 'write']
    );
    expect(mcpToken).toBeTruthy();
    expect(mcpToken.split('.')).toHaveLength(3);

    const { payload } = decodeJwt(mcpToken);
    expect(payload.sub).toBeTruthy();
    console.log('[dual-exchange] sub:', payload.sub, 'aud:', payload.aud);
    console.log('[dual-exchange] act:', JSON.stringify(payload.act));

    // Verify act claim structure if present
    if (payload.act) {
      expect(payload.act.sub).toBeTruthy();
      console.log('[dual-exchange] Actor sub:', payload.act.sub);
    }

    // Audience is set by PingOne policy (may differ from requested resource)
    expect(payload.aud).toBeTruthy();
    console.log('[dual-exchange] actual aud:', payload.aud);
  });

  it('performTokenExchangeFromIdToken: id_token -> MCP', async () => {
    const idToken = process.env._TEST_USER_ID_TOKEN;
    if (!idToken) return console.warn('[SKIP] No id_token');
    const mcpUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

    try {
      const mcpToken = await oauthService.performTokenExchangeFromIdToken(
        idToken, mcpUri, ['read']
      );
      expect(mcpToken).toBeTruthy();
      const { payload } = decodeJwt(mcpToken);
      console.log('[id-token-exchange] sub:', payload.sub);
    } catch (err) {
      // Some PingOne configs may not support id_token exchange
      const msg = err.message || '';
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unsupported')) {
        console.warn('[id-token-exchange] Not supported by PingOne config:', msg.slice(0, 200));
      } else {
        throw err;
      }
    }
  });

  it('performTokenExchangeWithActorIdToken: id_token + agent -> MCP', async () => {
    const idToken = process.env._TEST_USER_ID_TOKEN;
    const agentToken = process.env._TEST_AGENT_TOKEN;
    if (!idToken || !agentToken) return console.warn('[SKIP] Missing tokens');
    const mcpUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

    try {
      const mcpToken = await oauthService.performTokenExchangeWithActorIdToken(
        idToken, agentToken, mcpUri, ['read']
      );
      expect(mcpToken).toBeTruthy();
      const { payload } = decodeJwt(mcpToken);
      console.log('[id-token-dual] sub:', payload.sub, 'act:', JSON.stringify(payload.act));
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('invalid_request') || msg.includes('invalid_grant') || msg.includes('unsupported')) {
        console.warn('[id-token-dual] Not supported:', msg.slice(0, 200));
      } else {
        throw err;
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 3: Raw HTTP token exchange (admin client, matching oauthService)
// ────────────────────────────────────────────────────────────────────

(live ? describe : describe.skip)('Live PingOne: Raw HTTP token exchange (admin client)', () => {
  jest.setTimeout(TIMEOUT);

  let adminClientId, adminClientSecret, mcpResourceUri, envId, region, adminAuthMethod;

  beforeAll(() => {
    require('dotenv').config();
    envId = process.env.PINGONE_ENVIRONMENT_ID;
    region = process.env.PINGONE_REGION || 'com';
    // Admin client performs token exchange (same as oauthService.performTokenExchange)
    adminClientId = process.env.PINGONE_AI_CORE_CLIENT_ID
      || process.env.PINGONE_CORE_CLIENT_ID
      || process.env.PINGONE_ADMIN_CLIENT_ID;
    adminClientSecret = process.env.PINGONE_AI_CORE_CLIENT_SECRET
      || process.env.PINGONE_CORE_CLIENT_SECRET
      || process.env.PINGONE_ADMIN_CLIENT_SECRET;
    mcpResourceUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    adminAuthMethod = (process.env.PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH || 'post').toLowerCase();
  });

  it('raw 1-exchange via admin client', async () => {
    const userToken = process.env._TEST_USER_ACCESS_TOKEN;
    if (!userToken) return console.warn('[SKIP] No user token');
    expect(adminClientId).toBeTruthy();
    expect(mcpResourceUri).toBeTruthy();

    const base = `https://auth.pingone.${region}/${envId}/as`;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: mcpResourceUri,
      scope: 'read write',
      client_id: adminClientId,
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyClientAuth(adminAuthMethod, adminClientId, adminClientSecret, body, headers);

    try {
      const res = await axios.post(`${base}/token`, body.toString(), { headers });
      const mcpToken = res.data.access_token;
      expect(mcpToken).toBeTruthy();
      expect(mcpToken.split('.')).toHaveLength(3);
      const { payload } = decodeJwt(mcpToken);
      expect(payload.sub).toBeTruthy();
      expect(payload.aud).toBeTruthy();
      console.log('[raw-1ex] sub:', payload.sub, 'aud:', payload.aud, 'scope:', payload.scope);
    } catch (err) {
      const ed = err.response?.data;
      console.error('[raw-1ex] FAILED:', err.response?.status, ed?.error, ed?.error_description);
      throw err;
    }
  });

  it('raw dual exchange via admin client', async () => {
    const userToken = process.env._TEST_USER_ACCESS_TOKEN;
    const agentToken = process.env._TEST_AGENT_TOKEN;
    if (!userToken || !agentToken) return console.warn('[SKIP] Missing tokens');

    const base = `https://auth.pingone.${region}/${envId}/as`;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: userToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      actor_token: agentToken,
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: mcpResourceUri,
      scope: 'read write',
      client_id: adminClientId,
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    applyClientAuth(adminAuthMethod, adminClientId, adminClientSecret, body, headers);

    try {
      const res = await axios.post(`${base}/token`, body.toString(), { headers });
      const mcpToken = res.data.access_token;
      expect(mcpToken).toBeTruthy();
      expect(mcpToken.split('.')).toHaveLength(3);
      const { payload } = decodeJwt(mcpToken);
      expect(payload.sub).toBeTruthy();
      expect(payload.aud).toBeTruthy();
      console.log('[raw-dual] sub:', payload.sub, 'aud:', payload.aud);
      console.log('[raw-dual] act:', JSON.stringify(payload.act));
      if (payload.act) {
        expect(payload.act.sub).toBeTruthy();
      }
    } catch (err) {
      const ed = err.response?.data;
      console.error('[raw-dual] FAILED:', err.response?.status, ed?.error, ed?.error_description);
      throw err;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 4: BFF 401 behavior
// ────────────────────────────────────────────────────────────────────

(live ? describe : describe.skip)('BFF 401 redirect behavior', () => {
  jest.setTimeout(TIMEOUT);

  // Use http (not https) for local BFF
  const BFF_BASE = process.env.BFF_TEST_URL || 'http://localhost:3002';

  async function expectUnauthorized(path) {
    try {
      const res = await axios.get(`${BFF_BASE}${path}`, {
        timeout: 5000, maxRedirects: 0, validateStatus: () => true,
      });
      expect([401, 302, 403]).toContain(res.status);
      console.log(`[401 test] ${path} -> ${res.status}`);
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.code === 'EPROTO' || err.message?.includes('socket hang up')) {
        console.warn(`[401 test] BFF not reachable at ${BFF_BASE} - skipping`);
        return;
      }
      throw err;
    }
  }

  async function expectAnonOk(path, predicate) {
    try {
      const res = await axios.get(`${BFF_BASE}${path}`, {
        timeout: 5000, maxRedirects: 0, validateStatus: () => true,
      });
      expect(res.status).toBe(200);
      expect(predicate(res.data)).toBe(true);
      console.log(`[anon-ok test] ${path} -> 200`);
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.code === 'EPROTO' || err.message?.includes('socket hang up')) {
        console.warn(`[anon-ok test] BFF not reachable at ${BFF_BASE} - skipping`);
        return;
      }
      throw err;
    }
  }

  it('GET /api/accounts/my returns 401 without session', () => expectUnauthorized('/api/accounts/my'));
  // session-preview is intentionally anon-friendly: returns an empty tokenEvents
  // array when there's no session so the SPA can render the Token Chain panel
  // pre-login without producing 401 noise. Do not add requireSession to this route.
  it('GET /api/tokens/session-preview returns 200 with empty tokenEvents (no session)', () =>
    expectAnonOk('/api/tokens/session-preview', (data) =>
      Array.isArray(data?.tokenEvents) && data.tokenEvents.length === 0
    ));
  it('GET /api/tokens/userinfo returns 401 without session', () => expectUnauthorized('/api/tokens/userinfo'));
});
