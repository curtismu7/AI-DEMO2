// demo_api_server/routes/privilegeMcpClient.js
// BFF relay for the Privilege MCP Client page — handles OAuth PKCE flow,
// MCP JSON-RPC relay (initialize, tools/list, tools/call), and SSE events.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory per-session state (keyed by express session id)
// ---------------------------------------------------------------------------
const clientSessions = new Map();

function getClientSession(req) {
  const sid = req.sessionID || req.session?.id || 'default';
  if (!clientSessions.has(sid)) {
    clientSessions.set(sid, {
      _sid: sid,
      config: {
        mcpUrl: process.env.PRIVILEGE_MCPGW_URL || '',
        clientId: process.env.PRIVILEGE_SSO_CLIENT_ID || process.env.PINGONE_MCP_GATEWAY_CLIENT_ID || '',
        scopes: 'openid profile email',
        llmUrl: 'http://127.0.0.1:11434',
        llmModel: 'llama3.2:1b',
      },
      oauth: { accessToken: null, refreshToken: null, expiresAt: null, tokenUri: null },
      tools: [],
      mcpSession: { initialized: false, protocolVersion: null, sessionId: null },
      pendingAuth: null,
    });
  }
  const session = clientSessions.get(sid);
  session._sid = sid;
  return session;
}

/**
 * Only accept a site-relative path ("/x", never "//host", a full URL, or a
 * path with query/fragment) so the OAuth callback can never redirect off-site.
 * @param {unknown} value
 * @returns {string|null}
 */
function sanitizeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('?') || value.includes('#')) return null;
  return value;
}



// ---------------------------------------------------------------------------
// SSE event stream for live relay — scoped per express session so one browser
// never receives another session's MCP relay bodies / tool results.
// ---------------------------------------------------------------------------
const sseClients = new Map(); // sid -> Set<ServerResponse>

/**
 * Emit an SSE event only to listeners for this BFF session.
 * @param {{ _sid?: string }|string|null} sessionOrSid
 * @param {string} type
 * @param {object} payload
 */
