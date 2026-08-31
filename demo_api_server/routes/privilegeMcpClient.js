// demo_api_server/routes/privilegeMcpClient.js
// BFF relay for the Privilege MCP Client page — handles OAuth PKCE flow,
// MCP JSON-RPC relay (initialize, tools/list, tools/call), and SSE events.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const DEFAULT_AGENTLESS_MCP_URL =
  'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp';
const DEFAULT_AGENT_MCP_URL =
  'https://opensearch.default.applications.procyon.ai:8643/mcp';
// The `audit` façade door, NOT Privilege — that route was abandoned once the
// hosted PingOne MCP stopped accepting worker client_credentials (401 "Invalid
// authentication", 2026-08-27).
//
// The door's upstream is the shared Agent Gateway, so what narrows this to the
// three audit tools is the door's advertised scope: it serves
// scopes_supported: ['audit:read'], the relay's OAuth asks for only that, and
// the gateway filters tools/list to what the token permits. Point this at the
// gateway directly and the page gets the full banking surface instead.
//
// Plain-HTTP façade port (MCP_FACADE_HTTP_PORT=3002) rather than :3001 — the
// relay calls this server-side, and the HTTPS listener uses mkcert certs that a
// self-call would have to be told to trust.
const DEFAULT_AUDIT_MCP_URL =
  'http://localhost:3002/mcp-facade/audit/mcp';
const MCP_PROTOCOL_VERSION = '2026-07-28';
const LEGACY_MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = { name: 'PingOne Privilege MCP Client', version: '2.0.0' };
const MCP_CLIENT_CAPABILITIES = {
  elicitation: { form: {}, url: {} },
  extensions: { 'io.modelcontextprotocol/tasks': {} },
};
// How long a POST may hang while the eventStream GET is open before fetchMcp
// assumes this gateway can't handle the two concurrently and falls back.
// See openMcpEventStream's doc comment. Overridable so tests can use a short
// real wait instead of faking timers (which fights supertest's own sockets).
const EVENT_STREAM_GUARD_TIMEOUT_MS =
  Number(process.env.PRIVILEGE_EVENT_STREAM_GUARD_TIMEOUT_MS) || 8000;

// ---------------------------------------------------------------------------
// In-memory per-session state (keyed by express session id)
// ---------------------------------------------------------------------------
const clientSessions = new Map();

function getClientSession(req) {
  const sid = req.sessionID || req.session?.id || 'default';
  if (!clientSessions.has(sid)) {
    const agentlessConfig = {
      mcpUrl: process.env.PRIVILEGE_AGENTLESS_MCPGW_URL
        || process.env.PRIVILEGE_MCPGW_URL
        || DEFAULT_AGENTLESS_MCP_URL,
      clientId: process.env.PRIVILEGE_SSO_CLIENT_ID || process.env.PINGONE_MCP_GATEWAY_CLIENT_ID || '',
      scopes: 'openid profile email',
    };
    const agentConfig = {
      mcpUrl: process.env.PRIVILEGE_AGENT_MCPGW_URL
        || DEFAULT_AGENT_MCP_URL,
    };
    clientSessions.set(sid, {
      _sid: sid,
      config: {
        ...agentlessConfig,
        llmUrl: 'http://127.0.0.1:11434',
        llmModel: 'llama3.2:1b',
      },
      gatewayMode: 'agentless',
      gatewayConfigs: { agent: agentConfig, agentless: agentlessConfig },
      oauth: {
         accessToken: null, refreshToken: null, expiresAt: null, tokenUri: null, source: null,

        // Set when login went through a self-advertising gateway (MCPGW acting as
        // its own AS) via Dynamic Client Registration — refreshAccessToken must
        // reuse this client, not the PingOne app id, or the token endpoint 400s.
        dcrClientId: null, dcrClientSecret: null,
      },
      tools: [],
      toolPolicy: { permitted: [], filtered: [], total: 0 },
      mcpSession: {
        era: null, initialized: false, protocolVersion: null, sessionId: null,
        nextRequestId: 1, capabilities: {}, serverInfo: null, instructions: '',
      },
      subscription: { controller: null, active: false },
      // Spec-standard Streamable HTTP persistent GET stream (distinct from the
      // subscriptions/listen POST-stream above, which is a different, existing
      // feature). Opened best-effort after initialize; some gateway proxies
      // hang a concurrent POST while this is open (see
      // privilege/AGENTLESS-CONFIGURATION.md's "2026-08-24" section) —
      // fetchMcp's timeout race auto-disables it per session on first hang,
      // permanently falling back to the always-safe POST-only pattern this
      // file used exclusively before tonight.
      eventStream: { controller: null, active: false, disabled: false },
      pendingAuth: null,
    });
  }
  const session = clientSessions.get(sid);
  session._sid = sid;
  const appAccessToken = req.session?.oauthTokens?.accessToken;
  if (appAccessToken && appAccessToken !== '_cookie_session' && !session.oauth.accessToken) {
    session.oauth.accessToken = appAccessToken;
    session.oauth.refreshToken = null;
    session.oauth.expiresAt = null;
    session.oauth.tokenUri = null;
    session.oauth.dcrClientId = null;
    session.oauth.dcrClientSecret = null;
    session.oauth.source = 'main_app_session';
  }
  // Allow MCP clients that already hold a PingOne token to pass it directly
  // via Authorization: Bearer instead of going through the /auth/login flow.
  // Clear refresh metadata when seeding: keeping a prior browser-OAuth
  // refreshToken/expiresAt/tokenUri would let accessTokenExpiring() or a 401
  // retry silently replace this Bearer with another identity's access token.
  const auth = req.headers?.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(\S+)/i);
    if (match) {
      session.oauth.accessToken = match[1];
      session.oauth.refreshToken = null;
      session.oauth.expiresAt = null;
      session.oauth.tokenUri = null;
      session.oauth.dcrClientId = null;
      session.oauth.dcrClientSecret = null;
    }
  }
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
// Agent-based AI Gateway frontends (*.applications.procyon.ai)
// The workstation's Priv Agent resolves these names to its local listener and
// injects the device-bound identity itself, so requests must carry no
// Authorization header and need no Privilege SSO sign-in. Inside Docker the
// agent's DNS proxy is invisible — dial host.docker.internal instead — and the
// listener serves a procyon TenantRoot chain no CA store trusts.
// ---------------------------------------------------------------------------
function isProcyonAgentUrl(url) {
  try {
    return new URL(url).hostname.endsWith('.applications.procyon.ai');
  } catch {
    return false;
  }
}

let procyonDispatcher = null;
function getProcyonDispatcher() {
  if (!procyonDispatcher) {
    const dns = require('dns');
    const { Agent } = require('undici');
    procyonDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
        lookup(hostname, options, cb) {
          // Docker: reach the host's Priv Agent listener via host.docker.internal.
          // Native: that name doesn't resolve — fall back to the OS resolver,
          // which the agent's DNS proxy answers with 127.0.0.1.
          dns.lookup('host.docker.internal', options, (err, ...rest) => {
            if (err) return dns.lookup(hostname, options, cb);
            cb(null, ...rest);
          });
        },
      },
    });
  }
  return procyonDispatcher;
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

