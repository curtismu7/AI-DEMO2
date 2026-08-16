// banking_api_server/routes/mcpInspector.js
/**
 * Authenticated MCP Inspector — demo of discovery (tools/list) and execution (tools/call)
 * via the Backend-for-Frontend (BFF) MCP Host proxy, without exposing raw tokens to the browser.
 */
const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');
const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
const {
  MCP_TOOL_SCOPES,
  MCP_CLIENT_PROTOCOL_VERSION,
  getMcpProtocolVersion,
  getMcpServerUrl,
  getMcpGatewayWsUrl,
  getSessionBearerForMcp,
  mcpListToolsWithFrames,
  mcpCallToolWithFrames,
  mcpRpcCall,
} = require('../services/mcpWebSocketClient');
const { callToolLocal, listLocalInspectorTools } = require('../services/mcpLocalTools');
const mcpProfileStore = require('../services/mcpProfileStore');
const mcpHttpTransport = require('../services/mcpTransports/http');
const mcpStdioTransport = require('../services/mcpTransports/stdio');
const mcpPingOneHttpAdapter = require('../services/mcpPingOneHttpAdapter');
const archEmit = require('../services/archEventEmitter');
const mcpFlowSseHub = require('../services/mcpFlowSseHub');
const { buildSsePayload } = require('../services/sseCorrelation');
const { requireSession } = require('../middleware/auth');

/**
 * Discovery phase publisher. Emits a {type, phase, label, technical, status}
 * event to the SSE hub when the trace has been claimed by this session;
 * no-op otherwise so tests and non-SSE callers behave exactly as before, and
 * so phases never land in an unclaimed buffer that a different session could
 * later attach to.
 *
 * Uses buildSsePayload so discovery events carry the same request-scoped
 * correlation_id as the existing token-event / mcp-result publishers.
 */
function publishDiscoveryPhase(traceId, phase, label, technical, status = 'active', extra = null) {
  if (!traceId) return;
  mcpFlowSseHub.publish(traceId, buildSsePayload('discovery-phase', {
    phase,
    label,
    technical,
    status,
    extra: extra || null,
  }));
}

const MCP_SESSION_NEEDED_MSG =
  'MCP discovery needs a real OAuth access token in your Backend-for-Frontend (BFF) session. If you see this after a cold open, sign out and sign in again. Cookie-only restored sessions cannot call the MCP server.';

/** Stable JSON body for 401s (browser often shows only generic status text). */
function authRequired(res, message = MCP_SESSION_NEEDED_MSG) {
  return res.status(401).json({
    error: 'authentication_required',
    message,
  });
}

/**
 * Discovery uses same token resolution as tools/call (scope from a representative tool).
 * forceDirectMcpAudience: this route's WS client always dials the raw MCP
 * server directly (see getMcpServerUrl() in mcpWebSocketClient.js), never
 * through PingGateway, so the minted token must carry the direct mcp-server
 * audience regardless of ff_mcp_gateway_pinggateway.
 */
async function sessionTokenForDiscovery(req) {
  const { token, userSub } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts', { forceDirectMcpAudience: true });
  return { token, userSub };
}

/** True when the MCP WebSocket is expected to be unreachable (align with server.js POST /api/mcp/tool). */
function isMcpUnreachableError(err) {
  if (err && err.useLocal) return true;
  const msg = (err && err.message) || '';
  return (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENETUNREACH') ||
    msg.includes('timed out') ||
    msg.includes('connect ETIMEDOUT') ||
    (err.code && ['ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT'].includes(err.code))
  );
}

