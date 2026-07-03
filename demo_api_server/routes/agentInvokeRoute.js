/**
 * Agent Invoke Route
 * POST /api/agent/invoke — unified agent entry point with intent authorization
 *
 * Flow:
 * 1. UI calls /api/agent/invoke with { prompt }
 * 2. Route calls processAgentMessage() to get agent response
 * 3. Response includes intent + confidence extracted from reasoning/heuristic
 * 4. Route calls /api/authorize-intent to check if intent is authorized
 * 5. If authorized & no consent needed: return response
 * 6. If authorized & consent needed: return 428 (HITL)
 * 7. If not authorized: return 403 (Forbidden)
 */

const express = require('express');
const crypto = require('crypto');
const { processAgentMessage } = require('../services/demoAgentLangGraphService');
const { evaluateIntentAuthorization } = require('../services/intentAuthService');
const { extractIntentAndConfidence } = require('../services/nlIntentParser');
const { evaluateRiskAndAuthority } = require('../services/intentRiskScorer');
const { authenticateToken } = require('../middleware/auth');
const { agentSessionMiddleware } = require('../middleware/agentSessionMiddleware');
const configStore = require('../services/configStore');
const appEventService = require('../services/appEventService');
const { guardPromptInput } = require('../services/promptGuard');
const { parseVerticalParam } = require('../services/nlIntentParser');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');
const { mintIntentToken } = require('../services/intentTokenService');
const { buildTokenEvent, decodeJwtClaims, resolveMcpAccessTokenWithEvents, buildSessionPreviewTokenEvents } = require('../services/agentMcpTokenService');

const router = express.Router();

/**
 * Extract intent and confidence from user prompt using heuristic NL parser.
 * This enables PRE-EXECUTION intent gating before the agent runs tools.
 *
 * Returns { intent, confidence, toolName } where:
 *   - intent: normalized intent label (e.g., "transfer", "view_balance")
 *   - confidence: 0–1 score based on NL match quality
 *   - toolName: the tool that would execute this intent
 */
function extractIntentFromPrompt(prompt) {
  return extractIntentAndConfidence(prompt);
}

/**
 * Extract intent from agent response for fallback/logging.
 * Used when pre-execution gate is disabled or for secondary verification.
 */
function extractIntentFromResponse(response) {
  const toolName = response.toolsCalled?.[0];
  const toolToIntent = {
    get_accounts: 'view_accounts',
    get_balance: 'view_balance',
    get_transactions: 'view_transactions',
    get_my_accounts: 'view_accounts',
    get_my_transactions: 'view_transactions',
    get_account_balance: 'view_balance',
    create_transfer: 'transfer',
    create_deposit: 'deposit',
    create_withdrawal: 'withdraw',
    get_sensitive_account_details: 'view_sensitive_account',
  };

  const intent = toolToIntent[toolName] || toolName || 'unknown';
  // Real confidence from agent if available, otherwise fallback to path-based constant
  const confidence = response.confidence || (response.agentPath === 'heuristic' ? 0.95 : 0.7);

  return { intent, confidence };
}

/**
 * POST /api/agent/invoke
 * Process a user prompt through the agent with intent-based authorization
 *
 * Flow (with pre-execution intent gating):
 * 1. Extract intent from user prompt using heuristic NL parser (pre-execution)
 * 2. If intent authorization enabled: evaluate intent BEFORE calling agent
 * 3. If intent denied pre-execution: return 403 immediately (don't run agent)
 * 4. If intent requires consent pre-execution: return 428 for HITL approval
 * 5. If intent approved pre-execution OR feature disabled: call agent
 * 6. Verify intent again post-execution for secondary validation
 *
 * Request body:
 *   { prompt: string }
 *
 * Response:
 *   (same as /api/demo-agent/message)
 */
