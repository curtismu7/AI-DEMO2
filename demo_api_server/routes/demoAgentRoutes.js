/**
 * Banking Agent Routes
 * Endpoints for LangChain agent interaction with HITL consent gates
 * Per-request stateless agent initialization with session-persisted history
 */

const express = require('express');
const crypto = require('crypto');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const {
  storeConsentRequest,
  recordConsentDecision,
} = require('../middleware/hitlGatewayMiddleware');
const hitlServiceClient = require('../services/hitlServiceClient');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');
const appEventService = require('../services/appEventService');
const { trackTokenEvent } = require('../services/tokenChainService');
const { prependRefreshEvent } = require('../services/agentMcpTokenService');
const { buildActivitySteps } = require('../services/activityStepsBuilder');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');

const router = express.Router();
router.use(agentSessionMiddleware);
router.use(requestEventEmitterMiddleware);

// POST /init - Initialize agent session
// i4ai-ref-arch.mmd steps 1–10: Chatbot → Agent → CC token + tools/list
router.post('/init', async (req, res) => {
  try {
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }

    console.log('[demo-agent/init] User authenticated, requesting agent CC token');

    // Step 3–4: Obtain agent CC token from PingOne
    const agentCCTokenService = require('../services/agentCCTokenService');
    let ccTokenResult;
    try {
      ccTokenResult = await agentCCTokenService.getAgentCCToken(req);
    } catch (ccError) {
      console.error('[demo-agent/init] CC token failed:', ccError.code, ccError.message);
      const httpStatus = ccError.httpStatus || 503;
      return res.status(httpStatus).json({
        error: ccError.code || 'agent_cc_token_failed',
        message: ccError.message,
        initialized: false,
        agentConfigured: false,
        agentReady: false,
      });
    }

    console.log('[demo-agent/init] Agent CC token obtained, requesting tools/list from gateway');

    // Step 5–10: Request available tools from Agent Gateway
    // Gateway will call Ping Authorize for policy evaluation
    const agentGatewayClient = require('../services/agentGatewayClient');
    let toolsResult;
    try {
      toolsResult = await agentGatewayClient.getAvailableTools(req, ccTokenResult.access_token);
    } catch (toolsError) {
      console.error('[demo-agent/init] Tools list failed:', toolsError.code, toolsError.message);

      // If gateway is unreachable and not configured, fallback to local catalog
      if (toolsError.code === 'tools_list_failed' && toolsError.message.includes('ECONNREFUSED')) {
        console.log('[demo-agent/init] Agent Gateway unreachable, using local tools catalog');
        toolsResult = {
          tools: agentGatewayClient.getLocalToolsCatalog(),
          tokenEvents: [],
        };
        if (req?.recordTokenEvent) {
          req.recordTokenEvent('tools_list_fallback', {
            reason: 'gateway_unreachable',
            toolCount: toolsResult.tools.length,
          });
        }
      } else {
        // Authorization failure (403) or other fatal errors
        const httpStatus = toolsError.httpStatus || 502;
        return res.status(httpStatus).json({
          error: toolsError.code || 'tools_list_failed',
          message: toolsError.message,
          initialized: true, // User session is valid
          agentConfigured: false, // But agent can't fetch tools
          agentReady: false,
          tokenEvents: toolsError.tokenEvents || (req.tokenEvents || []),
        });
      }
    }

    console.log('[demo-agent/init] Agent init complete, returning tools');

    // Merge all token events from CC token + tools/list requests, prepending a
    // 'token-refresh' card if the access token was silently refreshed this request.
    const allTokenEvents = prependRefreshEvent(req, [
      ...(req.tokenEvents || []),
      ...(toolsResult.tokenEvents || []),
    ]);

    // Success: Return initialized agent with available tools
    res.json({
      sessionId: req.session.id,
      initialized: true,
      agentReady: true,
      agentConfigured: true,
      availableTools: toolsResult.tools || [],
      tokenEvents: allTokenEvents,
    });
  } catch (error) {
    console.error('[demo-agent/init] Unexpected error:', error.code || 'unknown', error.message);
    res.status(500).json({
      error: error.code || 'agent_init_error',
      message: error.message,
      initialized: false,
      agentConfigured: false,
      agentReady: false,
    });
  }
});