// GET /api/mcp/inspector/context — architecture + config hints for the demo UI
router.get('/context', async (req, res) => {
  try {
    await configStore.ensureInitialized();
    const mcpResourceUri = configStore.getEffective('mcp_resource_uri');
    const langchainInspectorUrl =
      process.env.REACT_APP_LANGCHAIN_INSPECTOR_URL || '/api/mcp/inspector/langchain-host';
    const langchainWsPort = process.env.LANGCHAIN_WEBSOCKET_PORT || '8080';

    res.json({
      role: 'mcp_host_proxy',
      description:
        'Banking Backend-for-Frontend (BFF) acts as MCP Host for the browser: session cookie auth, optional RFC 8693 token exchange, then WebSocket JSON-RPC to the MCP server.',
      transport: { clientToBff: 'HTTPS + session cookie', bffToMcp: 'WebSocket JSON-RPC 2.0' },
      mcpProtocolVersion: getMcpProtocolVersion(),
      mcpServerConfigured: !!getMcpServerUrl(),
      tokenExchangeEnabled: !!mcpResourceUri,
      bankingAgentInspectorUrl: langchainInspectorUrl,
      langchain_chat_websocket_port: langchainWsPort,
      /** Side-by-side demo narrative: two MCP Hosts, one MCP server + one protected Banking API */
      mcpHosts: {
        bff: {
          id: 'bff',
          title: 'MCP Host — Backend-for-Frontend (BFF), browser / React',
          audience: 'End users signing in through the web app.',
          pingOneOAuth:
            'Authorization Code + PKCE → tokens stored in httpOnly server session on the Backend-for-Frontend (BFF). Browser does not hold access tokens for MCP.',
          tokenExchange:
            mcpResourceUri
              ? 'RFC 8693 token exchange before MCP: narrow scopes + MCP audience + act/delegation (configured).'
              : 'Token exchange not configured (MCP_SERVER_RESOURCE_URI empty) — demo may pass session token to MCP as today.',
          mcpClientTransport:
            'Backend-for-Frontend (BFF) opens WebSocket JSON-RPC (initialize → notifications/initialized → tools/list / tools/call).',
          bestForShowing:
            'PingOne + OAuth for humans, session-bound tokens, and why exchange + least privilege protect backends from the browser.',
        },
        langchain: {
          id: 'langchain',
          title: 'MCP Host — LangChain (AI agent)',
          audience: 'Autonomous chat agent and MCP client in Python.',
          pingOneOAuth:
            'Client credentials (ai_agent) for the agent; user context via CIBA / session flows as designed — not the React session cookie.',
          tokenExchange:
            'Target pattern: exchange user/agent context for MCP-scoped tokens (see ARCHITECTURE.md); complements Backend-for-Frontend (BFF) for non-browser actors.',
          mcpClientTransport:
            `WebSocket to MCP with Bearer on connect; chat UI uses separate WebSocket (port ${langchainWsPort}).`,
          bestForShowing:
            'How an AI agent acts as MCP client, uses tools, and still reaches the same MCP server that enforces introspection and scopes.',
          inspectorJsonUrl: langchainInspectorUrl,
        },
        shared: {
          mcpServer:
            'Same banking_mcp_server: initialize, tools/list, tools/call → validates tokens (PingOne introspection), scopes, then Banking REST API.',
          bankingApi:
            'Banking API remains behind Bearer validation + scope checks — not called directly from the browser for MCP tool execution.',
        },
      },
      flow: [
        '1. User authenticates → OAuth tokens stored in httpOnly session on the Backend-for-Frontend (BFF).',
        '2. Discovery: Backend-for-Frontend (BFF) sends initialize + tools/list over WebSocket to MCP server.',
        '3. Execution: LLM or Inspector selects a tool → Backend-for-Frontend (BFF) sends tools/call with delegated token when configured.',
        '4. MCP server introspects token, checks scopes, calls Banking API with Bearer token — backend stays behind MCP + API auth.',
      ],
    });
  } catch (err) {
    console.error('[MCP Inspector] context error:', err.message);
    res.status(500).json({ error: 'inspector_context_failed', message: err.message });
  }
});

// GET /api/mcp/inspector/profiles — saved MCP server profiles for the Generic
// MCP Inspector's server picker (secrets never included; see mcpProfileStore).
router.get('/profiles', (req, res) => {
  try {
    res.json({
      profiles: mcpProfileStore.listProfiles(),
      defaultProfileId: mcpProfileStore.DEFAULT_PROFILE_ID,
    });
  } catch (err) {
    res.status(500).json({ error: 'profiles_list_failed', message: err.message });
  }
});

/**
 * Admin session gate for profile management and non-default profile dispatch.
 * This router is mounted WITHOUT authenticateToken (so banking tools/list can
 * fall back to the local catalog for anonymous visitors) — so
 * middleware/auth.requireAdmin, which reads req.user, cannot be used here.
 * Mirrors the /api/mcp/audit session.user.role check.
 *
 * Critical: a stdio profile spawns profile.command on the BFF host
 * (services/mcpTransports/stdio.js). Any signed-in customer able to create or
 * invoke one has remote code execution; http/websocket profiles are SSRF.
 * Both creation and dispatch stay behind an admin session.
 */
function requireAdminSession(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: 'A valid session is required. Please sign in.',
    });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({
      error: 'admin_required',
      message: 'Admin session required to manage or invoke non-default MCP server profiles.',
    });
  }
  return next();
}

