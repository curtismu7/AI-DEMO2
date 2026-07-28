/**
 * POST /api/agent/run
 *
 * AG-UI (Step 2) — BFF proxy for the agent SSE stream.
 *
 * Responsibilities:
 *  1. Session auth gate (user must have a valid session token)
 *  2. Fetch available tools via agentGatewayClient (same as /api/agent/init)
 *  3. Build initialTokenEvents from session (via agentMcpTokenService preview)
 *  4. Forward to agent service POST /run with BFF_INTERNAL_SECRET
 *  5. Pipe the SSE stream back to the browser verbatim
 *
 * The BFF never sends raw tokens to the browser. Token custody rule preserved:
 * - Agent service receives a bffToolUrl (Step 3 wires this) for tool execution
 * - Token events in STATE_SNAPSHOT contain only decoded claims, never raw JWTs
 *
 * Feature flag: ff_agui_enabled (configStore). Falls back to 404 if disabled.
 */

'use strict';

const express = require('express');
const http = require('http');
const configStore = require('../services/configStore');
const { resolveAgentMode } = require('../services/agentModeResolver');
const { verticalManifest } = require('../services/verticalManifest');
const { agentRunStore } = require('../services/agentRunStore');
const verticalDispatch = require('../services/verticalDispatch');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const { mintIntentToken } = require('../services/intentTokenService');
const { buildTokenEvent, decodeJwtClaims } = require('../services/agentMcpTokenService');
const { guardPromptInput } = require('../services/promptGuard');

const router = express.Router();
router.use(agentSessionMiddleware);

// ---------------------------------------------------------------------------
// AG-UI trace store — persists run events for /runs/:runId/events retrieval
// ---------------------------------------------------------------------------
const _traceStore = new Map(); // runId → { events: Array, expiresAt: number }
const _TRACE_TTL_MS = 60 * 60 * 1000; // 1 hour
const _MAX_TRACE_ENTRIES = 500; // Cap to prevent memory exhaustion between cleanup intervals
const _hitlConsentSubs = new Map(); // runId → { unsub, res }