function emitEvent(sessionOrSid, type, payload) {
  const sid = typeof sessionOrSid === 'string'
    ? sessionOrSid
    : sessionOrSid?._sid;
  if (!sid) return;
  const clients = sseClients.get(sid);
  if (!clients || clients.size === 0) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n\n`;
  for (const client of clients) {
    client.write(msg);
  }
}

router.get('/events', (req, res) => {
  const sid = req.sessionID || req.session?.id || 'default';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });
  res.write('\n');
  let clients = sseClients.get(sid);
  if (!clients) {
    clients = new Set();
    sseClients.set(sid, clients);
  }
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(sid);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomString(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

function decodeMcpBody(text) {
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch { /* continue */ }
  const lines = text.split('\n').map((l) => l.trim());
  const dataLines = lines
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try { return JSON.parse(dataLines[i]); } catch { /* continue */ }
  }
  return { raw: text };
}

function normalizeMcpFailure(status, text) {
  const snippet = text.slice(0, 300);
  if (status === 502) {
    const lower = text.toLowerCase();
    if (lower.includes('<html') || lower.includes('bad gateway') || lower.includes('nginx')) {
      return 'MCP gateway returned 502 Bad Gateway from upstream. User may not be authorized for the target MCP tools or the upstream MCP service is unavailable.';
    }
  }
  return `MCP request failed: ${status} ${snippet}`;
}

/**
 * Error carrying the upstream HTTP status, so a relay handler can answer with
 * the SAME class of failure instead of flattening everything to 500.
 */
function mcpRelayError(status, text) {
  const err = new Error(normalizeMcpFailure(status, text));
  err.upstreamStatus = status;
  return err;
}

/**
 * Status a relay handler should answer with. An upstream 4xx is the caller's
 * problem and must survive the hop — Privilege Cloud replying "401 User is not
 * authorized for privilege.pingone.com/api/mcp" as a 500 told the operator the
 * demo was broken when the real answer was that their account lacks the
 * entitlement. Anything else (5xx, network failure, a bug in here) stays 500:
 * the caller's request was fine, this relay could not complete it.
 */
function relayFailureStatus(err) {
  const status = err && err.upstreamStatus;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

// Refresh a little before expiry so an in-flight relay never races the clock
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

function accessTokenExpiring(session) {
  if (!session.oauth.expiresAt) return false;
  return Date.now() >= session.oauth.expiresAt - TOKEN_REFRESH_SKEW_MS;
}

// Exchange the stored refresh token for a new access token.
// Returns false (and clears the session tokens) when refresh is unavailable or
// rejected — callers then surface the original 401 and the UI asks for re-login.
async function refreshAccessToken(session) {
  if (!session.oauth.refreshToken || !session.oauth.tokenUri) return false;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.oauth.refreshToken,
    client_id: session.config.clientId,
  });
  const clientSecret = process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || '';
  if (clientSecret) body.set('client_secret', clientSecret);

  let response;
  let data = {};
  try {
    response = await fetch(session.oauth.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await response.text();
    try { data = JSON.parse(text); } catch { data = {}; }
  } catch (err) {
    emitEvent(session, 'oauth', { phase: 'refresh_failed', error: err.message });
    return false;
  }

  if (!response.ok || !data.access_token) {
    session.oauth.accessToken = null;
    session.oauth.refreshToken = null;
    session.oauth.expiresAt = null;
    emitEvent(session, 'oauth', { phase: 'refresh_failed', status: response.status });
    return false;
  }

  session.oauth.accessToken = data.access_token;
  // PingOne rotates refresh tokens when replay protection is on — keep the newest
  if (data.refresh_token) session.oauth.refreshToken = data.refresh_token;
  session.oauth.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  if (data.scope) session.oauth.scope = data.scope;
  emitEvent(session, 'oauth', { phase: 'refresh_success', expiresIn: data.expires_in || null });
  return true;
}

async function fetchMcp(session, pathname, body, withAuth = true, allowRefreshRetry = true) {
  if (!session.config.mcpUrl) throw new Error('MCP URL is required');

  if (withAuth && accessTokenExpiring(session)) {
    await refreshAccessToken(session);
  }

  const targetUrl = new URL(session.config.mcpUrl);
  if (pathname) targetUrl.pathname = pathname;

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (withAuth && session.oauth.accessToken) {
    headers.Authorization = `Bearer ${session.oauth.accessToken}`;
    // Debug: decode token claims
    try {
      const payload = JSON.parse(Buffer.from(session.oauth.accessToken.split('.')[1], 'base64url').toString());
      console.log('[privilege-mcp] Token sub:', payload.sub, 'aud:', payload.aud, 'scope:', payload.scope);
    } catch {}
  }
  if (session.mcpSession.sessionId) {
    headers['MCP-Session-Id'] = session.mcpSession.sessionId;
  }
  // Privilege Cloud requires x-procyon-session-id on every request
  if (targetUrl.hostname === 'privilege.pingone.com' || targetUrl.hostname.endsWith('.applications.privilege.pingone.com')) {
    headers['x-procyon-session-id'] = session.config._procyonSessionId ||
      (session.config._procyonSessionId = crypto.randomUUID());
  }
  // MCP spec requires mcp-protocol-version on all non-initialize requests
  if (body?.method && body.method !== 'initialize') {
    headers['mcp-protocol-version'] = session.mcpSession.protocolVersion || '2024-11-05';
  }

  emitEvent(session, 'relay', { direction: 'client->mcp', method: 'POST', url: targetUrl.toString(), body });

  const response = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  const parsed = decodeMcpBody(text);

  const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('MCP-Session-Id');
  if (responseSessionId && responseSessionId !== session.mcpSession.sessionId) {
    session.mcpSession.sessionId = responseSessionId;
    emitEvent(session, 'mcp', { phase: 'session_attached', sessionId: responseSessionId });
  }

  emitEvent(session, 'relay', {
    direction: 'mcp->client',
    status: response.status,
    headers: { 'www-authenticate': response.headers.get('www-authenticate'), 'mcp-session-id': responseSessionId },
    body: parsed,
  });

  if (!response.ok) {
    console.error('[privilege-mcp] Gateway error:', response.status, text.slice(0, 500));
    if (response.status === 401 && withAuth && allowRefreshRetry && await refreshAccessToken(session)) {
      return fetchMcp(session, pathname, body, withAuth, false);
    }
    throw mcpRelayError(response.status, text);
  }
  if (parsed?.error) {
    throw new Error(`MCP RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

async function ensureMcpSessionInitialized(session) {
  if (session.mcpSession.initialized) return;

  const initRpc = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'MCP Privilege Demo Client', version: '1.0.0' },
    },
  };
  const initResponse = await fetchMcp(session, null, initRpc, true);
  const serverProtocol = initResponse?.result?.protocolVersion || '2024-11-05';

  await fetchMcp(session, null, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, true);

  session.mcpSession.initialized = true;
  session.mcpSession.protocolVersion = serverProtocol;
  emitEvent(session, 'mcp', { phase: 'initialized', protocolVersion: serverProtocol });
}