// POST /api/mcp/inspector/profiles — add a server profile (websocket/http need
// a url, stdio needs a local command). Admin only — see requireAdminSession.
// The default banking profile is seeded separately and cannot be created here.
router.post('/profiles', requireAdminSession, express.json(), (req, res) => {
  try {
    const profile = mcpProfileStore.createProfile(req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    res.status(400).json({ error: 'profile_create_failed', message: err.message });
  }
});

// DELETE /api/mcp/inspector/profiles/:id — remove a saved profile; the default
// banking profile is protected (mcpProfileStore throws default_profile_protected).
router.delete('/profiles/:id', requireAdminSession, (req, res) => {
  try {
    mcpProfileStore.deleteProfile(req.params.id);
    res.status(204).end();
  } catch (err) {
    const status = err.code === 'default_profile_protected' ? 400 : 404;
    res.status(status).json({ error: err.code || 'profile_delete_failed', message: err.message });
  }
});

/**
 * Dispatch tools/list to a non-default profile's transport. Unlike the default
 * banking profile, there is no local-catalog fallback here — a fabricated tool
 * list would defeat the point of inspecting a real external server, so
 * failures are returned as data (_source: 'profile_error') for the UI to show.
 */
/** Session bearer for the built-in PingOne profile — null when not signed in or expired. */
function pingoneAdminBearer(req) {
  const tok = req.session?.pingoneMcpAdminToken;
  if (!tok || !tok.accessToken || !(tok.expiresAt > Date.now())) return null;
  return tok.accessToken;
}

/** Wraps the session's PingOne admin token as a one-off profile so it can ride the http transport as-is. */
function pingoneVirtualProfile(bearer) {
  return { url: mcpPingOneHttpAdapter.getMcpUrl(), authHeader: 'Authorization', authValue: `Bearer ${bearer}` };
}

function requirePingoneAdminLogin() {
  const err = new Error('Sign in as PingOne admin to use this profile.');
  err.code = 'pingone_admin_login_required';
  return err;
}

async function listToolsForProfile(profile, req) {
  if (profile.transport === 'websocket') {
    const { result, frames } = await mcpListToolsWithFrames(null, null, undefined, { serverUrl: profile.url });
    return { tools: result.tools || [], frames };
  }
  if (profile.transport === 'http') {
    const { tools } = await mcpHttpTransport.listTools(profile);
    return { tools };
  }
  if (profile.transport === 'stdio') {
    const { tools } = await mcpStdioTransport.listTools(profile);
    return { tools };
  }
  if (profile.transport === 'pingone') {
    const bearer = pingoneAdminBearer(req);
    if (!bearer) throw requirePingoneAdminLogin();
    const { tools } = await mcpHttpTransport.listTools(pingoneVirtualProfile(bearer));
    return { tools };
  }
  throw new Error(`Unknown transport: ${profile.transport}`);
}

/** Same non-default-profile dispatch for tools/call. */
async function callToolForProfile(profile, tool, params, req) {
  if (profile.transport === 'websocket') {
    const { result, frames } = await mcpCallToolWithFrames(tool, params, null, null, undefined, { serverUrl: profile.url });
    return { result, frames };
  }
  if (profile.transport === 'http') {
    const result = await mcpHttpTransport.callTool(profile, tool, params);
    return { result };
  }
  if (profile.transport === 'stdio') {
    const result = await mcpStdioTransport.callTool(profile, tool, params);
    return { result };
  }
  if (profile.transport === 'pingone') {
    const bearer = pingoneAdminBearer(req);
    if (!bearer) throw requirePingoneAdminLogin();
    const result = await mcpHttpTransport.callTool(pingoneVirtualProfile(bearer), tool, params);
    return { result };
  }
  throw new Error(`Unknown transport: ${profile.transport}`);
}

async function handleProfileTools(req, res, profileId) {
  const profile = mcpProfileStore.getProfile(profileId);
  if (!profile) {
    return res.status(404).json({ error: 'profile_not_found', message: `No MCP server profile "${profileId}"` });
  }
  const started = Date.now();
  try {
    const { tools, frames } = await listToolsForProfile(profile, req);
    return res.json({
      timingsMs: { roundTrip: Date.now() - started },
      tools,
      frames: frames || null,
      _source: 'profile',
      _profileId: profile.id,
      _profileLabel: profile.label,
    });
  } catch (err) {
    if (err.code === 'pingone_admin_login_required') {
      return res.json({
        tools: [],
        pingone_admin_login_required: true,
        loginUrl: '/api/mcp/inspector/pingone-admin/login',
        _source: 'pingone_admin_login_required',
        _profileId: profile.id,
        _profileLabel: profile.label,
      });
    }
    console.error(`[MCP Inspector] profile "${profileId}" tools/list failed:`, err.message);
    return res.json({
      tools: [],
      error: true,
      reason: err.message,
      _source: 'profile_error',
      _profileId: profile.id,
      _profileLabel: profile.label,
    });
  }
}

async function handleProfileInvoke(req, res, profileId, tool, params) {
  const profile = mcpProfileStore.getProfile(profileId);
  if (!profile) {
    return res.status(404).json({ error: 'profile_not_found', message: `No MCP server profile "${profileId}"` });
  }
  const started = Date.now();
  try {
    const { result, frames } = await callToolForProfile(profile, tool, params || {}, req);
    return res.json({
      result,
      frames: frames || null,
      inspector: {
        tool,
        durationMs: Date.now() - started,
        phases: [`${profile.transport} transport`, 'tools/call'],
        tokenExchangeApplied: false,
      },
      _profileId: profile.id,
    });
  } catch (err) {
    if (err.code === 'pingone_admin_login_required') {
      return res.status(401).json({
        error: 'pingone_admin_login_required',
        message: err.message,
        loginUrl: '/api/mcp/inspector/pingone-admin/login',
        _profileId: profile.id,
      });
    }
    console.error(`[MCP Inspector] profile "${profileId}" invoke ${tool} failed:`, err.message);
    return res.status(502).json({
      error: 'mcp_profile_invoke_failed',
      message: err.message,
      _profileId: profile.id,
    });
  }
}

// GET /api/mcp/inspector/tools/events?trace=<uuid> — SSE stream of discovery
// phases (introspect → exchange → ws-connect → tools/list). Client opens this
// BEFORE calling GET /tools?trace=<same-uuid>, mirroring the tool-call pattern.
//
// requireSession gates the route so an anonymous visitor (whose express-session
// id is auto-populated) cannot attach to a trace and receive another session's
// discovery telemetry. There is no useful local-catalog meaning for an SSE
// stream — auth is the right contract here even though the sibling /tools
// route falls back to local catalog when unauthenticated.
router.get('/tools/events', requireSession, (req, res) => {
  mcpFlowSseHub.handleSseGet(req, res);
});

// GET /api/mcp/inspector/tools — live tools/list from MCP server, or local catalog when no MCP bearer / MCP down
router.get('/tools', async (req, res) => {
  // tools/list is read-only metadata (names + schemas, no execution, no account
  // data) — it does not need step-up MFA. The real agent only requires step-up
  // for the specific write actions in runtimeSettings.stepUpTransactionTypes
  // (transfer/withdrawal), enforced at invocation time in mcpLocalTools.js's
  // checkLocalStepUp() and by the PingOne Authorize obligation on the live
  // path — both untouched by this route and still gate those tool calls
  // (including when invoked via this inspector's own POST /invoke).

  // Non-default profile: dispatch to its transport (mcpTransports/*) instead
  // of the banking-server discovery flow below. Omitted/default profile id
  // falls through to the existing behavior unchanged.
  const requestedProfileId = typeof req.query.profile === 'string' ? req.query.profile.trim() : '';
  if (requestedProfileId && requestedProfileId !== mcpProfileStore.DEFAULT_PROFILE_ID) {
    // Non-default profile dispatch is admin-only (stdio spawns a host process).
    return requireAdminSession(req, res, () => handleProfileTools(req, res, requestedProfileId));
  }

  const effectiveUserId = req.session?.user?.id || req.user?.id || null;

  // Optional trace id for streaming discovery phases via SSE. The trace must
  // be owned by this session before we publish anything to it — otherwise a
  // different session could later attach to ?trace= and replay our phases.
  // `traceClaimed` flips true only after ensurePostTrace returns 'ok', and
  // publishDiscoveryPhase short-circuits when traceClaimed is false (i.e. we
  // pass an empty traceId for the publish calls).
  const rawTrace = typeof req.query.trace === 'string' ? req.query.trace.trim() : '';
  let traceClaimed = false;
  if (rawTrace && req.sessionID) {
    traceClaimed = mcpFlowSseHub.ensurePostTrace(rawTrace, req.sessionID) === 'ok';
    if (!traceClaimed && rawTrace) {
      // Forbidden — the trace belongs to another session. Refuse rather than
      // silently no-op so the client doesn't think streaming worked.
      return res.status(403).json({
        error: 'invalid_flow_trace',
        message: 'flowTraceId is not valid for this session.',
      });
    }
  }
  const traceId = traceClaimed ? rawTrace : '';
  let traceEnded = false;
  const endTrace = () => {
    if (traceEnded || !traceId) return;
    traceEnded = true;
    mcpFlowSseHub.endTrace(traceId);
  };
  if (traceId) {
    res.on('finish', endTrace);
    res.on('close', endTrace);
  }

  const respondLocalCatalog = (reason) => {
    publishDiscoveryPhase(
      traceId,
      'local_catalog',
      'Using local tool catalog',
      `Falling back to in-process catalog (reason: ${reason})`,
      'success'
    );
    return res.json({
      timingsMs: { roundTrip: 0 },
      tools: listLocalInspectorTools(),
      nextCursor: undefined,
      _source: 'local_catalog',
      _localCatalogReason: reason,
    });
  };

  try {
    publishDiscoveryPhase(
      traceId,
      'config_load',
      'Loading runtime config',
      'configStore.ensureInitialized()'
    );
    await configStore.ensureInitialized();
    publishDiscoveryPhase(
      traceId,
      'config_load',
      'Loaded runtime config',
      'configStore.ensureInitialized()',
      'success'
    );

    if (!getSessionBearerForMcp(req)) {
      // Surface this as the token_resolve phase so the UI's progressive
      // disclosure tells the user the actionable reason (sign-out/sign-in)
      // rather than jumping straight to "local catalog" with no context.
      publishDiscoveryPhase(
        traceId,
        'token_resolve',
        'No MCP bearer in session — sign in to verify and exchange a token',
        'getSessionBearerForMcp(req) returned falsy (cookie-only or restored session)',
        'warning'
      );
      return respondLocalCatalog('no_mcp_bearer_cookie_only_or_missing_token');
    }

    publishDiscoveryPhase(
      traceId,
      'token_resolve',
      'Verifying session and exchanging token',
      'RFC 7662 introspection → RFC 8693 token exchange'
    );

    let agentToken;
    let userSub;
    try {
      ({ token: agentToken, userSub } = await sessionTokenForDiscovery(req));
    } catch (err) {
      // Mirror the isExchangeScopeError fallback from POST /api/mcp/tool (same fix as e2324b7):
      // PingOne returns 400 ("At least one scope must be granted") or 401 ("Unsupported
      // authentication method" / policy reject) during token exchange. For discovery, fall
      // back to local catalog so the agent UI stays functional instead of showing
      // "Banking Agent is unavailable". err.pingoneError is only set when the response body
      // was parsed from PingOne's token endpoint, safely distinguishing exchange-policy
      // rejections from genuine session/auth-guard errors.
      // Discovery is read-only metadata — any token-resolve failure (exchange
      // scope policy, invalid_grant, delegation_chain_broken, …) falls back to
      // the local catalog so the AI Demo / Custom tabs still list tools.
      const resolvedErrCode = err.error || err.code || err.httpStatus || 'unknown';
      console.warn(
        '[MCP Inspector] token resolve failed (%s HTTP %s): %s — using local catalog',
        resolvedErrCode,
        err.httpStatus,
        err.message
      );
      publishDiscoveryPhase(
        traceId,
        'token_resolve',
        'Token resolution failed — using local catalog',
        err.message || `code=${resolvedErrCode}`,
        'warning'
      );
      return respondLocalCatalog(`token_resolve_failed_${resolvedErrCode}`);
    }
    if (!agentToken) {
      return respondLocalCatalog('token_resolution_yielded_null');
    }
    publishDiscoveryPhase(
      traceId,
      'token_resolve',
      'Session verified and MCP token minted',
      'RFC 7662 introspection + RFC 8693 token exchange',
      'success'
    );


    publishDiscoveryPhase(
      traceId,
      'ws_connect',
      'Connecting to MCP server',
      'WebSocket JSON-RPC: initialize → notifications/initialized'
    );

    const started = Date.now();
    try {
      const { result, frames } = await mcpListToolsWithFrames(agentToken, userSub);
      const durationMs = Date.now() - started;
      publishDiscoveryPhase(
        traceId,
        'ws_connect',
        'Connected to MCP server',
        'WebSocket JSON-RPC: initialize + notifications/initialized OK',
        'success'
      );
      publishDiscoveryPhase(
        traceId,
        'tools_list',
        'Tool catalog loaded',
        `JSON-RPC tools/list (${durationMs}ms, ${(result.tools || []).length} tools)`,
        'success',
        { durationMs, count: (result.tools || []).length }
      );
      return res.json({
        timingsMs: { roundTrip: durationMs },
        tools: result.tools || [],
        nextCursor: result.nextCursor,
        _source: 'mcp_server',
        // Exact JSON-RPC frames as sent/received (teaching surface — token
        // visibility is intentional in this demo).
        frames,
      });
    } catch (err) {
      if (isMcpUnreachableError(err)) {
        console.warn('[MCP Inspector] tools/list MCP unreachable, using local catalog:', err.message);
        publishDiscoveryPhase(
          traceId,
          'ws_connect',
          'MCP server unreachable — using local catalog',
          err.message,
          'warning'
        );
        return respondLocalCatalog(`mcp_unreachable: ${err.message}`);
      }
      publishDiscoveryPhase(
        traceId,
        'tools_list',
        'tools/list failed',
        err.message || 'unknown error',
        'failed'
      );
      throw err;
    }
  } catch (err) {
    console.error('[MCP Inspector] tools/list error:', err.message);
    res.status(502).json({ error: 'mcp_discovery_failed', message: err.message });
  }
});

// POST /api/mcp/inspector/invoke — tools/call with inspector metadata (demo); local handler when no MCP bearer or MCP down
router.post('/invoke', express.json(), async (req, res) => {
  const { tool, params, meta, profile: requestedProfileId } = req.body || {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'tool name is required' });
  }

  // Non-default profile: dispatch to its transport, bypassing the banking-
  // server token exchange / local-handler path below entirely.
  if (requestedProfileId && requestedProfileId !== mcpProfileStore.DEFAULT_PROFILE_ID) {
    // Non-default profile dispatch is admin-only (stdio spawns a host process).
    return requireAdminSession(req, res, () =>
      handleProfileInvoke(req, res, requestedProfileId, tool, params));
  }

  const effectiveUserId = req.session?.user?.id || req.user?.id || null;

  // Tools that don't require user auth (no DB access, pure logic)
  const noAuthTools = new Set(['query_user_by_email']);
  const respondLocalInvoke = async () => {
    if (!effectiveUserId && !noAuthTools.has(tool)) {
      return authRequired(res);
    }
    const started = Date.now();
    const result = await callToolLocal(tool, params || {}, effectiveUserId, req);
    const durationMs = Date.now() - started;
    return res.json({
      result,
      _localFallback: true,
      inspector: {
        tool,
        durationMs,
        phases: ['local handler (in-process, no MCP WebSocket)'],
        tokenExchangeApplied: false,
        requiredScopesHint: MCP_TOOL_SCOPES[tool] || ['read'],
      },
    });
  };

  try {
    await configStore.ensureInitialized();

    // Tools that require no user auth — run locally without token exchange
    if (noAuthTools.has(tool)) {
      return await respondLocalInvoke();
    }

    if (!getSessionBearerForMcp(req)) {
      return await respondLocalInvoke();
    }

    let agentToken;
    let userSub;
    let tokenEvents = [];
    try {
      // forceDirectMcpAudience: this route's WS client dials the raw MCP server
      // directly (see sessionTokenForDiscovery above), never through PingGateway.
      ({ token: agentToken, userSub, tokenEvents = [] } = await resolveMcpAccessTokenWithEvents(req, tool, { forceDirectMcpAudience: true }));
    } catch (err) {
      // Mirror GET /tools: exchange/refresh failures (invalid_grant, scope policy)
      // fall back to the in-process local handler so the AI Demo / Custom tabs
      // stay usable instead of only surfacing PingOne's grant error.
      if (effectiveUserId) {
        console.warn(
          '[MCP Inspector] invoke token resolve failed (%s) — local handler',
          err.code || err.httpStatus || err.message
        );
        return await respondLocalInvoke();
      }
      const status = err.httpStatus || 502;
      return res.status(status).json({
        error: err.code || 'token_resolution_failed',
        message: err.message,
        tokenEvents: err.tokenEvents || [],
      });
    }
    if (!agentToken) {
      return await respondLocalInvoke();
    }


    const started = Date.now();
    try {
      archEmit({ nodeId: 'n-mcp-gw', edgeId: 'e-bff-mcpgw', label: 'MCP tool call dispatched to gateway' });
      // meta: MCP Inspector's "Attach progress token" toggle — request metadata
      // (params._meta), not a tool argument. See mcpCallToolWithFrames's opts.meta.
      // Extra call args are only appended when meta is actually present, so the
      // arity callers/tests already depend on is unchanged in the common case.
      const invokeOpts = meta && typeof meta === 'object' ? { meta } : undefined;
      const { result, frames } = invokeOpts
        ? await mcpCallToolWithFrames(tool, params || {}, agentToken, userSub, undefined, invokeOpts)
        : await mcpCallToolWithFrames(tool, params || {}, agentToken, userSub);
      const durationMs = Date.now() - started;
      archEmit({ nodeId: 'n-mcp-server', edgeId: 'e-mcpgw-mcpserver', label: 'MCP Server executed tool' });

      return res.json({
        result,
        // Exact JSON-RPC frames + token-exchange chain (teaching surface —
        // token visibility is intentional in this demo).
        frames,
        tokenEvents,
        inspector: {
          tool,
          durationMs,
          phases: ['initialize (WebSocket)', 'tools/call'],
          tokenExchangeApplied: !!configStore.getEffective('mcp_resource_uri'),
          requiredScopesHint: MCP_TOOL_SCOPES[tool] || ['read'],
        },
      });
    } catch (err) {
      if (isMcpUnreachableError(err) && effectiveUserId) {
        console.warn(`[MCP Inspector] invoke ${tool} — MCP unreachable, local handler:`, err.message);
        return await respondLocalInvoke();
      }
      // Surface the real JSON-RPC error frame (and the token chain that led
      // to it) on the 502 below — frames already ride on err from the
      // WithFrames wrapper.
      err.tokenEvents = err.tokenEvents || tokenEvents;
      throw err;
    }
  } catch (err) {
    console.error(`[MCP Inspector] invoke ${tool}:`, err.message);
    res.status(502).json({
      error: 'mcp_invoke_failed',
      message: err.message,
      ...(err.frames ? { frames: err.frames } : {}),
      ...(err.tokenEvents ? { tokenEvents: err.tokenEvents } : {}),
    });
  }
});

