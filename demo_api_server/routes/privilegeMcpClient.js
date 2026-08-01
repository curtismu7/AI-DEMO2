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
  // Use the main app's PingOne token directly — Privilege Gateway validates it
  const mainToken = req.session?.oauthTokens?.accessToken;
  if (mainToken) {
    session.oauth.accessToken = mainToken;
    session.oauth.expiresAt = req.session.oauthTokens.expiresAt || null;
    session.oauth.refreshToken = req.session.oauthTokens.refreshToken || null;
    session.oauth.scope = req.session.oauthTokens.scope || '';
  }
  return session;
}



// ---------------------------------------------------------------------------
// SSE event stream for live relay
// ---------------------------------------------------------------------------
const sseClients = new Set();

function emitEvent(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });
  res.write('\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
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
    emitEvent('oauth', { phase: 'refresh_failed', error: err.message });
    return false;
  }

  if (!response.ok || !data.access_token) {
    session.oauth.accessToken = null;
    session.oauth.refreshToken = null;
    session.oauth.expiresAt = null;
    emitEvent('oauth', { phase: 'refresh_failed', status: response.status });
    return false;
  }

  session.oauth.accessToken = data.access_token;
  // PingOne rotates refresh tokens when replay protection is on — keep the newest
  if (data.refresh_token) session.oauth.refreshToken = data.refresh_token;
  session.oauth.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
  if (data.scope) session.oauth.scope = data.scope;
  emitEvent('oauth', { phase: 'refresh_success', expiresIn: data.expires_in || null });
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
  }
  if (session.mcpSession.sessionId) {
    headers['MCP-Session-Id'] = session.mcpSession.sessionId;
  }
  // Privilege Cloud requires x-procyon-session-id on every request
  if (targetUrl.hostname === 'privilege.pingone.com' || targetUrl.hostname.endsWith('.applications.privilege.pingone.com')) {
    headers['x-procyon-session-id'] = session.config._procyonSessionId ||
      (session.config._procyonSessionId = crypto.randomUUID());
    // Privilege Cloud requires protocol version header on non-initialize requests
    if (body?.method && body.method !== 'initialize') {
      headers['mcp-protocol-version'] = session.mcpSession.protocolVersion || '2024-11-05';
    }
  }

  emitEvent('relay', { direction: 'client->mcp', method: 'POST', url: targetUrl.toString(), body });

  const response = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  const parsed = decodeMcpBody(text);

  const responseSessionId = response.headers.get('mcp-session-id') || response.headers.get('MCP-Session-Id');
  if (responseSessionId && responseSessionId !== session.mcpSession.sessionId) {
    session.mcpSession.sessionId = responseSessionId;
    emitEvent('mcp', { phase: 'session_attached', sessionId: responseSessionId });
  }

  emitEvent('relay', {
    direction: 'mcp->client',
    status: response.status,
    headers: { 'www-authenticate': response.headers.get('www-authenticate'), 'mcp-session-id': responseSessionId },
    body: parsed,
  });

  if (!response.ok) {
    if (response.status === 401 && withAuth && allowRefreshRetry && await refreshAccessToken(session)) {
      return fetchMcp(session, pathname, body, withAuth, false);
    }
    throw new Error(normalizeMcpFailure(response.status, text));
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
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'MCP Privilege Demo Client', version: '1.0.0' },
    },
  };
  const initResponse = await fetchMcp(session, null, initRpc, true);
  const serverProtocol = initResponse?.result?.protocolVersion || '2025-11-25';

  await fetchMcp(session, null, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, true);

  session.mcpSession.initialized = true;
  session.mcpSession.protocolVersion = serverProtocol;
  emitEvent('mcp', { phase: 'initialized', protocolVersion: serverProtocol });
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
  const response = await fetch(session.config.mcpUrl, { method: 'GET', headers: discoverHeaders });
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = {}; }

  const authHeader = response.headers.get('www-authenticate') || '';
  const authUriMatch = authHeader.match(/authorization_uri="([^"]+)"/);
  const authorizationUri = body.authorization_uri || (authUriMatch ? authUriMatch[1] : null);
  const tokenUri = body.token_uri || null;

  if (authorizationUri && tokenUri) return { authorizationUri, tokenUri };

  // PingOne OIDC discovery fallback
  try {
    const mcpUrl = new URL(session.config.mcpUrl);
    const envMatch = mcpUrl.pathname.match(/\/v1\/environments\/([0-9a-fA-F-]{36})\/mcp\/?$/);
    let envId = envMatch?.[1];
    // Privilege Cloud authenticates via its own SSO PingOne environment
    if (!envId && (mcpUrl.hostname === 'privilege.pingone.com' || mcpUrl.hostname.endsWith('.applications.privilege.pingone.com'))) {
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

  throw new Error(`Failed to discover OAuth metadata from MCP URL. status=${response.status}`);
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

// POST /config — save config
router.post('/config', express.json(), (req, res) => {
  const session = getClientSession(req);
  session.config = { ...session.config, ...req.body };
  resetMcpState(session);
  emitEvent('config', { config: session.config });
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

    session.pendingAuth = { oauthState, verifier, tokenUri, redirectUri };
    // Force express-session to persist so connect.sid cookie survives the redirect
    req.session.privilegeOAuthStarted = true;
    emitEvent('oauth', { phase: 'start', authorizationUri, tokenUri, authUrl: authUrl.toString() });
    res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    emitEvent('error', { scope: 'oauth_start', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/callback — OAuth code exchange
router.get('/auth/callback', async (req, res) => {
  const session = getClientSession(req);
  const redirectWithError = (reason) => {
    const safeReason = encodeURIComponent((reason || 'OAuth callback failed').slice(0, 300));
    res.redirect(`/privilege-mcp-client?auth=error&reason=${safeReason}`);
  };

  try {
    const { code, state: incomingState, error, error_description } = req.query;
    if (error) {
      const reason = error_description ? `${error}: ${error_description}` : error;
      emitEvent('oauth', { phase: 'callback_error', error: reason });
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
    // PingOne app uses client_secret_post — always send credentials in the body
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

    emitEvent('oauth', { phase: 'token_success', expiresIn: tokenData.expires_in || null });
    res.redirect('/privilege-mcp-client?auth=success');
  } catch (err) {
    emitEvent('error', { scope: 'oauth_callback', message: err.message });
    redirectWithError(err.message);
  }
});

// POST /tools/list — discover tools from MCP
router.post('/tools/list', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
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
    emitEvent('error', { scope: 'tools_list', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /tools/call — invoke a single tool
router.post('/tools/call', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    await ensureMcpSessionInitialized(session);
    const { name, arguments: args } = req.body || {};
    const rpc = { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args || {} } };
    const data = await fetchMcp(session, null, rpc, true);
    res.json(data);
  } catch (err) {
    emitEvent('error', { scope: 'tools_call', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /rpc — raw MCP JSON-RPC passthrough
router.post('/rpc', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    const body = req.body || {};
    const method = body?.method || '';
    if (method && method !== 'initialize' && method !== 'notifications/initialized') {
      await ensureMcpSessionInitialized(session);
    }
    const data = await fetchMcp(session, null, body, true);
    res.json(data);
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('502')) resetMcpState(session);
    emitEvent('error', { scope: 'raw_rpc', message: err.message });
    res.status(500).json({ error: err.message });
  }
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
    emitEvent('error', { scope: 'demo_chat', message: err.message });
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

module.exports = router;