function resetMcpState(session) {
  session.tools = [];
  session.mcpSession.initialized = false;
  session.mcpSession.protocolVersion = null;
  session.mcpSession.sessionId = null;
}

async function discoverAuth(session) {
  const discoverHeaders = {};
  const mcpUrlParsed = new URL(session.config.mcpUrl);
  if (mcpUrlParsed.hostname === 'privilege.pingone.com' || mcpUrlParsed.hostname.endsWith('.applications.privilege.pingone.com')) {
    discoverHeaders['x-procyon-session-id'] = session.config._procyonSessionId ||
      (session.config._procyonSessionId = crypto.randomUUID());
  }
  // An unreachable MCP URL must NOT abort discovery: the PingOne OIDC fallback
  // below can still resolve the endpoints. Unguarded, this fetch threw straight
  // out of the function and /auth/start answered 500 {"error":"fetch failed"} —
  // sign-in was impossible whenever the gateway was down, even though the
  // fallback a few lines later would have worked.
  let response = null;
  let bodyText = '';
  let transportError = null;
  try {
    response = await fetch(session.config.mcpUrl, { method: 'GET', headers: discoverHeaders });
    bodyText = await response.text();
  } catch (err) {
    transportError = err;
  }
  let body;
  try { body = JSON.parse(bodyText); } catch { body = {}; }

  const authHeader = (response && response.headers.get('www-authenticate')) || '';
  const authUriMatch = authHeader.match(/authorization_uri="([^"]+)"/);
  const authorizationUri = body.authorization_uri || (authUriMatch ? authUriMatch[1] : null);
  const tokenUri = body.token_uri || null;

  if (authorizationUri && tokenUri) return { authorizationUri, tokenUri };

  // PingOne OIDC discovery fallback
  try {
    const mcpUrl = new URL(session.config.mcpUrl);
    const envMatch = mcpUrl.pathname.match(/\/v1\/environments\/([0-9a-fA-F-]{36})\/mcp\/?$/);
    let envId = envMatch?.[1];
    // Privilege Cloud authenticates via its own SSO PingOne environment. The
    // same fallback applies to a self-hosted MCP GATEWAY frontend
    // (local.ping-devops.com:8680): the gateway wizard is configured with this
    // environment's OIDC endpoints, so PRIVILEGE_SSO_ENV_ID is the right answer
    // for any host we do not recognise — not just privilege.pingone.com.
    // Without this, pointing the client at the gateway made sign-in impossible
    // whenever the gateway itself could not be reached to self-advertise.
    if (!envId) {
      envId = process.env.PRIVILEGE_SSO_ENV_ID || process.env.PINGONE_ENVIRONMENT_ID;
    }
    const authHost = mcpUrl.host.startsWith('api.') ? mcpUrl.host.replace(/^api\./, 'auth.') : 'auth.pingone.com';
    if (envId) {
      const wellKnownUrl = `https://${authHost}/${envId}/as/.well-known/openid-configuration`;
      const metaResponse = await fetch(wellKnownUrl, { method: 'GET' });
      if (metaResponse.ok) {
        const meta = await metaResponse.json();
        if (meta.authorization_endpoint && meta.token_endpoint) {
          return { authorizationUri: meta.authorization_endpoint, tokenUri: meta.token_endpoint };
        }
      }
    }
  } catch { /* fall through */ }

  // `response.status` alone was useless when the fetch never completed — it threw
  // a TypeError on null. Name what failed and what would fix it.
  throw new Error(transportError
    ? `Failed to discover OAuth metadata: ${session.config.mcpUrl} is unreachable (${transportError.message}), `
      + 'and no PRIVILEGE_SSO_ENV_ID / PINGONE_ENVIRONMENT_ID is set to fall back on. '
      + 'Start the MCP gateway (docker compose --profile mcpgw up -d ping-mcpgw) or fix PRIVILEGE_MCPGW_URL.'
    : `Failed to discover OAuth metadata from MCP URL. status=${response.status}`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /state — current session state
router.get('/state', (req, res) => {
  const session = getClientSession(req);
  const mainAppAuth = Boolean(req.session?.oauthTokens?.accessToken);
  res.json({
    config: session.config,
    oauth: { authenticated: Boolean(session.oauth.accessToken), expiresAt: session.oauth.expiresAt, scope: session.oauth.scope || '' },
    mainAppAuthenticated: mainAppAuth,
    user: req.session?.user || null,
    tools: session.tools,
  });
});

// POST /dev/console-token — DEV ONLY. Inject a Privilege console token as the
// client bearer, so the UI can drive the real gateway without the PingOne OAuth
// flow (which fails the kid wall — see docs/PRIVILEGE-MCP.md). Accepts either a
// raw token or a whole "Copy as cURL" blob and parses auth_token out of it.
//
// Disabled in production: the console token is a short-lived operator credential,
// never a login. This is a bench aid, gated off any real deployment.
router.post('/dev/console-token', express.json({ limit: '256kb' }), async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });

  const blob = String(req.body?.curl || req.body?.token || '');
  // auth_token from a cookie (-b 'auth_token=...') or a raw JWT; JWTs are three
  // base64url segments joined by dots.
  const token =
    (blob.match(/auth_token=([A-Za-z0-9._-]+)/) || [])[1] ||
    (blob.match(/\b(eyJ[A-Za-z0-9._-]{20,})\b/) || [])[1] ||
    '';
  if (!token) return res.status(400).json({ error: 'No auth_token / JWT found in the pasted value.' });

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch {
    return res.status(400).json({ error: 'Value is not a decodable JWT.' });
  }
  const expiresAt = payload.exp ? payload.exp * 1000 : null;
  if (expiresAt && expiresAt <= Date.now()) {
    return res.status(400).json({ error: 'Token is already expired — copy a fresh one from the console.' });
  }

  const session = getClientSession(req);
  session.oauth.accessToken = token;
  session.oauth.refreshToken = null;
  session.oauth.expiresAt = expiresAt;
  session.oauth.scope = 'console-token';
  // Point this client session at an app the console token can route to. The
  // default targets mcp-pingone-admin's frontend host (nginx rewrites it to the
  // registered Frontend Name). Override per-session with mcpUrl in the body.
  const mcpUrl = String(req.body?.mcpUrl || '').trim() ||
    'https://mcp-pingone-admin.mcpgw.local.ping-devops.com/mcp';
  session.config.mcpUrl = mcpUrl;
  // Force a fresh MCP handshake against the new target/token.
  resetMcpState(session);

  emitEvent(session, 'mcp', { phase: 'console_token_set', user: payload.user || payload.sub, kid: header.kid });
  res.json({
    ok: true,
    user: payload.user || payload.sub || null,
    kid: header.kid || null,
    kidMatchesGateway: header.kid === 'infra-root-jwt',
    expiresInMinutes: expiresAt ? Math.round((expiresAt - Date.now()) / 60000) : null,
    mcpUrl,
  });
});