// Explicit allow-list — POST /rpc must never become an open JSON-RPC proxy.
// Every method here is a clean request→response call implemented ONLY behind
// the MCP gateway's proxy to demo_mcp_resource_server (see demo_mcp_gateway/
// src/index.ts RESOURCE_SERVER_ONLY_METHODS + mcpRequestValidation.ts
// ALLOWED_METHODS) — the plain mcp-server (getMcpServerUrl) does not
// implement any of them, so this route dials the gateway WS URL directly.
const PROTOCOL_RPC_METHODS = new Set([
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'logging/setLevel',
]);

// Not a real MCP tool — a scope-hint placeholder so resolveMcpAccessTokenWithEvents's
// tokenEvents/log lines have a stable label. MCP_TOOL_SCOPES is not consulted for it
// because opts.scopeOverride below takes precedence (same pattern as
// agentToolsResolver.js's DISCOVERY_TOOL for tools/list discovery).
const PROTOCOL_RPC_PSEUDO_TOOL = '__protocol_rpc__';

// POST /api/mcp/inspector/rpc — tester for MCP protocol methods that are not
// tools/call (Resources, Prompts, Completion, Logging). Requires a real
// session: there is no local in-process handler for these methods, so unlike
// /invoke there is nothing to fall back to when a bearer can't be resolved.
//
// Token audience: NOT forceDirectMcpAudience — these methods only exist
// behind the MCP gateway (RESOURCE_SERVER_ONLY_METHODS proxies to the
// resource-server 'invest' backend), so the token must carry the gateway's
// audience, exactly as resolveMcpAccessTokenWithEvents already resolves by
// default when a gateway is configured (see _resolveFinalMcpAudience).
router.post('/rpc', requireSession, express.json(), async (req, res) => {
  const { method, params } = req.body || {};
  if (!method || typeof method !== 'string' || !PROTOCOL_RPC_METHODS.has(method)) {
    return res.status(400).json({
      error: 'invalid_method',
      message: `method must be one of: ${[...PROTOCOL_RPC_METHODS].join(', ')}`,
    });
  }

  const gatewayWsUrl = getMcpGatewayWsUrl();
  if (!gatewayWsUrl) {
    return res.status(503).json({
      error: 'mcp_gateway_not_configured',
      message: 'MCP Gateway is not configured (MCP_GATEWAY_HTTP_URL). Resources/Prompts/Completion/Logging are served only behind the gateway.',
    });
  }

  try {
    await configStore.ensureInitialized();

    let agentToken;
    let userSub;
    let tokenEvents = [];
    try {
      ({ token: agentToken, userSub, tokenEvents = [] } = await resolveMcpAccessTokenWithEvents(
        req,
        PROTOCOL_RPC_PSEUDO_TOOL,
        { scopeOverride: ['read'] }
      ));
    } catch (err) {
      const status = err.httpStatus || 502;
      return res.status(status).json({
        error: err.code || 'token_resolution_failed',
        message: err.message,
        tokenEvents: err.tokenEvents || [],
      });
    }
    if (!agentToken) {
      return authRequired(res);
    }

    const started = Date.now();
    try {
      const { result, frames } = await mcpRpcCall(method, params || {}, agentToken, userSub, undefined, { serverUrl: gatewayWsUrl });
      const durationMs = Date.now() - started;
      return res.json({
        result,
        // Exact JSON-RPC frames (teaching surface — token visibility is
        // intentional in this demo), same shape as /invoke's response.
        frames,
        tokenEvents,
        inspector: {
          method,
          durationMs,
          phases: ['initialize (WebSocket, gateway)', method],
        },
      });
    } catch (err) {
      err.tokenEvents = err.tokenEvents || tokenEvents;
      throw err;
    }
  } catch (err) {
    console.error(`[MCP Inspector] rpc ${method}:`, err.message);
    res.status(502).json({
      error: 'mcp_rpc_failed',
      message: err.message,
      ...(err.frames ? { frames: err.frames } : {}),
      ...(err.tokenEvents ? { tokenEvents: err.tokenEvents } : {}),
    });
  }
});