// POST /tools - (Re)fetch the Authorize-filtered tool list for a (vertical, allowWrite).
// Drives the dynamic, greyable agent chips: called on login, on vertical switch, and
// on scope-picker (write-toggle) change. Reuses the session-cached agent token for the
// same (vertical, scopeSet); a switch/flip re-mints once. Discovery runs through the WS
// gateway path so PingOne Authorize filters by vertical + scope.
router.post('/tools', express.json(), async (req, res) => {
  try {
    const { userId, accessToken } = req.agentContext || {};
    if (!userId || !accessToken) {
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }
    const configStore = require('../services/configStore');
    const vertical = (typeof req.body?.vertical === 'string' && req.body.vertical)
      || configStore.getEffective('active_vertical') || 'banking';
    // Default to write-enabled so initial chips are fully active; the picker restricts.
    const allowWrite = req.body?.allowWrite !== false;

    const { resolveAvailableTools } = require('../services/agentToolsResolver');
    const { availableTools, tokenEvents, degraded, degradedReason } = await resolveAvailableTools(req, { vertical, allowWrite });
    return res.json({ vertical, allowWrite, availableTools, tokenEvents, degraded: !!degraded, degradedReason: degradedReason || null });
  } catch (error) {
    console.error('[demo-agent/tools] error:', error.code || 'unknown', error.message);
    // Downstream gateway/MCP unreachable — surface so the UI can show a clear state.
    return res.status(error.httpStatus || 502).json({
      error: error.code || 'tools_fetch_failed',
      message: error.message,
    });
  }
});