// POST /config — save config
router.post('/config', express.json(), (req, res) => {
  const session = getClientSession(req);
  // The client posts its whole config object before /auth/start. Merging blanks
  // wiped the env-seeded clientId/mcpUrl for the life of the session — one click
  // made before the page's /state fetch resolved left "Client ID is required
  // before auth start." stuck on every later attempt. Blank means "unchanged".
  const patch = Object.fromEntries(
    Object.entries(req.body || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  session.config = { ...session.config, ...patch };
  resetMcpState(session);
  emitEvent(session, 'config', { config: session.config });
  res.json({ ok: true, config: session.config });
});

// POST /auth/start — begin OAuth PKCE flow
router.post('/auth/start', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.config.clientId) {
      return res.status(400).json({ error: 'Client ID is required before auth start.' });
    }
    const { authorizationUri, tokenUri } = await discoverAuth(session);
    const verifier = randomString(48);
    const challenge = sha256Base64Url(verifier);
    const oauthState = randomString(24);

    // Build callback URL relative to the externally-visible host
    const host = req.get('x-forwarded-host') || process.env.PRIVILEGE_MCP_CALLBACK_HOST || 'local.ping-devops.com:4000';
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
    const redirectUri = `${protocol}://${host}/api/privilege-mcp/auth/callback`;

    const authUrl = new URL(authorizationUri);
    authUrl.searchParams.set('client_id', session.config.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('scope', session.config.scopes);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', oauthState);
    // Use the Privilege-configured user (may differ from main app user)
    const loginHint = process.env.PRIVILEGE_LOGIN_HINT || req.session?.user?.email;
    if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

    const returnTo = sanitizeReturnTo(req.body?.returnTo);
    session.pendingAuth = { oauthState, verifier, tokenUri, redirectUri, returnTo };
    // Force express-session to persist so connect.sid cookie survives the redirect
    req.session.privilegeOAuthStarted = true;
    emitEvent(session, 'oauth', { phase: 'start', authorizationUri, tokenUri, authUrl: authUrl.toString() });
    res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    emitEvent(session, 'error', { scope: 'oauth_start', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/callback — OAuth code exchange
router.get('/auth/callback', async (req, res) => {
  const session = getClientSession(req);
  // returnTo was sanitized at /auth/start time (site-relative path only).
  const returnBase = sanitizeReturnTo(session.pendingAuth?.returnTo) || '/privilege-mcp-client';
  const redirectWithError = (reason) => {
    const safeReason = encodeURIComponent((reason || 'OAuth callback failed').slice(0, 300));
    res.redirect(`${returnBase}?auth=error&reason=${safeReason}`);
  };

  try {
    const { code, state: incomingState, error, error_description } = req.query;
    if (error) {
      const reason = error_description ? `${error}: ${error_description}` : error;
      emitEvent(session, 'oauth', { phase: 'callback_error', error: reason });
      return redirectWithError(reason);
    }
    if (!session.pendingAuth || incomingState !== session.pendingAuth.oauthState) {
      throw new Error('OAuth state mismatch.');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: session.pendingAuth.redirectUri,
      code_verifier: session.pendingAuth.verifier,
    });
    const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
    tokenBody.set('client_id', session.config.clientId);
    const clientSecret = process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || '';
    if (clientSecret) tokenBody.set('client_secret', clientSecret);

    const tokenResponse = await fetch(session.pendingAuth.tokenUri, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenBody,
    });
    const tokenText = await tokenResponse.text();
    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch { throw new Error(`Token exchange non-JSON: ${tokenText.slice(0, 300)}`); }
    if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenText.slice(0, 300)}`);

    session.oauth.accessToken = tokenData.access_token;
    session.oauth.refreshToken = tokenData.refresh_token || null;
    session.oauth.expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null;
    session.oauth.scope = tokenData.scope || session.config.scopes || '';
    // Keep the token endpoint so refresh can run after pendingAuth is cleared
    session.oauth.tokenUri = session.pendingAuth.tokenUri;
    session.pendingAuth = null;
    resetMcpState(session);

    emitEvent(session, 'oauth', { phase: 'token_success', expiresIn: tokenData.expires_in || null });
    res.redirect(`${returnBase}?auth=success`);
  } catch (err) {
    emitEvent(session, 'error', { scope: 'oauth_callback', message: err.message });
    redirectWithError(err.message);
  }
});

// POST /tools/list — discover tools from MCP
router.post('/tools/list', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated — click Sign In with Privilege.' });
    await ensureMcpSessionInitialized(session);
    const rpc = { jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} };
    let data;
    try {
      data = await fetchMcp(session, null, rpc, true);
    } catch (err) {
      if (err.message.includes('invalid during session initialization')) {
        session.mcpSession.initialized = false;
        await ensureMcpSessionInitialized(session);
        data = await fetchMcp(session, null, rpc, true);
      } else throw err;
    }
    session.tools = data.result?.tools || [];
    res.json({ tools: session.tools });
  } catch (err) {
    resetMcpState(session);
    emitEvent(session, 'error', { scope: 'tools_list', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// POST /tools/call — invoke a single tool
router.post('/tools/call', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    await ensureMcpSessionInitialized(session);
    const { name, arguments: args } = req.body || {};
    const rpc = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } };
    const data = await fetchMcp(session, null, rpc, true);
    res.json(data);
  } catch (err) {
    emitEvent(session, 'error', { scope: 'tools_call', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// POST /rpc — raw MCP JSON-RPC passthrough
router.post('/rpc', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken) return res.status(401).json({ error: 'Not authenticated.' });
    const body = req.body || {};
    const method = body?.method || '';
    if (method && method !== 'initialize' && method !== 'notifications/initialized') {
      await ensureMcpSessionInitialized(session);
    }
    const data = await fetchMcp(session, null, body, true);
    res.json(data);
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('502')) resetMcpState(session);
    emitEvent(session, 'error', { scope: 'raw_rpc', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// POST /auth/logout — clear the Privilege OAuth tokens for this session
router.post('/auth/logout', (req, res) => {
  const session = getClientSession(req);
  session.oauth.accessToken = null;
  session.oauth.refreshToken = null;
  session.oauth.expiresAt = null;
  session.oauth.tokenUri = null;
  session.oauth.scope = '';
  resetMcpState(session);
  emitEvent(session, 'oauth', { phase: 'logout' });
  res.json({ ok: true });
});

// POST /chat — demo chat with optional LLM routing
router.post('/chat', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    const prompt = req.body?.prompt || '';
    const steps = [];

    if (!session.config.mcpUrl) {
      return res.status(400).json({ error: 'Set MCP URL first.', steps });
    }
    if (!session.config.clientId) {
      return res.json({ reply: 'OAuth Client ID is missing. Set Client ID and click Sign In.', steps: ['missing_client_id'] });
    }
    if (!session.oauth.accessToken) {
      // Need OAuth first — build auth URL for redirect
      const { authorizationUri, tokenUri } = await discoverAuth(session);
      const verifier = randomString(48);
      const challenge = sha256Base64Url(verifier);
      const oauthState = randomString(24);
      const host = req.get('x-forwarded-host') || process.env.PRIVILEGE_MCP_CALLBACK_HOST || 'local.ping-devops.com:4000';
      const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
      const redirectUri = `${protocol}://${host}/api/privilege-mcp/auth/callback`;
      const authUrl = new URL(authorizationUri);
      authUrl.searchParams.set('client_id', session.config.clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('scope', session.config.scopes);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', oauthState);
      session.pendingAuth = { oauthState, verifier, tokenUri, redirectUri };
      return res.json({ reply: 'Please complete OAuth login first.', authUrl: authUrl.toString(), steps: ['oauth_required'] });
    }

    await ensureMcpSessionInitialized(session);
    steps.push('mcp_initialized');

    const toolsResponse = await fetchMcp(session, null, { jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} }, true);
    session.tools = toolsResponse.result?.tools || [];
    steps.push(`tools_discovered:${session.tools.length}`);

    let reply = `Connected. I found ${session.tools.length} tools.`;
    let suggestions = session.tools.map((t) => ({ name: t.name, why: 'Discovered from MCP server.', arguments: {} }));

    // Optional LLM routing (Ollama)
    if (session.config.llmUrl && session.config.llmModel) {
      try {
        const llmResponse = await fetch(`${session.config.llmUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: session.config.llmModel,
            stream: false,
            messages: [
              { role: 'system', content: 'You are an MCP tool router. Given a user prompt and tools, return JSON: {"reply":"...","suggested_tools":[{"name":"tool_name","why":"...","arguments":{}}]}. Use only tool names from the list.' },
              { role: 'user', content: `User prompt:\n${prompt}\n\nAvailable tools:\n${JSON.stringify(session.tools.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} })), null, 2)}` },
            ],
          }),
        });
        if (llmResponse.ok) {
          const llmData = await llmResponse.json();
          const raw = llmData.message?.content || llmData.response || '';
          const parsed = parseLlmJson(raw);
          if (parsed.reply) reply = parsed.reply;
          if (Array.isArray(parsed.suggested_tools)) suggestions = parsed.suggested_tools;
          steps.push('llm_routed');
        }
      } catch (llmErr) {
        steps.push(`llm_fallback:${llmErr.message}`);
      }
    }

    res.json({
      reply,
      tools: session.tools.map((t) => ({ name: t.name, description: t.description || '' })),
      suggested_tools: suggestions,
      steps,
    });
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('502')) resetMcpState(session);
    emitEvent(session, 'error', { scope: 'demo_chat', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

function parseLlmJson(raw) {
  if (!raw) return {};
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ } }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* continue */ } }
  return {};
}

// ---------------------------------------------------------------------------
// pingone.env settings (ping-mcpgw/config/pingone.env)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const PINGONE_ENV_PATH = process.env.MCPGW_CONFIG_PATH
  ? path.join(process.env.MCPGW_CONFIG_PATH, 'pingone.env')
  : path.resolve(__dirname, '../../ping-mcpgw/config/pingone.env');

function parseDotenv(text) {
  const vars = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return vars;
}

function serializeDotenv(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

const PINGONE_ENV_ALLOWED_KEYS = [
  'SERVER_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_AUTH_URL',
  'OIDC_TOKEN_URL',
  'OIDC_USER_URL',
  'OIDC_SCOPES',
];

/**
 * Gate for /env — returns OIDC_CLIENT_SECRET and can rewrite gateway OIDC
 * credentials. Session-cookie admin only (the page uses credentials:include,
 * not Bearer). Unauthenticated callers must not read or write this file.
 */
function requireAdminSession(req, res, next) {
  const isAdmin = req.session?.user?.role === 'admin' || req.session?.isAdmin === true;
  if (!isAdmin) {
    return res.status(401).json({
      error: 'admin_required',
      message: 'Admin session required to read or write Privilege gateway env.',
    });
  }
  return next();
}

function readExistingEnvVars() {
  try {
    return parseDotenv(fs.readFileSync(PINGONE_ENV_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

router.get('/env', requireAdminSession, (req, res) => {
  try {
    res.json({ ok: true, vars: readExistingEnvVars() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/env', express.json(), requireAdminSession, (req, res) => {
  try {
    const vars = req.body?.vars;
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
      return res.status(400).json({ error: 'vars object required' });
    }
    // Merge onto the existing file so a partial body cannot wipe secrets.
    const existing = readExistingEnvVars();
    const filtered = {};
    for (const key of PINGONE_ENV_ALLOWED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(existing, key)) {
        filtered[key] = String(existing[key]);
      }
    }
    for (const key of PINGONE_ENV_ALLOWED_KEYS) {
      if (vars[key] !== undefined) filtered[key] = String(vars[key]);
    }
    fs.mkdirSync(path.dirname(PINGONE_ENV_PATH), { recursive: true });
    fs.writeFileSync(PINGONE_ENV_PATH, serializeDotenv(filtered), 'utf8');
    res.json({ ok: true, vars: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

/** Test hooks — session-scoped SSE isolation canary. */
module.exports.__test = {
  emitEvent,
  getClientSession,
  /** @param {string} sid @param {{ write: Function }} res */
  subscribeSse(sid, res) {
    let clients = sseClients.get(sid);
    if (!clients) {
      clients = new Set();
      sseClients.set(sid, clients);
    }
    clients.add(res);
    return () => {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(sid);
    };
  },
  reset() {
    clientSessions.clear();
    sseClients.clear();
  },
};