// GET /api/mcp/inspector/langchain-host — proxy to the LangChain AG-UI HTTP
// server (LANGCHAIN_AGENT_HTTP_URL, port 8888). Do NOT use health :8890:
// that server binds loopback-only (CR-03), so localhost:8890 from the BFF
// container/pod is the BFF itself and returns undici "fetch failed" in
// Docker/K8s. Same pattern as codegraphProxy.js / aguiSseProxy.js.
router.get('/langchain-host', async (req, res) => {
  const base = (process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
  const url = `${base}/inspector/mcp-host`;
  const secret = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'x-internal-gateway-secret': secret },
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'langchain_agent_error', message: `Agent returned HTTP ${upstream.status}` });
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    // undici wraps connect failures as TypeError("fetch failed") with cause.code
    const causeCode = err.cause && err.cause.code;
    const isDown =
      err.name === 'AbortError' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ECONNRESET' ||
      causeCode === 'ECONNREFUSED' ||
      causeCode === 'ECONNRESET' ||
      /fetch failed/i.test(err.message || '');
    res.status(isDown ? 503 : 502).json({
      error: isDown ? 'langchain_agent_down' : 'langchain_agent_error',
      message: isDown
        ? `LangChain agent not running at ${base}. Start with: cd langchain_agent && python -m src.main`
        : err.message,
    });
  }
});