// POST /message - Process agent message
router.post('/message', async (req, res) => {
  let runId = null;
  let useCaseId = '';
  try {
    console.log('[demo-agent/message] Incoming request');
    useCaseId = req.body?.useCaseId || '';

    // Emit user_request event
    req.eventEmitter.emit(
      'user_request',
      'User message received and queued for agent processing',
      {
        rfc: 'RFC 7231',
        section: '4.3',
        details: `POST /message with messageLength=${req.body?.message?.length || 0}`
      },
      'info'
    );

    console.log('[demo-agent/message] Session ID:', req.session?.id);
    console.log('[demo-agent/message] Session exists:', !!req.session);
    console.log('[demo-agent/message] Request body keys:', Object.keys(req.body || {}));
    console.log('[demo-agent/message] Message present:', !!req.body?.message);

    const { message, vertical } = req.body;
    // A per-request provider (e.g. the PingOne Admin chips send 'pingone-admin')
    // overrides the session's configured provider so processAgentMessage takes the
    // matching branch. Only a non-empty string is honored.
    const requestProvider = typeof req.body?.provider === 'string' && req.body.provider
      ? req.body.provider
      : null;
    runId = crypto.randomUUID();
    const runStartedAt = new Date().toISOString();
    // CR-05 fix: validate message is a non-empty string. express.json() may
    // deliver arrays or objects for keys that are truthy but not strings.
    if (!message || typeof message !== 'string') {
      console.log('[demo-agent/message] ERROR: Message must be a non-empty string');
      return res.status(400).json({ error: 'Message must be a non-empty string' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    console.log('[demo-agent/message] Message length:', message.length);
    console.log('[demo-agent/message] agentContext present:', !!req.agentContext);
    console.log('[demo-agent/message] agentContext keys:', req.agentContext ? Object.keys(req.agentContext) : 'none');

    const { userId, accessToken, tokenEvents } = req.agentContext || {};
    console.log('[demo-agent/message] userId:', userId);
    console.log('[demo-agent/message] accessToken present:', !!accessToken);
    console.log('[demo-agent/message] accessToken length:', accessToken?.length || 0);
    console.log('[demo-agent/message] tokenEvents count:', tokenEvents?.length || 0);

    if (!userId || !accessToken) {
      console.error('[demo-agent/message] ERROR: Session expired - userId:', userId, 'accessToken present:', !!accessToken);
      return res.status(401).json({ error: 'Session expired', agentInitRequired: true, need_auth: true });
    }

    // Bookend for Activity Log demos — same correlationId on start + end.
    const messagePreview = message.length > 72 ? `${message.slice(0, 72)}…` : message;
    appEventService.logEvent('agent', 'info', `Agent flow start — ${messagePreview}`, {
      tag: 'agent/flow-start',
      correlationId: runId,
      metadata: {
        runId,
        ...(useCaseId ? { useCaseId } : {}),
        ...(vertical ? { vertical } : {}),
        messagePreview,
      },
    });

    // Phase 2 CR-02: pre-flight consent lookup removed. The previous code
    // called getConsentDecision(req.session.id), but the store is keyed by
    // consentId (a per-request token), not by sessionId — so the check
    // could never fire. Consent enforcement happens via the 428 reply on
    // /api/transactions (Phase 170) and via the explicit POST /consent
    // handshake below; there is no pending consent to look up at this
    // point in the flow.

    // Chatbot is dumb: just forward prompt to agent
    // Agent (with LLM) decides which tools to use, handles authorization, token exchange

    // Emit agent_thinking event
    req.eventEmitter.emit(
      'agent_thinking',
      'Agent is analyzing the request and determining which tools to invoke',
      {
        rfc: 'RFC 8693',
        section: '2.1',
        details: `Vertical: ${vertical || 'default'}, Message preview: "${message.substring(0, 50)}..."`
      },
      'info'
    );

    // Process message with agent (normal flow)
    console.log('[demo-agent/message] Calling processAgentMessage...');
    const langchainConfig = {
      ...(req.session?.langchain_config || {}),
      ...(requestProvider ? { provider: requestProvider } : {}),
    };
    const response = await processAgentMessage({
      message,
      vertical,
      userId,
      userToken: accessToken,
      sessionId: req.session.id,
      tokenEvents: tokenEvents || [],
      langchainConfig,
      req,
    });
    console.log('[demo-agent/message] processAgentMessage response received');
    console.log('[demo-agent/message] Response keys:', Object.keys(response || {}));
    console.log('[demo-agent/message] success:', response?.success);
    console.log('[demo-agent/message] requiresConsent:', response?.requiresConsent);
    console.log('[demo-agent/message] agentConfigured:', response?.agentConfigured);
    console.log('[demo-agent/message] tokenEvents count:', response?.tokenEvents?.length || 0);
    console.log('[demo-agent/message] error present:', !!response?.error);
    if (response?.error) {
      console.error('[demo-agent/message] Response error:', response.error);
    }

    // Emit tool_call events if tools were invoked
    if (response?.toolsCalled && response.toolsCalled.length > 0) {
      for (const toolName of response.toolsCalled) {
        req.eventEmitter.emit(
          'tool_call',
          `Agent invoked the ${toolName} tool`,
          {
            rfc: 'RFC 8693',
            section: '2.2',
            details: `Tool: ${toolName}, Total tools: ${response.toolsCalled.length}`
          },
          'info'
        );
      }
    }

    // Include token events in the response
    if (response?.tokenEvents && response.tokenEvents.length > 0) {
      console.log('[demo-agent/message] Including token events in response');
    }

    // Check if consent is required
    if (response.requiresConsent) {
      console.log('[demo-agent/message] Consent required, storing request...');
      // Phase 2 CR-02: the store is keyed by consentId. The previous code
      // stored under req.session.id, which never matched the lookup in
      // hitlGatewayMiddleware.getConsentDecision/recordConsentDecision
      // (those key by consentId). Aligning the write site here.
      //
      // Phase 2 CR-03: was Math.random().toString(36).substr(2, 9) — not
      // cryptographically secure (V8 xorshift128+ is predictable), ~52 bits
      // of entropy, and used the deprecated .substr() method. crypto.randomUUID
      // gives 128 bits of entropy from the platform CSPRNG. Must land in the
      // same commit as CR-02: without CR-02 the weak ID was dead-code; once
      // CR-02 makes the store functional, the ID becomes attack surface.
      const consentId = await storeConsentRequest({
        sessionId: req.session.id,
        userId,
        userEmail: req.session?.user?.email,
        action: response.action,
        amount: response.amount,
        details: response.details,
      });
      console.log('[demo-agent/message] Consent request stored, consentId:', consentId);
      return res.status(428).json({
        requiresConsent: true,
        consentId,
        action: response.action,
        message: response.message,
        tokenEvents: response.tokenEvents || []
      });
    }

    // ── Token chain events for NL path ──────────────────────────────────────
    // The heuristic/LangGraph service executes tools locally (via dataStore) and
    // returns tokenEvents: []. To keep the Token Chain panel updated on the NL path
    // (just like the chip/action → POST /api/mcp/tool path), resolve token events
    // from the session when the agent called any tool.
    let resolvedTokenEvents = response.tokenEvents || [];
    if (resolvedTokenEvents.length === 0 && response.toolsCalled?.length > 0) {
      try {
        const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
        const toolName = response.toolsCalled[0];
        const resolved = await resolveMcpAccessTokenWithEvents(req, toolName);
        resolvedTokenEvents = resolved.tokenEvents || [];
        console.log('[demo-agent/message] Generated %d token events for NL tool call (%s)',
          resolvedTokenEvents.length, toolName);
      } catch (tokenErr) {
        // Exchange may fail (unconfigured, scope mismatch, etc.) — use whatever events were
        // collected before the error. Fall back to session preview if nothing available.
        resolvedTokenEvents = tokenErr.tokenEvents || [];
        if (resolvedTokenEvents.length === 0) {
          try {
            const { buildSessionPreviewTokenEvents } = require('../services/agentMcpTokenService');
            // buildSessionPreviewTokenEvents is async — without await this resolved
            // to (Promise).tokenEvents === undefined → [], emptying the chain on the
            // exact failure-fallback path it exists to populate.
            const preview = await buildSessionPreviewTokenEvents(req);
            resolvedTokenEvents = preview.tokenEvents || [];
          } catch (_) { /* non-fatal */ }
        }
        console.log('[demo-agent/message] Token event generation failed (%s), using %d fallback events',
          tokenErr.code || tokenErr.message, resolvedTokenEvents.length);
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    // How the exchange-performing client authenticated to the PingOne token
    // endpoint (private_key_jwt vs basic/post) is recorded on the exchange event
    // itself by agentMcpTokenService (truthful per client — the MCP exchanger is
    // not switched by the flag). Surface it on the "what's happening" delegation
    // step too, from whichever event carries it.
    const exchangeAuthMethod = (resolvedTokenEvents || [])
      .map(e => e?.clientAuthMethod).find(Boolean) || null;

    // Persist token events to token chain service for /api/token-chain monitoring
    if (resolvedTokenEvents && resolvedTokenEvents.length > 0 && userId) {
      try {
        for (const event of resolvedTokenEvents) {
          // eventType is the token-chain domain (auth|exchange|refresh|revoke),
          // NOT the per-step UI status. trackTokenEvent + getCurrentTokens filter
          // on eventType; passing event.status here ('acquiring'/'failed'/...)
          // produced nonsense types and silently excluded most steps from
          // /api/token-chain/current. An exchanged token carries both sub+act.
          const isExchanged = !!(event.claims?.sub && event.claims?.act);
          await trackTokenEvent({
            eventType: isExchanged ? 'exchange' : 'auth',
            token: '', // raw token not available here — claims passed via additionalData
            description: `${event.label}: ${event.explanation || ''}`,
            userId: userId,
            additionalData: {
              tokenLabel: event.label,
              status: event.status,
              claims: event.claims,
              tokenType: isExchanged ? 'exchanged_token' : 'user_token',
              clientAuthMethod: event.clientAuthMethod || null
            }
          });
        }
        console.log('[demo-agent/message] Persisted %d token events to chain service', resolvedTokenEvents.length);
      } catch (trackErr) {
        // Non-fatal: if tracking fails, still return the response
        console.error('[demo-agent/message] Failed to track token events:', trackErr.message);
      }
    }

    console.log('[demo-agent/message] Returning agent response');
    const toolsCalled = response.toolsCalled || [];
    const flowOk = response.success !== false;
    appEventService.logEvent(
      'agent',
      flowOk ? 'info' : 'warning',
      `Agent flow end — ${flowOk ? 'success' : 'error'}${toolsCalled.length ? ` · ${toolsCalled.length} tool(s)` : ''}`,
      {
        tag: 'agent/flow-end',
        correlationId: runId,
        metadata: {
          runId,
          success: flowOk,
          toolsCalled,
          ...(useCaseId ? { useCaseId } : {}),
        },
      },
    );
    const responseBody = {
      reply: response.reply,
      success: response.success,
      toolsCalled: response.toolsCalled,
      inputTokens: response.inputTokens ?? 0,
      outputTokens: response.outputTokens ?? 0,
      requiresConsent: response.requiresConsent,
      agentConfigured: response.agentConfigured,
      degradedDelegation: response.degradedDelegation,
      error: response.error,
      // Prepend a 'token-refresh' card if the AT was silently refreshed this request
      // (guarded: no-op when no refresh, and skips if already present).
      tokenEvents: prependRefreshEvent(req, resolvedTokenEvents),
      // Server-authoritative "What's happening" narration ({ steps, finalStatus })
      // for the non-AG-UI (legacy/heuristic) path. The frontend renders
      // vertical-aware copy from the semantic step records.
      activity: buildActivitySteps(response, { clientAuthMethod: exchangeAuthMethod }),
    };

    // Include account data if present (for account details panel display)
    if (response.accountData) {
      responseBody.accountData = response.accountData;
    }
    // Forward HITL signal so the frontend can show the consent modal (Phase 2 shape)
    if (response.error === 'hitl_required' || response.hitl_required) {
      responseBody.error = 'hitl_required';
      responseBody.hitl = { type: response.hitl?.type ?? 'consent' };
      responseBody.hitl_threshold_usd = response.hitl_threshold_usd ?? 0;
    }
    // Include structured list data so client NL handler can infer panel type
    if (response.accounts)              responseBody.accounts      = response.accounts;
    if (response.transactions)          responseBody.transactions  = response.transactions;
    if (response.balance !== undefined) responseBody.balance       = response.balance;

    try {
      reportStore.saveRun({
        runId,
        userId,
        vertical: vertical || response.vertical || 'banking',
        prompt: message,
        startedAt: runStartedAt,
        completedAt: new Date().toISOString(),
        toolsCalled: response.toolsCalled || [],
        tokenEvents: resolvedTokenEvents,
        tokenCount: resolvedTokenEvents.length,
        agentPath: response.agentPath,
        confidence: response.confidence,
        intent: response.intent,
        success: response.success !== false,
        files: [],
      });

      // Save conversation history for continuity
      const verticalForHistory = vertical || response.vertical || 'banking';
      try {
        conversationStore.saveMessage(userId, verticalForHistory, 'user', message, { runId });
        conversationStore.saveMessage(userId, verticalForHistory, 'assistant', response.reply || '', {
          runId,
          intent: response.intent,
          agentPath: response.agentPath,
          success: response.success !== false,
        });
      } catch (convErr) {
        console.warn('[demo-agent/message] conversationStore.saveMessage failed:', convErr.message);
      }
    } catch (saveErr) {
      console.warn('[demo-agent/message] reportStore.saveRun failed:', saveErr.message);
    }

    // Emit result event
    req.eventEmitter.emit(
      'result',
      `Agent processing complete with ${response.success ? 'success' : 'error'}`,
      {
        rfc: 'RFC 7231',
        section: '4.4',
        details: `Status: ${response.success ? 'success' : response.error || 'unknown'}, Tools called: ${response.toolsCalled?.length || 0}`
      },
      response.success ? 'info' : 'warning'
    );

    // Include events in the response
    responseBody.events = req.eventEmitter.getAllEvents();

    return res.json(responseBody);
  } catch (error) {
    console.error('[demo-agent/message] ERROR: Agent message error');
    console.error('[demo-agent/message] Error name:', error.name);
    console.error('[demo-agent/message] Error message:', error.message);
    console.error('[demo-agent/message] Error stack:', error.stack);
    console.error('[demo-agent/message] Error code:', error.code);
    console.error('[demo-agent/message] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Emit error event for all error cases
    req.eventEmitter.emit(
      'error',
      `Agent processing failed: ${error.name || error.code || 'unknown error'}`,
      {
        rfc: 'RFC 7231',
        section: '6',
        details: `Error: ${error.message || 'No details available'}`
      },
      'error'
    );

    // Close the Activity Log bookend even when the run throws.
    if (typeof runId === 'string' && runId) {
      appEventService.logEvent(
        'agent',
        'error',
        `Agent flow end — error · ${error.name || error.code || 'unknown'}`,
        {
          tag: 'agent/flow-end',
          correlationId: runId,
          metadata: {
            runId,
            success: false,
            error: error.message || String(error),
            ...(useCaseId ? { useCaseId } : {}),
          },
        },
      );
    }

    // D-03: Structured recovery responses — agent threw a typed recovery error
    if (error.name === 'LoginRequiredError') {
      const rawScopes = Array.isArray(error.requiredScopes) ? error.requiredScopes : [];
      const validScope = /^[a-z][a-z0-9:_-]*$/;
      const requiredScopes = rawScopes.filter(s => typeof s === 'string' && validScope.test(s));
      return res.status(401).json({ error: 'login_required', requiredScopes, events: req.eventEmitter.getAllEvents() });
    }
    if (error.name === 'HitlRequiredError') {
      return res.status(403).json({
        error: 'hitl_required',
        challengeId: typeof error.challengeId === 'string' ? error.challengeId : '',
        challengeType: error.challengeType === 'step_up' ? 'step_up' : 'consent',
        expiresAt: typeof error.expiresAt === 'string' ? error.expiresAt : '',
        events: req.eventEmitter.getAllEvents()
      });
    }
    if (error.name === 'ScopeRequiredError') {
      const rawScopes = Array.isArray(error.requiredScopes) ? error.requiredScopes : [];
      const validScope = /^[a-z][a-z0-9:_-]*$/;
      const requiredScopes = rawScopes.filter(s => typeof s === 'string' && validScope.test(s));
      return res.status(403).json({ error: 'scope_required', requiredScopes, events: req.eventEmitter.getAllEvents() });
    }
        // TOKEN_INACTIVE — user's PingOne session expired; signal UI to re-authenticate
    if (error.code === 'TOKEN_INACTIVE') {
      return res.status(401).json({ error: 'Session expired', need_auth: true, agentInitRequired: true, events: req.eventEmitter.getAllEvents() });
    }
    // Downstream MCP/gateway rejected the agent's delegated token; the user's BFF
    // session is still valid, so surface inline (502) without forcing a re-login.
    if (error.code === 'GATEWAY_TOKEN_REJECTED') {
      return res.status(error.httpStatus || 502).json({ error: 'gateway_token_rejected', message: error.message, needsLogin: false, events: req.eventEmitter.getAllEvents() });
    }
    // Always return a meaningful error message to the user
    const errorMessage = error.message || 'An unexpected error occurred while processing your request. Please try again.';
    const source = error.source || 'bankingAgentRoutes';
    console.error(`[bankingAgentRoutes] 500 — source=${source} code=${error.code || 'none'}: ${error.message}`);
    res.status(500).json({ error: errorMessage, source, events: req.eventEmitter.getAllEvents() });
  }
});

// POST /consent - Record user consent decision
router.post('/consent', async (req, res) => {
  try {
    const { consentId, approved } = req.body;

    // Validate consentId format (UUID v4) to block prototype-pollution keys.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!consentId || !UUID_RE.test(consentId) || approved === undefined) {
      return res.status(400).json({ error: 'consentId (UUID) and approved required' });
    }

    const userSub =
      req.session?.user?.oauthId ||
      req.session?.user?.id ||
      req.agentContext?.userId ||
      null;

    let entry;
    try {
      entry = await hitlServiceClient.getChallengeStatus(consentId);
    } catch {
      return res.status(404).json({ error: 'Consent request not found or expired' });
    }
    if (entry.userId && userSub && entry.userId !== userSub) {
      return res.status(403).json({ error: 'Consent request belongs to another user.' });
    }
    if (entry.status !== 'pending') {
      return res.status(409).json({ error: 'already_resolved', status: entry.status });
    }

    await recordConsentDecision(consentId, approved ? 'approve' : 'reject');
    res.json({ recorded: true, approved });
  } catch (error) {
    console.error('Consent recording error:', error.message);
    res.status(500).json({ error: 'Failed to record consent decision' });
  }
});

module.exports = router;