function encodeMcpHeaderValue(value) {
  const text = String(value);
  const plainAscii = /^[\x20-\x7e]+$/.test(text)
    && text.trim() === text
    && !(text.startsWith('=?base64?') && text.endsWith('?='));
  return plainAscii ? text : `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function modernRequestBody(body, protocolVersion = MCP_PROTOCOL_VERSION) {
  if (!body?.method) return body;
  return {
    ...body,
    params: {
      ...(body.params || {}),
      _meta: {
        ...(body.params?._meta || {}),
        'io.modelcontextprotocol/protocolVersion': protocolVersion,
        'io.modelcontextprotocol/clientInfo': MCP_CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': MCP_CLIENT_CAPABILITIES,
      },
    },
  };
}

function findTool(session, name) {
  return session.tools.find((tool) => tool.name === name);
}

function readArgumentAtPath(argumentsValue, path) {
  return path.split('.').reduce((value, part) => value?.[part], argumentsValue);
}

function addModernHeaders(headers, session, body) {
  headers['MCP-Protocol-Version'] = session.mcpSession.protocolVersion || MCP_PROTOCOL_VERSION;
  headers['Mcp-Method'] = body.method;
  if (['tools/call', 'prompts/get', 'resources/read'].includes(body.method)) {
    const name = body.params?.name ?? body.params?.uri;
    if (name !== undefined) headers['Mcp-Name'] = encodeMcpHeaderValue(name);
  }
  if (body.method !== 'tools/call') return;
  const schema = findTool(session, body.params?.name)?.inputSchema;
  for (const [propertyName, property] of Object.entries(schema?.properties || {})) {
    const headerName = property?.['x-mcp-header'];
    if (!headerName) continue;
    const value = readArgumentAtPath(body.params?.arguments || {}, propertyName);
    if (value === undefined || value === null) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    headers[`Mcp-Param-${headerName}`] = encodeMcpHeaderValue(value);
  }
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

function nextMcpRequestId(session) {
  const id = session.mcpSession.nextRequestId;
  session.mcpSession.nextRequestId += 1;
  return id;
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
    client_id: session.oauth.dcrClientId || session.config.clientId,
  });
  const clientSecret = session.oauth.dcrClientSecret
    || process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || '';
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

  // The Priv Agent is the identity on procyon frontends — never attach or
  // refresh a Privilege SSO bearer there.
  const procyon = isProcyonAgentUrl(session.config.mcpUrl);
  if (procyon) withAuth = false;

  if (withAuth && accessTokenExpiring(session)) {
    await refreshAccessToken(session);
  }

  const targetUrl = new URL(session.config.mcpUrl);
  if (pathname) targetUrl.pathname = pathname;

  const requestBody = session.mcpSession.era === 'modern'
    ? modernRequestBody(body, session.mcpSession.protocolVersion || MCP_PROTOCOL_VERSION)
    : body;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Origin: targetUrl.origin,
  };
  if (withAuth && session.oauth.accessToken) {
    headers.Authorization = `Bearer ${session.oauth.accessToken}`;
    // Debug: decode token claims
    try {
      const payload = JSON.parse(Buffer.from(session.oauth.accessToken.split('.')[1], 'base64url').toString());
      console.log('[privilege-mcp] Token sub:', payload.sub, 'aud:', payload.aud, 'scope:', payload.scope);
    } catch {}
  }
  if (session.mcpSession.era === 'legacy' && session.mcpSession.sessionId) {
    headers['MCP-Session-Id'] = session.mcpSession.sessionId;
  }
  // Privilege Cloud requires x-procyon-session-id on every request
  if (targetUrl.hostname === 'privilege.pingone.com' || targetUrl.hostname.endsWith('.applications.privilege.pingone.com')) {
    if (!session.config._procyonSessionId) session.config._procyonSessionId = crypto.randomUUID();
    headers['x-procyon-session-id'] = session.config._procyonSessionId;
  }
  if (session.mcpSession.era === 'modern' && requestBody?.method) {
    addModernHeaders(headers, session, requestBody);
  } else if (requestBody?.method && requestBody.method !== 'initialize') {
    headers['MCP-Protocol-Version'] = session.mcpSession.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION;
  }

  emitEvent(session, 'relay', { direction: 'client->mcp', method: 'POST', url: targetUrl.toString(), body: requestBody });

  // Some gateway proxies hang a POST that arrives while this session's
  // eventStream GET is held open (see AGENTLESS-CONFIGURATION.md's
  // "2026-08-24" section). Race a timeout only when that stream is actually
  // active — every other call is completely unaffected by this block.
  const streamGuardActive = session.eventStream.active;
  const abortController = streamGuardActive ? new AbortController() : null;
  const fetchPromise = fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    ...(abortController ? { signal: abortController.signal } : {}),
    ...(procyon ? { dispatcher: getProcyonDispatcher() } : {}),
  });
  let response;
  if (streamGuardActive) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('EVENT_STREAM_GUARD_TIMEOUT')), EVENT_STREAM_GUARD_TIMEOUT_MS);
    });
    try {
      response = await Promise.race([fetchPromise, timeout]);
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message !== 'EVENT_STREAM_GUARD_TIMEOUT') throw err;
      abortController.abort();
      disableMcpEventStream(session);
      // Retry the identical call now that the stream is closed — this is
      // the always-safe POST-only pattern every call used before tonight.
      return fetchMcp(session, pathname, body, withAuth, allowRefreshRetry);
    }
  } else {
    response = await fetchPromise;
  }
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
    const err = mcpRelayError(response.status, text);
    err.rpcError = parsed?.error || null;
    throw err;
  }
  if (parsed?.error) {
    throw new Error(`MCP RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  if (requestBody?.id !== undefined && parsed?.id !== requestBody.id) {
    throw new Error(`MCP response id mismatch: expected ${requestBody.id}, received ${parsed?.id ?? 'none'}`);
  }
  return parsed;
}