/** Subscribe to cross-instance consent pub/sub and forward to the open SSE stream. */
async function _ensureHitlConsentSubscription(runId, res) {
  if (_hitlConsentSubs.has(runId)) return;
  try {
    const unsub = await agentRunStore.subscribeConsent(runId, (payload) => {
      if (!res || res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify({
          type: 'CUSTOM',
          name: 'hitl_consent',
          value: payload,
        })}\n\n`);
      } catch (_) { /* client disconnected */ }
    });
    _hitlConsentSubs.set(runId, { unsub, res });
  } catch (err) {
    console.warn('[agentRun] HITL consent subscribe failed:', err.message);
  }
}

/** Tear down a run-scoped consent subscription. */
async function _cleanupHitlConsentSubscription(runId) {
  const entry = _hitlConsentSubs.get(runId);
  if (!entry) return;
  _hitlConsentSubs.delete(runId);
  try {
    await entry.unsub();
  } catch (_) { /* best-effort */ }
}

function _recordTraceEvents(runId, chunk, owner) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
  let entry = _traceStore.get(runId);
  let hitlSuspended = false;
  if (!entry) {
    // Bind the trace to the user who started the run so /runs/:runId/events
    // cannot be read by another authenticated user who guesses the runId.
    entry = { events: [], expiresAt: Date.now() + _TRACE_TTL_MS, owner: owner || null };
    _traceStore.set(runId, entry);
    // Evict oldest entries if store exceeds cap
    if (_traceStore.size > _MAX_TRACE_ENTRIES) {
      let oldest = null;
      let oldestKey = null;
      for (const [k, v] of _traceStore) {
        if (!oldest || v.expiresAt < oldest.expiresAt) { oldest = v; oldestKey = k; }
      }
      if (oldestKey) _traceStore.delete(oldestKey);
    }
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      entry.events.push(evt);
      if (evt.type === 'RUN_FINISHED' && evt.outcome?.type === 'interrupt' && owner) {
        hitlSuspended = true;
        agentRunStore.setRunState(runId, {
          status: 'suspended_hitl',
          userId: owner,
          threadId: evt.threadId || null,
          interrupt: evt.outcome.interrupts?.[0] || null,
        }).catch((err) => {
          console.warn('[agentRun] failed to persist HITL suspend state:', err.message);
        });
      }
    } catch (_) { /* partial frame */ }
  }
  return hitlSuspended;
}
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of _traceStore) if (t.expiresAt < now) _traceStore.delete(id);
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// LangChain agent runs three listeners: uvicorn :8888 (AG-UI /run SSE),
// websockets :8889 (legacy chat WS), health :8890. Proxy /run to :8888 — the
// previous 8889 routing hit the WebSocket port and silently failed because
// raw HTTP requests are closed by the websockets handler.
const FRAMEWORK_PORTS = {
  langchain:     8888,
  openai_agents: 8891,
  mastra:        8892,
  pydantic_ai:   8893,
};

// Each framework runs in its own container with its own docker-network name
// (see data/serverInventory.js) — only langchain's honors AGENT_SERVICE_HOST,
// its original (pre-multi-framework) override knob. Any other framework
// pinned to that same hostname reaches langchain-agent's container, which
// doesn't listen on that framework's port — connection refused.
const FRAMEWORK_HOSTS = {
  langchain:     process.env.AGENT_SERVICE_HOST || 'langchain-agent',
  openai_agents: 'openai-agent',
  mastra:        'mastra-agent',
  pydantic_ai:   'pydantic-agent',
};

function resolveAgentTarget() {
  const framework = configStore.getEffective('llm_framework') || 'langchain';
  const port = FRAMEWORK_PORTS[framework] ?? FRAMEWORK_PORTS.langchain;
  const hostname = FRAMEWORK_HOSTS[framework] ?? FRAMEWORK_HOSTS.langchain;
  return { hostname, port };
}

function getInternalSecret() {
  return process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';
}

// When the active vertical ships a plugin, external runtimes must see the
// vertical's own tool schemas (e.g. book_appointment), not the banking catalog.
function resolveAgentRunTools(currentTools, activeId) {
  return verticalDispatch.hasPlugin(activeId)
    ? verticalDispatch.toolSchemasFor(activeId, () => currentTools)
    : currentTools;
}

// Flag token events for a failure the run recovered from (tool discovery fell
// back to the local catalog and the run continued). The Token Chain halt
// heuristic treats the first red event as the halt point and ghosts every step
// after it as "did not run" — steps that in fact executed. `recovered` keeps
// the event red while telling that heuristic to look further down the chain.
function markRecovered(tokenEvents) {
  return (tokenEvents || []).map((ev) => ({ ...ev, recovered: true }));
}

// ---------------------------------------------------------------------------
// POST /api/agent/run
// ---------------------------------------------------------------------------

router.post('/run', async (req, res) => {
  // Feature flag check
  const aguiEnabled = configStore.getEffective('ff_agui_enabled');
  if (aguiEnabled !== 'true' && aguiEnabled !== true) {
    return res.status(404).json({ error: 'AG-UI not enabled. Set ff_agui_enabled=true in config.' });
  }

  const { userId, email: userEmail, accessToken, tokenEvents: sessionTokenEvents } = req.agentContext || {};
  if (!userId || !accessToken) {
    return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
  }

  // Parse request body
  const { threadId, runId, messages, resume } = req.body || {};
  if (!threadId || !runId || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'threadId, runId, and messages are required' });
  }

  // Prompt-injection guard (ff_prompt_injection_guard). The legacy /api/agent/invoke
  // and /api/demo-agent/nl routes already gate on this; the default AG-UI path must
  // too, or the guard is a no-op for the primary agent flow. Guard the most recent
  // user message — the input that drives intent extraction and tool routing below.
  const lastUserMessage = [...messages].reverse().find((m) => m && m.role === 'user');
  const promptBlock = guardPromptInput((lastUserMessage?.content || '').trim());
  if (promptBlock) {
    return res.status(promptBlock.status).json(promptBlock.body);
  }

  // flowTraceId binds this run to the browser's live MCP flow SSE subscription.
  // The agent service executes tools by calling back into the BFF at
  // /internal/agent-tool, which rebuilds a request from the STORED session — so
  // we persist the trace id on the session here. agentTool.js reads it back into
  // req.body.flowTraceId, and executeBffTool then publishes pipeline phases to
  // the hub keyed by it, lighting up the compliance checklist for the AG-UI path.
  // Assumes one AG-UI run per session at a time: this is a single scalar, so two
  // concurrent runs in the same session would cross-wire the flow SSE. Acceptable
  // for the demo (one agent panel per session); key by runId if that changes.
  //
  // useCaseId tags the flow for cross-process observability, mirroring flowTraceId.
  // The AG-UI browser passes it; agentRun stashes on session; agentTool forwards
  // it back into req.body so executeBffTool stamps all token events with the tag.
  // CRITICAL: useCaseId assignment is UNCONDITIONAL (set to value or null) so each
  // run overwrites (and clears) the stale value from previous runs. If run N has no
  // useCaseId, it must clear run N-1's stale value before session.save().
  const flowTraceId = typeof req.body?.flowTraceId === 'string' ? req.body.flowTraceId.trim() : '';
  const useCaseId = typeof req.body?.useCaseId === 'string' ? req.body.useCaseId.trim() : '';
  if (flowTraceId || useCaseId) {
    if (flowTraceId) req.session.agentRunFlowTraceId = flowTraceId;
    req.session.agentRunUseCaseId = useCaseId || null;
    try {
      await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    } catch (saveErr) {
      console.warn('[agentRun] session save failed (non-fatal):', saveErr.message);
    }
  }

  // Sliding-window: forward only the most recent N messages to each agent.
  // Configurable via agent_history_limit (default 10). Prevents unbounded
  // context growth for stateless agents while preserving recent conversation.
  const historyLimit = Math.max(1, parseInt(configStore.getEffective('agent_history_limit') || '10', 10));
  const slicedMessages = messages.slice(-historyLimit);

  // ---------------------------------------------------------------------------
  // Step A: resolve initial token events from session preview
  // ---------------------------------------------------------------------------
  let initialTokenEvents = [];
  try {
    const { buildSessionPreviewTokenEvents } = require('../services/agentMcpTokenService');
    const preview = await buildSessionPreviewTokenEvents(req);
    initialTokenEvents = preview.tokenEvents || [];
  } catch (err) {
    // Non-fatal: proceed without token events rather than blocking the agent
    console.error('[agentRun] Token preview failed:', err.message);
    initialTokenEvents = sessionTokenEvents || [];
  }

  // ---------------------------------------------------------------------------
  // Step A2: mint Intent Token (behind ff_intent_token_enabled, default on)
  // ---------------------------------------------------------------------------
  const intentTokenEnabled = configStore.getEffective('ff_intent_token_enabled') !== 'false';
  if (intentTokenEnabled) {
    try {
      const lastUserMsg = [...(messages || [])].reverse().find(m => m.role === 'user');
      const prompt = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : JSON.stringify(lastUserMsg?.content ?? '');
      const { extractIntentFromPrompt } = require('../services/nlIntentParser');
      const { intent: _itIntent, confidence: _itConf } = extractIntentFromPrompt(prompt);
      const { token: _intentToken } = mintIntentToken({
        userId,
        sessionId: req.session.id,
        prompt,
        intent: _itIntent,
        confidence: _itConf,
        vertical: verticalManifest.resolver.activeIdFor(req) || 'banking',
      });
      req.session.intentToken = _intentToken;
      const _itDecoded = decodeJwtClaims(_intentToken);
      initialTokenEvents = [buildTokenEvent(
        'intent-token',
        'Intent Token — prompt bound at origin (BFF-minted)',
        'active',
        _itDecoded,
        `The BFF extracted intent "${_itIntent}" (confidence ${_itConf}) from your prompt and minted a ` +
          'cryptographically signed Intent Token (HMAC-SHA256). The permitted_tools claim lists which MCP ' +
          'tools this intent may invoke. Gateway enforcement applies on the HTTP path.',
        {
          rfc: 'draft-ietf-oauth-intent-token',
          intent: _itIntent,
          confidence: _itConf,
          permitted_tools: _itDecoded?.claims?.permitted_tools ?? [],
        }
      ), ...initialTokenEvents];
    } catch (itErr) {
      console.warn('[agentRun] Intent token minting failed (non-fatal):', itErr.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Step B: resolve available tools
  // ---------------------------------------------------------------------------
  let tools = [];
  try {
    let ccTokenResult;
    try {
      const agentCCTokenService = require('../services/agentCCTokenService');
      ccTokenResult = await agentCCTokenService.getAgentCCToken(req);
    } catch (ccErr) {
      console.warn('[agentRun] CC token failed, using local tool catalog:', ccErr.message);
    }

    const agentGatewayClient = require('../services/agentGatewayClient');
    let toolsResult;
    if (ccTokenResult) {
      try {
        toolsResult = await agentGatewayClient.getAvailableTools(req, ccTokenResult.access_token);
      } catch (toolsErr) {
        console.warn('[agentRun] Gateway tools failed, falling back to local catalog:', toolsErr.message);
        toolsResult = { tools: agentGatewayClient.getLocalToolsCatalog(), tokenEvents: [] };
        // Append any token events from the failed tools request, marked
        // `recovered` — the run continues on the local catalog, so this is not
        // the point the chain halted.
        initialTokenEvents = [...initialTokenEvents, ...markRecovered(toolsErr.tokenEvents)];
      }
    } else {
      toolsResult = { tools: agentGatewayClient.getLocalToolsCatalog(), tokenEvents: [] };
    }

    // Map to ReasonToolSchema shape { name, description, inputSchema }
    tools = (toolsResult.tools || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));

    tools = resolveAgentRunTools(tools, verticalManifest.resolver.activeIdFor(req));

    // Merge any token events from tools/list
    initialTokenEvents = [...initialTokenEvents, ...(toolsResult.tokenEvents || [])];
  } catch (err) {
    console.error('[agentRun] Tool resolution error:', err.message);
    // Non-fatal: run with no tools
  }

  // ---------------------------------------------------------------------------
  // Step C: resolve LLM provider config
  // ---------------------------------------------------------------------------
  // Priority: explicit per-run body.provider (the UI's selected agent mode, e.g.
  // 'llamacpp', forwarded by useAgentRun) > session langchain_config (set when
  // agent_mode changes) > llm_provider configStore > AGENT_PROVIDER env >
  // 'anthropic' fallback. The body value is the authoritative per-request selection
  // from the mode picker; the session value covers picker changes that didn't ride a
  // run; both win over server-wide config so the run honors what the user chose.
  const bodyProvider = (typeof req.body?.provider === 'string' && req.body.provider.trim()) ? req.body.provider.trim() : null;
  const sessionProvider = req.session?.langchain_config?.provider;

  // Heuristics mode means NO LLM — resolve the mode before the provider chain.
  // This route used to ignore agent_mode entirely and fall through to a
  // hard-coded 'anthropic', so a run that arrived without an explicit provider
  // (Heuristics selected, a stale session provider, or the HITL resume/cancel
  // runs which send none) silently called a frontier API — the `401 invalid
  // x-api-key` seen on the SE deploy. Heuristics now pins provider='none',
  // which llm_factory understands as "no LLM, heuristic routing".
  const requestedMode = (typeof req.body?.mode === 'string' && req.body.mode.trim())
    ? req.body.mode.trim()
    : configStore.getEffective('agent_mode');
  const resolvedMode = resolveAgentMode(requestedMode);
  const isHeuristics = resolvedMode && resolvedMode.provider === null;

  // For LLM modes the mode itself names the provider, so it ranks ahead of the
  // session copy (which goes stale when the picker changes without a run) and
  // ahead of server-wide config. An explicit per-run body.provider still wins.
  const provider = isHeuristics
    ? 'none'
    : (bodyProvider
      || (resolvedMode && resolvedMode.provider)
      || sessionProvider
      || configStore.getEffective('llm_provider')
      || process.env.AGENT_PROVIDER
      || 'anthropic');
  const model = configStore.getEffective('llm_model') || process.env.AGENT_MODEL || undefined;

  // bffToolUrl — URL the agent service uses to call back into the BFF for tool
  // execution with RFC 8693 token exchange (Step 8).
  //
  // Resolution order (cloud-safe):
  //   1. BFF_INTERNAL_TOOL_URL  — explicit override (e.g. Railway internal URL)
  //   2. BFF_BASE_URL           — BFF's own public origin (set on Vercel/Railway)
  //   3. Loopback fallback      — local dev without mkcert/HTTPS
  //
  // The /internal/agent-tool endpoint is gated by BFF_INTERNAL_SECRET regardless
  // of which origin is used — the secret is the security boundary, not the host.
  // Warn when BFF_BASE_URL is set without BFF_INTERNAL_TOOL_URL.
  // On platforms like Vercel, /internal/* is not rewritten to the BFF handler,
  // so BFF_BASE_URL alone is not sufficient — BFF_INTERNAL_TOOL_URL must be set
  // to the internal/private network address of the BFF.
  if (process.env.BFF_BASE_URL && !process.env.BFF_INTERNAL_TOOL_URL) {
    console.warn(
      '[agentRun] BFF_BASE_URL is set but BFF_INTERNAL_TOOL_URL is not. ' +
      'If /internal/* is not routed on your platform (e.g. Vercel), ' +
      'tool execution will fail. Set BFF_INTERNAL_TOOL_URL to the internal BFF URL.',
    );
  }
  const bffBase =
    process.env.BFF_INTERNAL_TOOL_URL ||
    (process.env.BFF_BASE_URL ? process.env.BFF_BASE_URL.replace(/\/$/, '') : null) ||
    `http://127.0.0.1:${process.env.BFF_PORT || process.env.PORT || 3001}`;
  const bffToolUrl = `${bffBase}/internal/agent-tool`;
  const sessionId = req.session && req.session.id;

  // ---------------------------------------------------------------------------
  // Step D: build the RunAgentInput payload
  // ---------------------------------------------------------------------------
  // Forward the active vertical's systemPromptFlavor to the agent service.
  // The agent (LangChain / OpenAI Agents / Mastra / Pydantic AI) injects it
  // into the first turn so the LLM replies in the active vertical's voice
  // (e.g. CareConnect uses "appointments / coverage / records" instead of
  // banking terminology). Without this forwarding the agent falls back to a
  // generic banking persona regardless of which vertical the user selected.
  // null when no active vertical resolves so the agent keeps its default.
  let verticalFlavor = null;
  try {
    const activeId = verticalManifest.resolver.activeIdFor(req);
    if (activeId) {
      const resolved = verticalManifest.resolver.resolve(activeId);
      verticalFlavor = resolved && resolved.agent && resolved.agent.systemPromptFlavor
        ? resolved.agent.systemPromptFlavor
        : null;
    }
  } catch (_) {
    /* best-effort — never block /run on a manifest read */
  }

  const agentPayload = {
    threadId,
    runId,
    messages: slicedMessages,
    tools,
    vertical_flavor: verticalFlavor,
    context: {
      bffToolUrl,
      sessionId,
      initialTokenEvents,
      provider,
      model,
      // Non-sensitive identity so the agent's system prompt reflects the
      // already-authenticated user instead of asking for their email. The
      // agent NEVER receives the user's access token — identity/authorization
      // for tool calls stays in the BFF's RFC 8693 exchange. This only carries
      // the display email + PingOne subject the BFF already holds.
      userIdentity: { userId, email: userEmail },
    },
    ...(resume ? { resume } : {}),
  };

  // ---------------------------------------------------------------------------
  // Step E: set SSE headers and proxy stream from agent service
  // ---------------------------------------------------------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Inject a STATE_SNAPSHOT with the BFF-resolved initial token events before the
  // agent stream starts. The Python agent connects to MCP directly and has no
  // access to the RFC 8693 exchange metadata computed by the BFF, so the only
  // way these events reach the client TokenChain context is via this injection.
  if (initialTokenEvents.length > 0) {
    res.write(`data: ${JSON.stringify({
      type: 'STATE_SNAPSHOT',
      snapshot: {
        tokenEvents: initialTokenEvents,
        mcpTraffic: [],
        authorizeDecisions: [],
        archTrace: [],
        auditEvents: [],
        activeRun: null,
      },
    })}\n\n`);
  }

  const { hostname: agentHost, port: agentPort } = resolveAgentTarget();
  const agentPath = '/run';

  const bodyStr = JSON.stringify(agentPayload);

  const options = {
    hostname: agentHost,
    port: agentPort,
    path: agentPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'x-internal-gateway-secret': getInternalSecret(),
    },
  };

  // Abort on browser disconnect
  let agentReq;
  req.on('close', () => {
    if (agentReq) agentReq.destroy();
    _cleanupHitlConsentSubscription(runId);
  });

  agentReq = http.request(options, (agentRes) => {
    // Non-200 from agent service — emit RUN_ERROR rather than piping raw JSON as SSE
    if (agentRes.statusCode !== 200) {
      let body = '';
      agentRes.on('data', (c) => { body += c; });
      agentRes.on('end', () => {
        console.error('[agentRun] Agent service returned HTTP', agentRes.statusCode, body.slice(0, 200));
        try {
          res.write('data: ' + JSON.stringify({
            type: 'RUN_ERROR',
            message: 'Agent service returned HTTP ' + agentRes.statusCode + ': ' + body.slice(0, 200),
            code: 'AGENT_HTTP_ERROR',
          }) + '\n\n');
        } catch (_) {}
        _cleanupHitlConsentSubscription(runId).finally(() => res.end());
      });
      return;
    }
    // Pipe SSE stream verbatim to browser and record events for trace retrieval
    agentRes.on('data', (chunk) => {
      const hitlSuspended = _recordTraceEvents(runId, chunk, userId);
      if (hitlSuspended) {
        _ensureHitlConsentSubscription(runId, res).catch((err) => {
          console.warn('[agentRun] HITL consent wiring failed:', err.message);
        });
      }
      res.write(chunk);
    });
    agentRes.on('end', () => {
      _cleanupHitlConsentSubscription(runId).finally(() => res.end());
    });
    agentRes.on('error', (err) => {
      console.error('[agentRun] Agent service stream error:', err.message);
      // Emit a RUN_ERROR event so the client knows something went wrong
      try {
        res.write('data: ' + JSON.stringify({
          type: 'RUN_ERROR',
          message: 'Agent service stream error: ' + err.message,
          code: 'STREAM_ERROR',
        }) + '\n\n');
      } catch (_) {}
      _cleanupHitlConsentSubscription(runId).finally(() => res.end());
    });
  });

  agentReq.on('error', (err) => {
    console.error('[agentRun] Agent service connection error:', err.message);
    try {
      res.write('data: ' + JSON.stringify({
        type: 'RUN_ERROR',
        message: 'Cannot reach agent service: ' + err.message,
        code: 'AGENT_UNREACHABLE',
      }) + '\n\n');
    } catch (_) {}
    _cleanupHitlConsentSubscription(runId).finally(() => res.end());
  });

  agentReq.write(bodyStr);
  agentReq.end();
});

// GET /runs/:runId/events — retrieve AG-UI events recorded for a completed run.
// Useful for trace inspection, debugging, and observability dashboards.
router.get('/runs/:runId/events', (req, res) => {
  const trace = _traceStore.get(req.params.runId);
  if (!trace) return res.status(404).json({ error: 'Trace not found or expired' });
  // Ownership check: a run's trace holds conversation content and decoded token
  // claims — only the user who started it may read it. Return 404 (not 403) so
  // the endpoint does not confirm the existence of another user's runId.
  const requester = req.agentContext?.userId;
  if (trace.owner && trace.owner !== requester) {
    return res.status(404).json({ error: 'Trace not found or expired' });
  }
  res.json({ runId: req.params.runId, events: trace.events, count: trace.events.length });
});

module.exports = router;
// Exported for the framework-routing test so it asserts against the actual
// constants instead of a re-declared copy that can silently drift.
module.exports.FRAMEWORK_PORTS = FRAMEWORK_PORTS;
module.exports.FRAMEWORK_HOSTS = FRAMEWORK_HOSTS;
module.exports.__test = {
  resolveAgentRunTools,
  markRecovered,
  _recordTraceEvents,
  _ensureHitlConsentSubscription,
  _cleanupHitlConsentSubscription,
};