// Page-only live-query gate shared by the two PingOne inspector routes.
// mcp_use_pingone_server still governs AGENT routing separately.
async function pingOneInspectorLiveFlag() {
  try {
    await configStore.ensureInitialized();
    // getEffective applies the catalog default ('true'); bare get() returns null
    // when unset and left the PingOne tab permanently Disconnected (2026-07-22).
    return configStore.getEffective('mcp_inspector_pingone_live') === 'true';
  } catch (_) {
    return false; // fall through to the disabled state
  }
}

// GET /api/mcp/inspector/pingone-tools — live tools/list from the hosted PingOne
// MCP Server (HTTP), gated behind the mcp_inspector_pingone_live feature flag.
// Graceful fallback: when the flag is off or the server is unreachable, the
// page still renders the request and an explanatory state (never a hard error).
router.get('/pingone-tools', requireSession, async (_req, res) => {
  // The JSON-RPC request the BFF sends to the hosted PingOne MCP server over HTTP.
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

  if (!(await pingOneInspectorLiveFlag())) {
    return res.json({
      enabled: false,
      reason: 'Live querying is turned off for this page. Use the "Live query" toggle above to query the PingOne MCP server.',
      request,
      response: null,
      tools: [],
      _source: 'flag_off',
    });
  }

  try {
    const { listTools } = require('../services/mcpPingOneHttpAdapter');
    const started = Date.now();
    const tools = await listTools();
    return res.json({
      enabled: true,
      request,
      response: { jsonrpc: '2.0', id: 1, result: { tools } },
      tools,
      // Prefills for schema params the demo already knows — nearly every
      // PingOne tool requires environmentId and users shouldn't have to
      // paste a UUID. Environment ID is not a secret (it appears in issuer
      // URLs).
      paramDefaults: {
        environmentId: configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '',
      },
      timingsMs: { roundTrip: Date.now() - started },
      _source: 'pingone_mcp_server',
    });
  } catch (err) {
    return res.json({
      enabled: true,
      error: true,
      reason: `PingOne MCP server unreachable: ${err.message}. Ensure the hosted PingOne MCP feature is enabled and worker credentials are configured.`,
      request,
      response: null,
      tools: [],
      _source: 'pingone_mcp_error',
    });
  }
});