async function ensureMcpSessionInitialized(session) {
  if (session.mcpSession.initialized) return;

  if (!session.mcpSession.era) {
    session.mcpSession.era = 'modern';
    session.mcpSession.protocolVersion = MCP_PROTOCOL_VERSION;
    const discoverRpc = {
      jsonrpc: '2.0', id: nextMcpRequestId(session), method: 'server/discover', params: {},
    };
    try {
      const discovery = await fetchMcp(session, null, discoverRpc, true);
      const result = discovery?.result || {};
      const supported = result.supportedVersions || [];
      if (supported.length && !supported.includes(MCP_PROTOCOL_VERSION)) {
        throw new Error(`MCP server does not support ${MCP_PROTOCOL_VERSION}; supported versions: ${supported.join(', ')}.`);
      }
      session.mcpSession.capabilities = result.capabilities || {};
      session.mcpSession.serverInfo = result._meta?.['io.modelcontextprotocol/serverInfo'] || null;
      session.mcpSession.instructions = result.instructions || '';
      session.mcpSession.initialized = true;
      emitEvent(session, 'mcp', { phase: 'discovered', era: 'modern', protocolVersion: MCP_PROTOCOL_VERSION });
      return;
    } catch (err) {
      const modernError = [-32020, -32021, -32022].includes(err.rpcError?.code)
        || (err.upstreamStatus === 404 && err.rpcError?.code === -32601);
      if (modernError) throw err;
      if (![400, 404, 405].includes(err.upstreamStatus)) throw err;
      session.mcpSession.era = 'legacy';
      session.mcpSession.protocolVersion = null;
      session.mcpSession.nextRequestId = 1;
    }
  }

  const initRpc = {
    jsonrpc: '2.0',
    id: nextMcpRequestId(session),
    method: 'initialize',
    params: {
      protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
      capabilities: MCP_CLIENT_CAPABILITIES,
      clientInfo: MCP_CLIENT_INFO,
    },
  };
  const initResponse = await fetchMcp(session, null, initRpc, true);
  const serverProtocol = initResponse?.result?.protocolVersion;
  if (!serverProtocol) throw new Error('MCP initialize response did not include a protocolVersion.');
  session.mcpSession.protocolVersion = serverProtocol;
  session.mcpSession.capabilities = initResponse?.result?.capabilities || {};
  session.mcpSession.serverInfo = initResponse?.result?.serverInfo || null;
  session.mcpSession.instructions = initResponse?.result?.instructions || '';

  await fetchMcp(session, null, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, true);

  session.mcpSession.initialized = true;
  emitEvent(session, 'mcp', { phase: 'initialized', protocolVersion: serverProtocol });
  // Fire-and-forget — never blocks the calls that follow. See
  // openMcpEventStream's own doc comment for why this exists.
  void openMcpEventStream(session);
}

function resetMcpState(session) {
  session.subscription.controller?.abort();
  session.subscription = { controller: null, active: false };
  session.eventStream.controller?.abort();
  session.eventStream = { controller: null, active: false, disabled: false };
  session.tools = [];
  session.toolPolicy = { permitted: [], filtered: [], total: 0 };
  session.mcpSession.era = null;
  session.mcpSession.initialized = false;
  session.mcpSession.protocolVersion = null;
  session.mcpSession.sessionId = null;
  session.mcpSession.nextRequestId = 1;
  session.mcpSession.capabilities = {};
  session.mcpSession.serverInfo = null;
  session.mcpSession.instructions = '';
}

/**
 * Best-effort: open the persistent GET /mcp SSE stream Streamable HTTP
 * allows a client to hold alongside POSTs — the shape real MCP clients like
 * MCP Inspector use, which our own POST-only fetchMcp never exercised before
 * tonight. Failure here is never fatal: a rejected/errored open just leaves
 * eventStream inactive and every call proceeds exactly as before.
 */
async function openMcpEventStream(session) {
  if (session.eventStream.disabled || session.eventStream.active) return;
  if (!session.mcpSession.sessionId) return;
  const targetUrl = new URL(session.config.mcpUrl);
  const headers = {
    Accept: 'text/event-stream',
    'MCP-Session-Id': session.mcpSession.sessionId,
    'MCP-Protocol-Version': session.mcpSession.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION,
    Origin: targetUrl.origin,
  };
  const procyon = isProcyonAgentUrl(session.config.mcpUrl);
  if (!procyon && session.oauth.accessToken) headers.Authorization = `Bearer ${session.oauth.accessToken}`;
  const controller = new AbortController();
  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET', headers, signal: controller.signal,
      ...(procyon ? { dispatcher: getProcyonDispatcher() } : {}),
    });
  } catch (err) {
    emitEvent(session, 'mcp', { phase: 'event_stream_open_failed', message: err.message });
    return;
  }
  if (!response.ok || !response.body?.getReader) {
    controller.abort();
    return;
  }
  session.eventStream = { controller, active: true, disabled: false };
  emitEvent(session, 'mcp', { phase: 'event_stream_opened' });
  const reader = response.body.getReader();
  void (async () => {
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // Aborted by disableMcpEventStream, or the connection dropped — either
      // way this is not fatal, fetchMcp already fell back to POST-only.
    } finally {
      if (session.eventStream.controller === controller) {
        session.eventStream = { controller: null, active: false, disabled: session.eventStream.disabled };
      }
      emitEvent(session, 'mcp', { phase: 'event_stream_closed' });
    }
  })();
}

/**
 * Permanently (for this session) stop opening the GET event stream, after
 * fetchMcp's timeout race catches a hung concurrent POST — see
 * privilege/AGENTLESS-CONFIGURATION.md's "2026-08-24" section for why some
 * gateway proxies hit this. Falls back to the POST-only pattern that worked
 * for every Privilege call before tonight.
 */
function disableMcpEventStream(session) {
  session.eventStream.controller?.abort();
  session.eventStream = { controller: null, active: false, disabled: true };
  emitEvent(session, 'mcp', { phase: 'event_stream_disabled', reason: 'concurrent_request_timeout' });
}

async function startModernSubscription(session, types) {
  await ensureMcpSessionInitialized(session);
  if (session.mcpSession.era !== 'modern') {
    throw new Error('subscriptions/listen requires MCP 2026-07-28.');
  }
  session.subscription.controller?.abort();
  const controller = new AbortController();
  const rpc = modernRequestBody({
    jsonrpc: '2.0', id: nextMcpRequestId(session), method: 'subscriptions/listen',
    params: { types },
  }, session.mcpSession.protocolVersion);
  const targetUrl = new URL(session.config.mcpUrl);
  const headers = {
    'Content-Type': 'application/json', Accept: 'text/event-stream', Origin: targetUrl.origin,
  };
  addModernHeaders(headers, session, rpc);
  const procyon = isProcyonAgentUrl(session.config.mcpUrl);
  if (!procyon && session.oauth.accessToken) headers.Authorization = `Bearer ${session.oauth.accessToken}`;
  const response = await fetch(targetUrl, {
    method: 'POST', headers, body: JSON.stringify(rpc), signal: controller.signal,
    ...(procyon ? { dispatcher: getProcyonDispatcher() } : {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw mcpRelayError(response.status, text);
  }
  if (!response.body?.getReader) throw new Error('MCP subscription response is not streamable.');
  session.subscription = { controller, active: true };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const data = frame.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim()).join('\n');
          if (!data) continue;
          let message;
          try { message = JSON.parse(data); } catch { message = { raw: data }; }
          emitEvent(session, 'subscription', { message });
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') emitEvent(session, 'error', { scope: 'subscription', message: err.message });
    } finally {
      if (session.subscription.controller === controller) {
        session.subscription = { controller: null, active: false };
      }
      emitEvent(session, 'subscription', { phase: 'closed' });
    }
  })();
}