router.post('/agent/invoke', authenticateToken, agentSessionMiddleware, express.json(), async (req, res) => {
  // Hoist flowTraceId so the catch block can stamp NDJSON error events with it.
  const flowTraceId = typeof req.body?.flowTraceId === 'string' ? req.body.flowTraceId.trim() : null;
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }

    if (prompt.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    const verticalRaw = req.body?.vertical;
    if (verticalRaw !== undefined && verticalRaw !== null && parseVerticalParam(verticalRaw) === null) {
      return res.status(400).json({ error: 'invalid_vertical', message: 'vertical must match [a-z][a-z0-9-]*' });
    }
    const vertical = parseVerticalParam(verticalRaw);

    const promptBlock = guardPromptInput(prompt);
    if (promptBlock) {
      return res.status(promptBlock.status).json(promptBlock.body);
    }

    // Ensure tokenEvents array exists (agentSessionMiddleware populates
    // req.agentContext.tokenEvents, but this route threads req.tokenEvents).
    if (!req.tokenEvents) req.tokenEvents = [];

    console.log('[agentInvokeRoute] Processing prompt', { vertical });
    const userId = req.user.sub;
    const runId = crypto.randomUUID();
    const runStartedAt = new Date().toISOString();
    const intentAuthorizationEnabled = configStore.getEffective('ff_intent_authorization_enabled') === 'true';

    // ── PHASE 1: PRE-EXECUTION INTENT GATING ──
    // Extract intent from prompt BEFORE calling agent
    let preExecutionIntent = null;
    let preExecutionConfidence = null;
    let preExecutionDecision = null;

    if (intentAuthorizationEnabled) {
      console.log('[agentInvokeRoute] Extracting intent from prompt (pre-execution)');
      const { intent, confidence, toolName } = extractIntentFromPrompt(prompt);
      preExecutionIntent = intent;
      preExecutionConfidence = confidence;

      console.log('[agentInvokeRoute] Pre-execution intent:', { intent, confidence, toolName });

      // Evaluate intent + risk + authority BEFORE agent execution
      if (intent !== 'unknown') {
        preExecutionDecision = await evaluateIntentAuthorization({
          intent,
          confidence,
          toolName,
        });

        console.log('[agentInvokeRoute] Pre-execution intent decision:', preExecutionDecision);

        // DENY: reject immediately, don't run agent
        if (!preExecutionDecision.authorized) {
          console.log('[agentInvokeRoute] Intent denied pre-execution, returning 403');
          appEventService.logEvent('intent_auth', 'warning', {
            phase: 'pre-execution',
            intent,
            confidence,
            decision: 'deny',
            reason: preExecutionDecision.reason,
            userId,
          }, { flowId: flowTraceId });
          return res.status(403).json({
            error: 'intent_not_authorized',
            message: preExecutionDecision.reason,
            intent,
            confidence,
          });
        }

        // CONSENT REQUIRED: gate before execution
        if (preExecutionDecision.requires_consent) {
          console.log('[agentInvokeRoute] Intent requires consent pre-execution, returning 428');
          appEventService.logEvent('intent_auth', 'info', {
            phase: 'pre-execution',
            intent,
            confidence,
            decision: 'consent_required',
            reason: preExecutionDecision.reason,
            userId,
          }, { flowId: flowTraceId });
          return res.status(428).json({
            requiresConsent: true,
            consentId: null,
            action: toolName,
            message: preExecutionDecision.reason,
            tokenEvents: req.tokenEvents || [],
            intentAuthDecision: preExecutionDecision,
          });
        }
      }
    }

    // ── INTENT TOKEN: mint at prompt receipt, before agent runs ──────────────
    // Cryptographically binds the original intent so downstream tool calls
    // can be validated against it at the MCP gateway.
    const intentTokenEnabled = configStore.getEffective('ff_intent_token_enabled') !== 'false';

    if (intentTokenEnabled) {
      const { intent: _itIntent, confidence: _itConf } = extractIntentFromPrompt(prompt);
      const { token: _intentToken } = mintIntentToken({
        userId,
        sessionId: req.session.id,
        prompt,
        intent: _itIntent,
        confidence: _itConf,
        vertical,
      });
      req.intentToken = _intentToken;
      const _itDecoded = decodeJwtClaims(_intentToken);
      req.tokenEvents.push(buildTokenEvent(
        'intent-token',
        'Intent Token — prompt bound at origin (BFF-minted)',
        'active',
        _itDecoded,
        `The BFF extracted intent "${_itIntent}" (confidence ${_itConf}) from your prompt and minted a ` +
          'cryptographically signed Intent Token (HMAC-SHA256). The token\'s permitted_tools claim lists ' +
          'the MCP tools this intent is allowed to invoke. The MCP gateway validates this binding before ' +
          'forwarding any tool call — preventing the agent from invoking tools outside the stated intent.',
        {
          rfc: 'draft-ietf-oauth-intent-token',
          intent: _itIntent,
          confidence: _itConf,
          permitted_tools: _itDecoded?.claims?.permitted_tools ?? [],
        }
      ));
      console.log('[agent/invoke] Intent Token minted: intent=%s confidence=%s', _itIntent, _itConf);
      appEventService.logEvent('intent_token', 'info', `Intent Token minted: ${_itIntent}`, {
        metadata: { intent: _itIntent, confidence: _itConf, userId },
        flowId: flowTraceId,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── PHASE 2: AGENT EXECUTION ──
    // Authorized pre-execution (or gate disabled), now call the agent
    // Pass a fresh array so processAgentMessage accumulates its own events.
    // We merge pre-execution events (intent token, auth) below after the call.
    const agentTokenEvents = [];
    const agentResponse = await processAgentMessage({
      message: prompt,
      userId,
      userToken: req.session?.oauthTokens?.accessToken,
      sessionId: req.session.id,
      tokenEvents: agentTokenEvents,
      langchainConfig: req.session?.langchain_config || {},
      vertical,
      req,
    });

    console.log('[agentInvokeRoute] Agent response received, toolsCalled:', agentResponse.toolsCalled);

    // Prepend pre-execution token events (intent token, auth events) collected
    // on req.tokenEvents before the processAgentMessage call.
    if (req.tokenEvents && req.tokenEvents.length > 0) {
      agentResponse.tokenEvents = [
        ...req.tokenEvents,
        ...(agentResponse.tokenEvents || []),
      ];
    }

    // ── TOKEN CHAIN FALLBACK ──────────────────────────────────────────────────
    // The heuristic path returns tokenEvents: [] even when tools were called.
    // Mirror the /message route: resolve the full OAuth chain from the session
    // so the report contains user-auth → introspection → exchange → delegation.
    const mergedTokenEvents = agentResponse.tokenEvents || [];
    const preExecEvents = req.tokenEvents || [];
    const heuristicTokensEmpty = mergedTokenEvents.length <= preExecEvents.length &&
      (agentResponse.toolsCalled?.length ?? 0) > 0;
    if (heuristicTokensEmpty) {
      try {
        const toolName = agentResponse.toolsCalled[0];
        const resolved = await resolveMcpAccessTokenWithEvents(req, toolName);
        const resolvedEvents = resolved.tokenEvents || [];
        if (resolvedEvents.length > 0) {
          agentResponse.tokenEvents = [...preExecEvents, ...resolvedEvents];
          console.log('[agentInvokeRoute] Resolved %d token events for heuristic tool call (%s)',
            resolvedEvents.length, toolName);
        }
      } catch (tokenErr) {
        const fallback = tokenErr.tokenEvents || [];
        if (fallback.length > 0) {
          agentResponse.tokenEvents = [...preExecEvents, ...fallback];
        } else {
          try {
            const preview = await buildSessionPreviewTokenEvents(req);
            const previewEvents = preview.tokenEvents || [];
            if (previewEvents.length > 0) {
              agentResponse.tokenEvents = [...preExecEvents, ...previewEvents];
            }
          } catch (_) { /* non-fatal */ }
        }
        console.log('[agentInvokeRoute] Token event resolution failed (%s), using %d fallback events',
          tokenErr.code || tokenErr.message, (agentResponse.tokenEvents || []).length - preExecEvents.length);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── PHASE 3: POST-EXECUTION INTENT VERIFICATION ──
    // Extract intent from response for verification + logging
    const { intent: postIntent, confidence: postConfidence } = extractIntentFromResponse(agentResponse);
    agentResponse.intent = postIntent;
    agentResponse.confidence = postConfidence;

    const transactionAmount = agentResponse.amount || agentResponse.hitl_threshold_usd;
    console.log('[agentInvokeRoute] Post-execution intent:', { intent: postIntent, confidence: postConfidence, transactionAmount });

    // If pre-execution gate was applied, compare with post-execution intent
    // (optional: detect if agent deviated from pre-extracted intent)
    if (intentAuthorizationEnabled && preExecutionIntent && preExecutionIntent !== 'unknown') {
      if (postIntent !== preExecutionIntent) {
        console.log('[agentInvokeRoute] Post-execution intent differs from pre-execution', {
          pre: preExecutionIntent,
          post: postIntent,
        });
        appEventService.logEvent('intent_auth', 'warning', 'Post-execution intent deviation detected', {
          metadata: {
            phase: 'post-execution',
            preExecutionIntent,
            postExecutionIntent: postIntent,
            deviation: true,
            userId,
          },
          flowId: flowTraceId,
        });
      }
    }

    // ── PHASE 4: PERSIST RUN RECORD ──
    // Persist only genuine token-chain events. Operational trace events recorded
    // via req.recordTokenEvent have the shape { type, timestamp, ...data } with no
    // id/label/status/eventType, so they render as blank "Event / unknown" rows in
    // the report's OAuth Token Chain section. Drop them from the persisted run (the
    // live agentResponse.tokenEvents returned to the client is left untouched).
    const reportTokenEvents = (agentResponse.tokenEvents || []).filter(
      (e) => e && (e.eventType || e.id || e.label || e.status)
    );
    try {
      reportStore.saveRun({
        runId,
        userId,
        vertical: vertical || 'banking',
        prompt,
        startedAt: runStartedAt,
        completedAt: new Date().toISOString(),
        toolsCalled: agentResponse.toolsCalled || [],
        tokenEvents: reportTokenEvents,
        tokenCount: reportTokenEvents.length,
        agentPath: agentResponse.agentPath,
        confidence: agentResponse.confidence,
        intent: postIntent,
        success: agentResponse.success !== false,
        files: [],
      });

      // Save conversation history for continuity
      const verticalForHistory = vertical || 'banking';
      try {
        conversationStore.saveMessage(userId, verticalForHistory, 'user', prompt, { runId });
        conversationStore.saveMessage(userId, verticalForHistory, 'assistant', agentResponse.reply || '', {
          runId,
          intent: postIntent,
          agentPath: agentResponse.agentPath,
          success: agentResponse.success !== false,
        });
      } catch (convErr) {
        console.warn('[agentInvokeRoute] conversationStore.saveMessage failed:', convErr.message);
      }
    } catch (e) {
      console.warn('[agentInvokeRoute] reportStore.saveRun failed:', e.message);
    }

    // ── PHASE 5: RETURN RESPONSE ──
    agentResponse.runId = runId;
    return res.json(agentResponse);
  } catch (error) {
    console.error('[agentInvokeRoute] Error:', error.message);
    appEventService.logEvent('intent_auth', 'error', 'Agent invocation error', {
      metadata: {
        error: error.message,
        userId: req.user?.sub,
      },
      flowId: flowTraceId,
    });
    // Dead/expired user token: surface as 401 so the SPA can trigger re-auth
    // instead of treating it as a generic server error.
    if (error.code === 'TOKEN_INACTIVE') {
      return res.status(401).json({
        error: 'token_inactive',
        message: 'Your session is no longer active. Please sign in again.',
      });
    }
    // Downstream MCP/gateway rejected the agent's delegated token while the user's
    // BFF session is still valid — surface inline (502) instead of a 401 the SPA
    // would treat as a session expiry and force a re-login.
    if (error.code === 'GATEWAY_TOKEN_REJECTED') {
      return res.status(error.httpStatus || 502).json({
        error: 'gateway_token_rejected',
        message: error.message,
        needsLogin: false,
      });
    }
    res.status(500).json({ error: 'Agent invocation failed', message: error.message });
  }
});

module.exports = router;