// POST /api/mcp/inspector/pingone-invoke — tools/call against the hosted PingOne
// MCP server (HTTP), same flag gate as /pingone-tools. The page renders the exact
// JSON-RPC request next to the result, so failures come back as 200 with an
// error field (never an HTTP error) to keep the request pane visible.
router.post('/pingone-invoke', requireSession, async (req, res) => {
  const { tool, params } = req.body || {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'invalid_tool', message: 'Body must include a tool name.' });
  }
  const args = params && typeof params === 'object' ? params : {};
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  };

  if (!(await pingOneInspectorLiveFlag())) {
    return res.json({
      enabled: false,
      reason: 'Live querying is turned off for this page. Use the "Live query" toggle to enable it.',
      request,
      response: null,
      _source: 'flag_off',
    });
  }

  try {
    const { callTool } = require('../services/mcpPingOneHttpAdapter');
    const accessToken = req.session?.oauthTokens?.accessToken || '';
    const started = Date.now();
    const result = await callTool(tool, args, accessToken, req.session?.user?.id);
    return res.json({
      enabled: true,
      request,
      response: { jsonrpc: '2.0', id: 1, result },
      timingsMs: { roundTrip: Date.now() - started },
      _source: 'pingone_mcp_server',
    });
  } catch (err) {
    return res.json({
      enabled: true,
      error: true,
      reason: `tools/call failed: ${err.message}`,
      request,
      response: err.mcpCode != null
        ? { jsonrpc: '2.0', id: 1, error: { code: err.mcpCode, message: err.message } }
        : null,
      _source: 'pingone_mcp_error',
    });
  }
});

module.exports = router;