function isExpiredMcpSessionError(err) {
  return err.message.includes('invalid during session initialization')
    || err.message.includes('Unknown or expired MCP-Session-Id');
}

async function callMcp(session, method, params = {}) {
  await ensureMcpSessionInitialized(session);
  const rpc = { jsonrpc: '2.0', id: nextMcpRequestId(session), method, params };
  try {
    return await fetchMcp(session, null, rpc, true);
  } catch (err) {
    if (session.mcpSession.era !== 'legacy' || !isExpiredMcpSessionError(err)) throw err;
    resetMcpState(session);
    await ensureMcpSessionInitialized(session);
    rpc.id = nextMcpRequestId(session);
    return fetchMcp(session, null, rpc, true);
  }
}

// Both pagination loops below page through an operator-configured MCP
// endpoint (PRIVILEGE_AGENTLESS_MCPGW_URL / PRIVILEGE_AGENT_MCPGW_URL, no
// allowlist restricting it to a fixed trusted host) with no bound otherwise
// -- a pagination bug on that upstream (repeating a cursor, or always
// emitting a fresh nextCursor) would hang the request indefinitely.
const MAX_MCP_PAGES = 100;

async function listAllMcpPages(session, method, resultKey) {
  const items = [];
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const data = await callMcp(session, method, cursor ? { cursor } : {});
    items.push(...(data.result?.[resultKey] || []));
    cursor = data.result?.nextCursor;
    pages += 1;
    if (cursor && (seenCursors.has(cursor) || pages >= MAX_MCP_PAGES)) {
      console.warn(`[privilegeMcpClient] ${method} pagination stopped after ${pages} pages (repeated or excessive cursor)`);
      break;
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return items;
}

async function discoverPolicyTools(session) {
  const permitted = [];
  const filteredByName = new Map();
  const seenCursors = new Set();
  let cursor;
  let pages = 0;
  do {
    const data = await callMcp(session, 'tools/list', cursor ? { cursor } : {});
    const result = data.result || {};
    permitted.push(...(result.tools || []));
    for (const tool of result._meta?.deniedTools || []) {
      if (tool?.name) filteredByName.set(tool.name, tool);
    }
    cursor = result.nextCursor;
    pages += 1;
    if (cursor && (seenCursors.has(cursor) || pages >= MAX_MCP_PAGES)) {
      console.warn(`[privilegeMcpClient] tools/list pagination stopped after ${pages} pages (repeated or excessive cursor)`);
      break;
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  const filtered = [...filteredByName.values()];
  session.tools = permitted;
  session.toolPolicy = { permitted, filtered, total: permitted.length + filtered.length };
  return session.toolPolicy;
}

function publicPolicySummary(session) {
  const policy = session.toolPolicy || { permitted: session.tools || [], filtered: [], total: (session.tools || []).length };
  return {
    total: policy.total,
    permitted: policy.permitted.length,
    filtered: policy.filtered.length,
    filteredTools: policy.filtered.map((tool) => ({ name: tool.name, reason: tool.deniedReason || 'Filtered by gateway policy.' })),
  };
}

function toolMatchScore(prompt, tool) {
  const words = new Set(String(prompt).toLowerCase().match(/[a-z0-9]+/g) || []);
  const nameWords = String(tool.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const descriptionWords = String(tool.description || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return nameWords.reduce((score, word) => score + (words.has(word) ? 5 : 0), 0)
    + descriptionWords.reduce((score, word) => score + (word.length > 3 && words.has(word) ? 1 : 0), 0);
}

function bestPromptTool(prompt, tools) {
  return (tools || []).map((tool) => ({ tool, score: toolMatchScore(prompt, tool) }))
    .sort((a, b) => b.score - a.score)[0];
}

function hasAllRequiredArguments(tool, args) {
  return (tool.inputSchema?.required || []).every((name) => args?.[name] !== undefined && args[name] !== '');
}

/**
 * Rewrite a browser-facing authorization-server URL to one this process can
 * actually reach.
 *
 * The Agent Gateway's OAuth broker advertises itself as http://localhost:3005 —
 * correct for the browser, which reaches it through the published port. The BFF
 * runs in a sibling container where that port is Connection-refused, so a
 * server-side fetch of AS metadata or the token endpoint has to use the compose
 * service name instead. Without this the whole RFC 9728 path silently failed and
 * sign-in fell back to PingOne.
 *
 * Only rewrites the one origin it knows about; anything else is returned
 * untouched so an external AS (PingOne, a real gateway host) is unaffected.
 */
function toInternalAs(url) {
  const internal = process.env.MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL;
  const external = process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005';
  if (!internal) return String(url).replace(/\/$/, '');
  return String(url).replace(external.replace(/\/$/, ''), internal.replace(/\/$/, '')).replace(/\/$/, '');
}

/**
 * Is this authorization endpoint served by the demo's OWN Agent Gateway broker?
 *
 * AGENT_GATEWAY_BROKER_CLIENT_ID names a client pre-registered on that broker
 * and nowhere else. Applying it to every self-advertising AS handed the
 * Privilege agentless gateway a client_id it has never heard of — PingOne
 * Privilege answered `unknown_client` and agentless sign-in was impossible.
 * Only the broker's own doors get the pre-registered client; every other
 * self-advertising gateway keeps the DCR path, which is what Privilege's
 * mcpgw wants (POST /<app>/register returns a fresh client, verified live).
 */
function isAgentGatewayBrokerAs(uri) {
  const origins = [
    process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005',
    process.env.MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL,
  ].filter(Boolean).map((u) => { try { return new URL(u).origin; } catch { return null; } });
  try { return origins.includes(new URL(uri).origin); } catch { return false; }
}

/**
 * The inverse of toInternalAs, for the one URL the BROWSER has to follow.
 *
 * The broker builds its RFC 8414 document from the Host it was reached on, so
 * fetching that document over the internal name yields internal URLs for BOTH
 * endpoints — including authorization_endpoint. Handing that to the browser
 * sends it to http://mcp-gateway:3005, which resolves only inside the compose
 * network. Verified live: the redirect landed on an unreachable host.
 */
function toExternalAs(url) {
  const internal = process.env.MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL;
  const external = process.env.MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005';
  if (!internal) return String(url).replace(/\/$/, '');
  return String(url).replace(internal.replace(/\/$/, ''), external.replace(/\/$/, '')).replace(/\/$/, '');
}

/**
 * RFC 9728 -> RFC 8414 discovery for an MCP resource that advertises a
 * protected-resource document.
 *
 * Elicits the challenge with a POST, not a GET: the mcp-facade doors answer GET
 * with 405 and no WWW-Authenticate, so a GET probe learns nothing. We follow the
 * `resource_metadata` pointer the challenge gives rather than guessing a
 * well-known path, because the façade serves it nested under the door
 * (/mcp-facade/<door>/.well-known/...), not at the RFC's host-root location.
 *
 * Returns null — never throws for a resource that simply isn't this shape — so
 * the caller falls through to its existing branches unchanged.
 *
 * @returns {Promise<null | {authorizationUri: string, tokenUri: string, issuer: string,
 *   selfAdvertised: true, advertisedScopes: string[] }>}
 */
async function discoverProtectedResource(mcpUrl, headers = {}) {
  const probe = await fetch(mcpUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'discovery', method: 'tools/list', params: {} }),
  });
  if (probe.status !== 401) return null;

  const challenge = probe.headers.get('www-authenticate') || '';
  const metaUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  if (!metaUrl) return null;

  const metaRes = await fetch(metaUrl, { method: 'GET' });
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const asUrl = Array.isArray(meta.authorization_servers) ? meta.authorization_servers[0] : null;
  if (!asUrl) return null;

  // The AS is advertised for the BROWSER (a published localhost port). This code
  // runs inside the BFF container, where that port is Connection-refused — the
  // gateway is a sibling container. So metadata is fetched over the internal
  // name while the authorize URL handed back stays browser-reachable.
  const asMetaRes = await fetch(`${toInternalAs(asUrl)}/.well-known/oauth-authorization-server`, { method: 'GET' });
  if (!asMetaRes.ok) return null;
  const asMeta = await asMetaRes.json();
  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) return null;

  return {
    // Browser-facing: force back to the published origin. The document we just
    // read was generated from the internal Host, so this field arrives internal
    // too — handing it straight to the browser sends it somewhere only the
    // compose network can resolve.
    authorizationUri: toExternalAs(asMeta.authorization_endpoint),
    // Server-facing: the relay POSTs the code exchange itself, so this one has
    // to resolve from inside the container.
    tokenUri: toInternalAs(asMeta.token_endpoint),
    issuer: asMeta.issuer || new URL(asMeta.authorization_endpoint).origin,
    // selfAdvertised drives DCR upstream: this AS keeps its own client registry,
    // so the configured PingOne client id means nothing to it.
    selfAdvertised: true,
    // The whole point of a narrow door. Without this the flow would request
    // session.config.scopes ("openid profile email") and the gateway would hand
    // back whatever that implies rather than the door's advertised scope.
    advertisedScopes: Array.isArray(meta.scopes_supported) ? meta.scopes_supported : [],
    tokenEndpointAuthMethods: Array.isArray(asMeta.token_endpoint_auth_methods_supported)
      ? asMeta.token_endpoint_auth_methods_supported
      : [],
  };
}

async function discoverAuth(session) {
  const discoverHeaders = {};
  const mcpUrlParsed = new URL(session.config.mcpUrl);
  if (mcpUrlParsed.hostname === 'privilege.pingone.com' || mcpUrlParsed.hostname.endsWith('.applications.privilege.pingone.com')) {
    if (!session.config._procyonSessionId) session.config._procyonSessionId = crypto.randomUUID();
    discoverHeaders['x-procyon-session-id'] = session.config._procyonSessionId;
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

  // selfAdvertised marks endpoints MCPGW minted for itself (RFC 9728) rather
  // than PingOne's own. MCPGW is its own Authorization Server with its own
  // client registry — a PingOne app id means nothing to it — so callers must
  // run Dynamic Client Registration before using these endpoints.
  if (authorizationUri && tokenUri) {
    return {
      authorizationUri, tokenUri, selfAdvertised: true,
      issuer: body.issuer || new URL(authorizationUri).origin,
    };
  }

  // RFC 9728 discovery — for doors that advertise a protected-resource document
  // instead of minting `authorization_uri`/`token_uri` into the body the way the
  // Privilege gateway does. The mcp-facade doors are this shape: a GET answers
  // 405 with no challenge at all, so the block above sees nothing and this used
  // to fall straight through to the PingOne branch below, signing the user in
  // with the Privilege SSO client and a token the door's AS never issued.
  try {
    const rfc9728 = await discoverProtectedResource(session.config.mcpUrl, discoverHeaders);
    if (rfc9728) return rfc9728;
  } catch (err) {
    emitEvent(session, 'oauth', { phase: 'rfc9728_skipped', error: err.message });
  }

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
          return {
            authorizationUri: meta.authorization_endpoint,
            tokenUri: meta.token_endpoint,
            issuer: meta.issuer || new URL(meta.authorization_endpoint).origin,
          };
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

// One registration per gateway origin for the life of the process — MCPGW
// mints a fresh client_id on every POST /register, so re-registering per
// login would leak a new client on the gateway each time.
const dcrClientCache = new Map();

// Dynamic Client Registration (RFC 7591) against a self-advertising gateway.
// MCPGW's own /authorize and /token don't recognize PingOne app ids — this is
// the credential they actually expect.
async function getOrRegisterDcrClient(authorizationUri, redirectUri, tokenEndpointAuthMethod = 'client_secret_post') {
  const registerUri = new URL(authorizationUri);
  registerUri.pathname = registerUri.pathname.replace(/\/authorize$/, '/register');
  const cacheKey = registerUri.toString();
  if (dcrClientCache.has(cacheKey)) return dcrClientCache.get(cacheKey);

  const response = await fetch(cacheKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'ai-demo-bff',
      application_type: 'web',
      // Must match what the AS advertises. The gateway broker supports only
      // 'none' (public + PKCE) and answers 400 to client_secret_post — which the
      // dcr_skipped catch swallowed, leaving a PingOne client id in front of an
      // AS that keeps its own registry.
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Dynamic Client Registration failed: ${response.status} ${text.slice(0, 300)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`DCR response non-JSON: ${text.slice(0, 300)}`); }
  if (!data.client_id) throw new Error('DCR response missing client_id.');

  const client = { clientId: data.client_id, clientSecret: data.client_secret || null };
  dcrClientCache.set(cacheKey, client);
  return client;
}

// Shared by /auth/start and /chat's inline re-auth path — discovers the auth
// endpoints, registers a DCR client if the gateway is self-advertising, and
// builds the PKCE authorization URL. Does not set pendingAuth.returnTo —
// callers that need it set it on the returned object's session afterward.
async function beginOAuthFlow(session, req) {
  const { authorizationUri, tokenUri, issuer, selfAdvertised, advertisedScopes, tokenEndpointAuthMethods } = await discoverAuth(session);
  const verifier = randomString(48);
  const challenge = sha256Base64Url(verifier);
  const oauthState = randomString(24);

  const host = req.get('x-forwarded-host') || process.env.PRIVILEGE_MCP_CALLBACK_HOST || 'local.ping-devops.com:4000';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  const redirectUri = `${protocol}://${host}/api/privilege-mcp/auth/callback`;

  let clientId = session.config.clientId;
  let dcrClientId = null;
  let dcrClientSecret = null;
  // A client the operator registered on the gateway broker beats DCR. The
  // broker refuses to register non-loopback redirect_uris and pins every
  // dynamic client to mcp:invoke — both deliberate, because /oauth/register is
  // unauthenticated. This relay is server-side with a non-loopback callback and
  // needs the door's own scope, so it cannot be a dynamic client at all.
  const brokerClientId = process.env.AGENT_GATEWAY_BROKER_CLIENT_ID;
  if (selfAdvertised && brokerClientId && isAgentGatewayBrokerAs(authorizationUri)) {
    clientId = brokerClientId;
    // dcrClientId is "the client this flow actually used" — the token exchange
    // reads it and falls back to session.config.clientId (the PingOne app).
    // Setting only `clientId` above authorized as ai-demo-bff-audit and then
    // exchanged as the PingOne app, which the broker rejects with
    // invalid_grant "Code was issued to a different client/redirect".
    dcrClientId = brokerClientId;
  } else if (selfAdvertised) {
    // Not every self-advertising gateway requires DCR — some already trust the
    // configured client_id. Try DCR, but a gateway that doesn't support it (no
    // /register, or a non-conforming response) must not break sign-in: fall
    // back to the configured client_id exactly as before this feature existed.
    try {
      // Registration is a server-side POST, so it needs the internal origin —
      // authorizationUri is deliberately the browser-facing one and would be
      // Connection-refused from in here, silently falling back to the configured
      // PingOne client id that this AS has never heard of.
      const dcrAuthMethod = tokenEndpointAuthMethods?.length && !tokenEndpointAuthMethods.includes('client_secret_post')
        ? tokenEndpointAuthMethods[0]
        : 'client_secret_post';
      const dcr = await getOrRegisterDcrClient(toInternalAs(authorizationUri), redirectUri, dcrAuthMethod);
      clientId = dcr.clientId;
      dcrClientId = dcr.clientId;
      dcrClientSecret = dcr.clientSecret;
    } catch (err) {
      emitEvent(session, 'oauth', { phase: 'dcr_skipped', error: err.message });
    }
  }

  const authUrl = new URL(authorizationUri);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  // A resource that advertises its own scopes wins over the session default:
  // requesting "openid profile email" at a door that exists to hand out
  // `audit:read` would defeat the narrowing the door was built for.
  const requestedScopes = advertisedScopes?.length
    ? advertisedScopes.join(' ')
    : session.config.scopes;
  authUrl.searchParams.set('scope', requestedScopes);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', oauthState);
  const loginHint = process.env.PRIVILEGE_LOGIN_HINT || req.session?.user?.email;
  if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

  // Reuse the active PingOne browser session when the main app is already logged in.
  // prompt=none tells PingOne to complete the flow silently using the existing session
  // cookie — no login page shown. Falls back to interactive on login_required.
  const promptNoneAttempted = Boolean(
    req.session?.oauthTokens?.accessToken && !req.session?.privilegePromptNoneFailed,
  );
  if (promptNoneAttempted) authUrl.searchParams.set('prompt', 'none');

  session.pendingAuth = {
    oauthState, verifier, tokenUri, redirectUri, issuer,
    dcrClientId,
    dcrClientSecret,
    promptNoneAttempted,
  };

  return authUrl;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /state — current session state
router.get('/state', (req, res) => {
  const session = getClientSession(req);
  // The dashboard can restore an authenticated identity from the signed _auth
  // cookie after the express session expires. That path deliberately uses the
  // `_cookie_session` token stub, so checking only for a real OAuth access
  // token made the Privilege client incorrectly report the dashboard user as
  // signed out and skip prompt=none silent sign-in.
  const mainAppToken = req.session?.oauthTokens?.accessToken;
  const mainAppAuth = Boolean(
    (mainAppToken && mainAppToken !== '_cookie_session')
    || (req.session?.user && (!mainAppToken || req.session?._restoredFromCookie)),
  );
  // Known gateway frontends the UI offers as presets. The agent URL defaults to
  // the registered opensearch app; override with PRIVILEGE_AGENT_MCPGW_URL when
  // a different app is registered in the Privilege console.
  const presets = [
    {
      label: 'Agentless gateway (nginx)',
      mode: 'agentless',
      url: process.env.PRIVILEGE_AGENTLESS_MCPGW_URL
        || process.env.PRIVILEGE_MCPGW_URL
        || DEFAULT_AGENTLESS_MCP_URL,
    },
    {
      label: 'AI Gateway via Priv Agent',
      mode: 'agent',
      url: process.env.PRIVILEGE_AGENT_MCPGW_URL
        || DEFAULT_AGENT_MCP_URL,
    },
    {
      label: 'Agentless gateway — banking (external)',
      mode: 'agentless',
      url: process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING || '',
    },
    {
      label: 'Agent Gateway — PingOne audit (scope-narrowed)',
      // mode 'agentless' selects the OAuth-capable config slot, which is what
      // this door needs (it issues a 401 challenge and an AS to discover).
      // It does NOT mean Privilege agentless — that route is gone.
      mode: 'agentless',
      url: process.env.AUDIT_MCP_URL || DEFAULT_AUDIT_MCP_URL,
    },
  ].filter((p) => p.url);
  res.json({
    config: session.config,
    gatewayMode: session.gatewayMode,
    gatewayConfigs: session.gatewayConfigs,
    oauth: { authenticated: Boolean(session.oauth.accessToken), source: session.oauth.source || null, expiresAt: session.oauth.expiresAt, scope: session.oauth.scope || '' },
    mainAppAuthenticated: mainAppAuth,
    user: req.session?.user || null,
    tools: session.tools,
    policy: publicPolicySummary(session),
    mcp: {
      era: session.mcpSession.era,
      protocolVersion: session.mcpSession.protocolVersion,
      capabilities: session.mcpSession.capabilities,
      serverInfo: session.mcpSession.serverInfo,
      instructions: session.mcpSession.instructions,
      subscriptionActive: session.subscription.active,
    },
    presets,
  });
});

// POST /config — save config
router.post('/config', express.json(), (req, res) => {
  const session = getClientSession(req);
  // The client posts its whole config object before /auth/start. Merging blanks
  // wiped the env-seeded clientId/mcpUrl for the life of the session — one click
  // made before the page's /state fetch resolved left "Client ID is required
  // before auth start." stuck on every later attempt. Blank means "unchanged".
  const body = req.body || {};
  const requestedMode = body.gatewayMode
    || (body.mcpUrl && isProcyonAgentUrl(body.mcpUrl) ? 'agent' : session.gatewayMode);
  const gatewayMode = requestedMode === 'agent' ? 'agent' : 'agentless';
  const patch = Object.fromEntries(
    Object.entries(body).filter(([key, v]) => key !== 'gatewayMode' && v !== undefined && v !== null && v !== ''),
  );
  const gatewayPatch = gatewayMode === 'agent'
    ? { ...(patch.mcpUrl ? { mcpUrl: patch.mcpUrl } : {}) }
    : Object.fromEntries(Object.entries(patch).filter(([key]) => ['mcpUrl', 'clientId', 'scopes'].includes(key)));
  session.gatewayConfigs[gatewayMode] = {
    ...session.gatewayConfigs[gatewayMode],
    ...gatewayPatch,
  };
  const sharedConfig = {
    llmUrl: patch.llmUrl || session.config.llmUrl,
    llmModel: patch.llmModel || session.config.llmModel,
  };
  session.gatewayMode = gatewayMode;
  session.config = gatewayMode === 'agent'
    ? { ...session.gatewayConfigs.agent, clientId: '', scopes: '', ...sharedConfig }
    : { ...session.gatewayConfigs.agentless, ...sharedConfig };
  resetMcpState(session);
  // Force express-session to issue the cookie (saveUninitialized: false) so the
  // saved config survives to the next request. Without this a client with no
  // prior session — procyon frontends skip the /auth/start that used to do it —
  // gets a fresh session on tools/list and the config silently reverts.
  if (req.session) req.session.privilegeMcpConfigured = true;
  emitEvent(session, 'config', { config: session.config });
  res.json({
    ok: true,
    config: session.config,
    gatewayMode: session.gatewayMode,
    gatewayConfigs: session.gatewayConfigs,
  });
});

// POST /auth/start — begin OAuth PKCE flow
router.post('/auth/start', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.config.clientId) {
      return res.status(400).json({ error: 'Client ID is required before auth start.' });
    }
    const authUrl = await beginOAuthFlow(session, req);
    session.pendingAuth.returnTo = sanitizeReturnTo(req.body?.returnTo);
    // Force express-session to persist so connect.sid cookie survives the redirect
    req.session.privilegeOAuthStarted = true;
    emitEvent(session, 'oauth', { phase: 'start', authUrl: authUrl.toString() });
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
    const { code, state: incomingState, iss, error, error_description } = req.query;
    if (error) {
      const reason = error_description ? `${error}: ${error_description}` : error;
      emitEvent(session, 'oauth', { phase: 'callback_error', error: reason });
      // prompt=none was attempted (main app session existed) but PingOne had no
      // active session to reuse — mark it so the next attempt skips prompt=none
      // and falls through to the interactive login page instead of looping.
      if (error === 'login_required' && session.pendingAuth?.promptNoneAttempted) {
        req.session.privilegePromptNoneFailed = true;
        session.pendingAuth = null;
        return res.redirect(`${returnBase}?auth=silent_failed`);
      }
      return redirectWithError(reason);
    }
    if (!session.pendingAuth || incomingState !== session.pendingAuth.oauthState) {
      throw new Error('OAuth state mismatch.');
    }
    if (iss && session.pendingAuth.issuer && iss !== session.pendingAuth.issuer) {
      throw new Error('OAuth issuer mismatch.');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: session.pendingAuth.redirectUri,
      code_verifier: session.pendingAuth.verifier,
    });
    const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
    // A DCR client (self-advertising gateway, see beginOAuthFlow) is unrelated
    // to the PingOne app id — the token endpoint only recognizes its own.
    tokenBody.set('client_id', session.pendingAuth.dcrClientId || session.config.clientId);
    const clientSecret = session.pendingAuth.dcrClientSecret
      || process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || '';
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
    // Keep the token endpoint and DCR client so refresh can run after
    // pendingAuth is cleared.
    session.oauth.tokenUri = session.pendingAuth.tokenUri;
    session.oauth.dcrClientId = session.pendingAuth.dcrClientId || null;
    session.oauth.dcrClientSecret = session.pendingAuth.dcrClientSecret || null;
    session.pendingAuth = null;
    resetMcpState(session);
    if (req.session) req.session.privilegePromptNoneFailed = false;

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
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) return res.status(401).json({ error: 'Not authenticated — click Sign In with Privilege.' });
    await discoverPolicyTools(session);
    res.json({ tools: session.tools, policy: publicPolicySummary(session) });
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
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) return res.status(401).json({ error: 'Not authenticated.' });
    const { name, arguments: args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    const data = await callMcp(session, 'tools/call', { name, arguments: args || {} });
    res.json(data);
  } catch (err) {
    emitEvent(session, 'error', { scope: 'tools_call', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// GET /catalog — discover every standard server primitive with pagination.
router.get('/catalog', async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    await ensureMcpSessionInitialized(session);
    const capabilities = session.mcpSession.capabilities || {};
    const catalog = { tools: session.tools, prompts: [], resources: [], resourceTemplates: [] };
    const requests = [];
    if (capabilities.tools && catalog.tools.length === 0) {
      requests.push(listAllMcpPages(session, 'tools/list', 'tools').then((tools) => {
        catalog.tools = tools;
        session.tools = tools;
      }));
    }
    if (capabilities.prompts) {
      requests.push(listAllMcpPages(session, 'prompts/list', 'prompts').then((prompts) => {
        catalog.prompts = prompts;
      }));
    }
    if (capabilities.resources) {
      requests.push(listAllMcpPages(session, 'resources/list', 'resources').then((resources) => {
        catalog.resources = resources;
      }));
      requests.push(listAllMcpPages(session, 'resources/templates/list', 'resourceTemplates').then((templates) => {
        catalog.resourceTemplates = templates;
      }));
    }
    const settled = await Promise.allSettled(requests);
    const errors = settled.filter((result) => result.status === 'rejected').map((result) => result.reason.message);
    res.json({
      ...catalog,
      protocol: {
        era: session.mcpSession.era,
        version: session.mcpSession.protocolVersion,
        capabilities,
        serverInfo: session.mcpSession.serverInfo,
        instructions: session.mcpSession.instructions,
      },
      errors,
    });
  } catch (err) {
    emitEvent(session, 'error', { scope: 'catalog', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

// POST /request — typed MCP request entry point for prompts, resources,
// completion, subscriptions, tasks extensions, and future negotiated methods.
router.post('/request', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const { method, params } = req.body || {};
    if (typeof method !== 'string' || !method.includes('/')) {
      return res.status(400).json({ error: 'A valid MCP method is required.' });
    }
    const data = await callMcp(session, method, params || {});
    res.json(data);
  } catch (err) {
    emitEvent(session, 'error', { scope: 'mcp_request', message: err.message });
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.post('/subscriptions/start', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const types = Array.isArray(req.body?.types) ? req.body.types : [
      'toolsListChanged', 'promptsListChanged', 'resourcesListChanged', 'resourceSubscriptions',
    ];
    await startModernSubscription(session, types);
    res.status(202).json({ ok: true, types });
  } catch (err) {
    res.status(relayFailureStatus(err)).json({ error: err.message });
  }
});

router.delete('/subscriptions', (req, res) => {
  const session = getClientSession(req);
  session.subscription.controller?.abort();
  session.subscription = { controller: null, active: false };
  res.json({ ok: true });
});

// POST /rpc — raw MCP JSON-RPC passthrough
router.post('/rpc', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    if (!session.oauth.accessToken && !isProcyonAgentUrl(session.config.mcpUrl)) return res.status(401).json({ error: 'Not authenticated.' });
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

// GET /sessions — list Privilege console applications using the stored PingOne token
// GET /sessions removed 2026-08-31. It called the Privilege CONSOLE API
// (console.privilege.pingone.com/api/<env>/v1/applications) with the MCP
// gateway's OAuth token. That API authenticates with a console session — an
// auth_token cookie plus x-procyon-session-id, obtainable only from browser
// devtools and valid ~60 minutes — so the call could never succeed here:
// without the header it answered 400 "Procyon required header is missing",
// and with it, 401 "User is not authorized". The Access tab it fed is gone too.


// POST /chat — demo chat with optional LLM routing
router.post('/chat', express.json(), async (req, res) => {
  const session = getClientSession(req);
  try {
    const prompt = req.body?.prompt || '';
    const steps = [];

    if (!session.config.mcpUrl) {
      return res.status(400).json({ error: 'Set MCP URL first.', steps });
    }
    // Procyon frontends need no OAuth client and no sign-in — the Priv Agent
    // on the workstation supplies the identity.
    const procyon = isProcyonAgentUrl(session.config.mcpUrl);
    if (!session.config.clientId && !procyon) {
      return res.json({ reply: 'OAuth Client ID is missing. Set Client ID and click Sign In.', steps: ['missing_client_id'] });
    }
    if (!session.oauth.accessToken && !procyon) {
      // Need OAuth first — build auth URL for redirect
      const authUrl = await beginOAuthFlow(session, req);
      return res.json({ reply: 'Please complete OAuth login first.', authUrl: authUrl.toString(), steps: ['oauth_required'] });
    }

    await ensureMcpSessionInitialized(session);
    steps.push('mcp_initialized');

    await discoverPolicyTools(session);
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

    let suggested = suggestions[0] || null;
    const allPolicyTools = [...session.toolPolicy.permitted, ...session.toolPolicy.filtered];
    const fallbackMatch = bestPromptTool(prompt, allPolicyTools);
    if (fallbackMatch?.score > 0 && !steps.includes('llm_routed')) {
      suggested = { name: fallbackMatch.tool.name, why: 'Matched the request to the gateway tool catalog.', arguments: {} };
    }
    if (suggested) suggestions = [suggested, ...suggestions.filter((item) => item.name !== suggested.name)];

    let decision = null;
    let execution = null;
    const filteredTool = session.toolPolicy.filtered.find((tool) => tool.name === suggested?.name);
    const permittedTool = findTool(session, suggested?.name);
    if (filteredTool) {
      decision = { outcome: 'FILTERED', tool: filteredTool.name, reason: filteredTool.deniedReason || 'The gateway omitted this tool from the permitted catalog.' };
      reply = `${filteredTool.name} is filtered by gateway policy and was not called.`;
      steps.push(`tool_filtered:${filteredTool.name}`);
    } else if (permittedTool) {
      const args = suggested.arguments || {};
      if (permittedTool.annotations?.readOnlyHint !== true) {
        decision = { outcome: 'CONFIRMATION_REQUIRED', tool: permittedTool.name, reason: 'Only tools explicitly marked read-only may be run automatically.' };
        reply = `${permittedTool.name} is permitted, but requires deliberate confirmation before execution.`;
      } else if (!hasAllRequiredArguments(permittedTool, args)) {
        decision = { outcome: 'INPUT_REQUIRED', tool: permittedTool.name, reason: `Required input: ${(permittedTool.inputSchema?.required || []).join(', ')}` };
      } else {
        try {
          execution = await callMcp(session, 'tools/call', { name: permittedTool.name, arguments: args });
          const denied = Boolean(execution?.result?.isError);
          decision = { outcome: denied ? 'DENIED' : 'ALLOWED', tool: permittedTool.name, reason: denied ? 'The MCP server or gateway rejected the call.' : 'Gateway policy permitted discovery and execution.' };
          reply = denied ? `${permittedTool.name} was denied at call time.` : `${permittedTool.name} was allowed and executed.`;
          steps.push(`tool_${denied ? 'denied' : 'allowed'}:${permittedTool.name}`);
        } catch (callErr) {
          decision = { outcome: 'DENIED', tool: permittedTool.name, reason: callErr.message };
          reply = `${permittedTool.name} was denied at call time.`;
          steps.push(`tool_denied:${permittedTool.name}`);
        }
      }
    }

    res.json({
      reply,
      tools: session.tools,
      suggested_tools: suggestions,
      policy: publicPolicySummary(session),
      decision,
      execution,
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

// Derive the gateway OIDC env from the live process env, so the Settings panel
// shows the real Privilege config even when pingone.env has never been written
// (the file is bind-mounted + gitignored, so a fresh checkout has none). Uses the
// SAME precedence the OAuth handlers above already use for these apps. Only keys
// that resolve to a non-empty value are returned — blanks stay editable.
function envFallbackVars() {
  const envId = process.env.PRIVILEGE_SSO_ENV_ID || process.env.PINGONE_ENVIRONMENT_ID;
  const asBase = envId ? `https://auth.pingone.com/${envId}/as` : '';
  const candidates = {
    SERVER_URL: process.env.PRIVILEGE_AGENTLESS_MCPGW_URL || process.env.PRIVILEGE_MCPGW_URL,
    OIDC_CLIENT_ID: process.env.PRIVILEGE_SSO_CLIENT_ID || process.env.PINGONE_MCP_GATEWAY_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET,
    OIDC_AUTH_URL: asBase && `${asBase}/authorize`,
    OIDC_TOKEN_URL: asBase && `${asBase}/token`,
    OIDC_USER_URL: asBase && `${asBase}/userinfo`,
    OIDC_SCOPES: 'openid profile email',
  };
  const out = {};
  for (const key of PINGONE_ENV_ALLOWED_KEYS) {
    if (candidates[key]) out[key] = String(candidates[key]);
  }
  return out;
}

router.get('/env', requireAdminSession, (req, res) => {
  try {
    // File values win; the process-env fallback fills any key the file omits.
    res.json({ ok: true, vars: { ...envFallbackVars(), ...readExistingEnvVars() } });
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
      if (Object.hasOwn(existing, key)) {
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

// Shared with routes/mcpFacade.js — same Priv-Agent TLS/DNS dispatcher and
// JSON-or-SSE decoder, so both relays reach the gateways the same way.
module.exports.getProcyonDispatcher = getProcyonDispatcher;
module.exports.isProcyonAgentUrl = isProcyonAgentUrl;
module.exports.decodeMcpBody = decodeMcpBody;

/** Test hooks — session-scoped SSE isolation canary. */
module.exports.__test = {
  emitEvent,
  getClientSession,
  envFallbackVars,
  listAllMcpPages,
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
