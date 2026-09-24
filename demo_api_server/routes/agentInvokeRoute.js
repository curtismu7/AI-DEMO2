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
const { agentGuestSessionMiddleware } = require('../middleware/agentSessionMiddleware');

// Pass through as guest when no session token and no Authorization header.
// Uses authenticateToken for the validated path so mocks in tests work unchanged.
const optionalAuthenticateToken = (req, res, next) => {
  const hasAuthHeader = !!(req.headers['authorization']?.split(' ')[1]);
  const hasSessionToken = !!(req.session?.oauthTokens?.accessToken) &&
    req.session.oauthTokens.accessToken !== '_cookie_session';
  if (!hasAuthHeader && !hasSessionToken) {
    req.user = null;
    return next();
  }
  return authenticateToken(req, res, next);
};
const configStore = require('../services/configStore');
const appEventService = require('../services/appEventService');
const { guardPromptInput } = require('../services/promptGuard');
const mcpFlowSseHub = require('../services/mcpFlowSseHub');
const { parseVerticalParam, parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { toolForAction } = require('../services/stepVerificationExpectations');
const { resolveAgentMode } = require('../services/agentModeResolver');
const { stampUseCaseId, stampVertical } = require('../services/useCaseTagging');
const { verticalManifest } = require('../services/verticalManifest');
const reportStore = require('../services/lmdb/reportStore.lmdb');
const conversationStore = require('../services/lmdb/conversationStore.lmdb');
const { mintIntentToken } = require('../services/intentTokenService');
const { buildTokenEvent, decodeJwtClaims, resolveMcpAccessTokenWithEvents, buildSessionPreviewTokenEvents } = require('../services/agentMcpTokenService');
const agentBuilderService = require('../services/agentBuilderService');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases');
const scopeTopology = require('../services/scopeTopology');
const { nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware');
const pingOneProtectService = require('../services/pingOneProtectService');

const router = express.Router();

/**
 * Never send a silent reply. Called at the single exit for every agent turn, so
 * it is the server-side net for ANY path that produced an empty reply (a
 * reasoning model spent its whole budget thinking, a service returned '', a new
 * vertical forgot its canned text). Card envelopes (consent / customer-login)
 * carry their own UI and are exempt; everything else must say something.
 * Logged as agent/empty_reply (mirroring agent/truncated) so recurrence shows up
 * in the activity feed instead of waiting for a live demo to fail.
 * Mutates and returns the envelope; sets empty_reply:true when it fired.
 */
function ensureNonEmptyReply(agentResponse) {
  if (!agentResponse || typeof agentResponse !== 'object') return agentResponse;
  const replyEmpty = typeof agentResponse.reply !== 'string' || !agentResponse.reply.trim();
  if (!replyEmpty || agentResponse.requiresConsent || agentResponse.requiresCustomerLogin) {
    return agentResponse;
  }
  console.warn('[agentInvokeRoute] empty agent reply intercepted — substituting notice', {
    agentPath: agentResponse.agentPath, success: agentResponse.success, error: agentResponse.error,
  });
  try {
    const appEventService = require('../services/appEventService');
    appEventService.logEvent('agent', 'warning',
      'Agent returned an EMPTY reply — substituted an honest notice',
      { tag: 'agent/empty_reply', metadata: { agentPath: agentResponse.agentPath || null, error: agentResponse.error || null } });
  } catch (_) { /* telemetry must never block the reply */ }
  agentResponse.empty_reply = true;
  agentResponse.reply =
    'The agent produced no reply for this turn — your request was understood, but no text ' +
    'came back from the selected provider. Try again, or switch Agent mode to Heuristics ' +
    'for a deterministic answer.';
  return agentResponse;
}

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
router.post('/agent/invoke', optionalAuthenticateToken, agentGuestSessionMiddleware, express.json(), nrTransactionMiddleware, async (req, res) => {
  let protectEvaluation = null;
  let protectTokenEvent = null;
  let protectCompletionAttempted = false;
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
    // Body param wins; otherwise fall back to the session's pinned vertical the
    // same way agentRun.js does. Without this the two agent routes disagreed:
    // a caller that omitted `vertical` got banking data even in a session that
    // had switched vertical, because null flows downstream as the banking
    // fallback. The browser always sends the body param, so this only affects
    // callers that don't — where silently answering as banking is the worst
    // available outcome (it reads as "the vertical broke", not "you omitted it").
    const vertical = parseVerticalParam(verticalRaw)
      || verticalManifest.resolver.activeIdFor(req)
      || null;

    const requestedUseCaseId = typeof req.body?.useCaseId === 'string' ? req.body.useCaseId.trim() : null;
    const catalogUseCase = requestedUseCaseId && USE_CASES.find((entry) => entry.useCaseId === requestedUseCaseId);
    if (req.body?.useCaseId != null && !catalogUseCase) {
      return res.status(400).json({ error: 'invalid_use_case' });
    }
    if (req.body?.toolName !== undefined) {
      return res.status(400).json({ error: 'tool_selection_not_allowed' });
    }
    const isWorkloadAgent = requestedUseCaseId === 'personal-agent-concierge'
      || requestedUseCaseId === 'workload-digital-assistant-obo';
    let workloadScenario = null;
    if (isWorkloadAgent) {
      workloadScenario = VERTICALS.includes(verticalRaw) && catalogUseCase.perVertical?.[verticalRaw]
        ? resolveUseCase(catalogUseCase.id, verticalRaw)
        : null;
      if (!workloadScenario?.primaryTool || !workloadScenario.runPrompt ||
          !scopeTopology.allTools().includes(workloadScenario.primaryTool)) {
        return res.status(400).json({ error: 'invalid_workload_mapping' });
      }
      if (prompt !== workloadScenario.runPrompt) {
        return res.status(400).json({ error: 'invalid_workload_action' });
      }
      const heuristic = parseHeuristic(workloadScenario.runPrompt, verticalRaw, resolveVerticalCtx(verticalRaw), {});
      const action = heuristic?.banking?.action || heuristic?.action;
      if (!action || toolForAction(action, verticalRaw) !== workloadScenario.primaryTool) {
        return res.status(400).json({ error: 'invalid_workload_mapping' });
      }
      // Bind this catalog action to the deterministic dispatch even when the
      // session selected LLM-only mode. No client-supplied tool name is used.
      req.body.forceHeuristic = true;
    }

    const promptBlock = guardPromptInput(prompt);
    if (promptBlock) {
      return res.status(promptBlock.status).json(promptBlock.body);
    }

    // Ensure tokenEvents array exists (agentSessionMiddleware populates
    // req.agentContext.tokenEvents, but this route threads req.tokenEvents).
    if (!req.tokenEvents) req.tokenEvents = [];

    const isGuest = !req.agentContext;
    console.log('[agentInvokeRoute] Processing prompt', { vertical, isGuest });
    const userId = req.user?.sub || null;
    const runId = crypto.randomUUID();
    const runStartedAt = new Date().toISOString();
    const intentAuthorizationEnabled = configStore.getEffective('ff_intent_authorization_enabled') === 'true';

    // ── PERSONAL AGENT CONCIERGE PRE-CHECK (UC38) ──────────────────────────────
    // Must run before intent gating: the checks are identity-layer (MFA + agent
    // registration), not intent-layer. If either fails we return immediately
    // without running the agent, so we don't burn LLM calls on an invalid setup.
    if (requestedUseCaseId === 'personal-agent-concierge' || requestedUseCaseId === 'workload-digital-assistant-obo' || requestedUseCaseId === 'saas-embedded-worker') {
      if (!req.user) {
        return res.status(401).json({ error: 'authentication_required', message: 'Sign in to use the personal agent concierge.' });
      }

      // UC38 requires MFA — acr claim set by PingOne when acr_values was honoured.
      const tokenAcr = req.user.acr || '';
      const hasMfa = /multi.factor|multi_factor|mfa/i.test(String(tokenAcr));
      if ((requestedUseCaseId === 'personal-agent-concierge' || requestedUseCaseId === 'saas-embedded-worker') && !hasMfa) {
        const stepUpAcr = configStore.getEffective('stepUpAcrValue') || 'Multi_Factor';
        appEventService.logEvent('personal_agent', 'info', 'UC38: MFA step-up required before delegation',
          { tag: 'personal_agent/step_up_required', metadata: { userId, tokenAcr } });
        return res.status(200).json({
          reply: 'Your personal agent needs to verify your identity before acting on your behalf. Please complete multi-factor authentication.',
          success: false,
          toolsCalled: [],
          agentConfigured: true,
          error: 'step_up_required',
          step_up_required: true,
          step_up_method: 'p1mfa',
          step_up_acr: stepUpAcr,
          tokenEvents: req.tokenEvents || [],
        });
      }

      // Require a registered personal agent.
      const agentType = requestedUseCaseId === 'saas-embedded-worker' ? 'saas-embedded-worker' : 'personal';
      let personalAgent = null;
      let workloadAgentRuntime = null;
      let runtimeLookupFailed = false;
      try {
        if (req.session?.user && isWorkloadAgent) {
          workloadAgentRuntime = await agentBuilderService.getRuntimeForUser(req.session.user, agentType);
          personalAgent = workloadAgentRuntime?.agent || null;
        } else {
          personalAgent = req.session?.user ? await agentBuilderService.getAgentForUser(req.session.user, agentType) : null;
        }
      } catch (_err) {
        runtimeLookupFailed = isWorkloadAgent;
        // Treat lookup failure as unregistered rather than a hard 502.
        personalAgent = null;
      }

      if (runtimeLookupFailed) {
        return res.status(409).json({
          error: 'workload_agent_runtime_unavailable',
          message: 'The registered workload agent is not ready to run. It must be enabled, support client_credentials, and have a readable PingOne client secret.',
          tokenEvents: req.tokenEvents || [],
        });
      }

      if (!personalAgent) {
        appEventService.logEvent('personal_agent', 'warning', 'UC38: no personal agent registered for user',
          { tag: 'personal_agent/not_registered', metadata: { userId } });
        return res.status(200).json({
          reply: 'No personal agent is registered for your account. Visit the Agent Builder page to create your personal agent, then try again.',
          success: false,
          toolsCalled: [],
          agentConfigured: false,
          error: 'agent_not_registered',
          tokenEvents: req.tokenEvents || [],
        });
      }

      if (isWorkloadAgent) {
        // Request-local BFF credentials bind the actual OAuth actor_token to
        // the same customer-owned PingOne app checked above. Never send these
        // credentials in the response or token-event metadata.
        req.workloadAgentRuntime = {
          clientId: workloadAgentRuntime.clientId,
          clientSecret: workloadAgentRuntime.clientSecret,
          authMethod: workloadAgentRuntime.authMethod,
        };
      }

      // CIMD is a mocked registration facade. Retry a pending/failed facade
      // record on agent use, but never let that optional evidence path block
      // the real PingOne-backed delegation below.
      try {
        await agentBuilderService.ensurePersonalAgentCimd(req.session.user, personalAgent, { agentType });
      } catch (err) {
        console.warn('[agentInvokeRoute] CIMD retry failed:', err?.message || String(err));
      }

      // Surface the personal agent identity in the Flow Inspector.
      const workloadScopes = workloadScenario
        ? scopeTopology.toolScopes(workloadScenario.primaryTool)
        : null;
      const scopeDescription = workloadScopes?.length
        ? `The selected ${vertical} action uses ${workloadScenario.primaryTool} and requires ${workloadScopes.join(', ')}. `
        : '';
      req.tokenEvents.push(buildTokenEvent(
        'personal-agent-lookup',
        `${agentType === 'saas-embedded-worker' ? 'Website Worker' : 'Personal Agent'} — ${personalAgent.name} (${personalAgent.type}) registered`,
        'active',
        null,
        `BFF verified that the customer-owned ${agentType === 'saas-embedded-worker' ? 'website worker' : 'personal agent'} "${personalAgent.name}" (PingOne application ${personalAgent.id}${isWorkloadAgent ? `, OAuth client ${workloadAgentRuntime.clientId}` : ''}) is registered. ` +
          (isWorkloadAgent
            ? `${scopeDescription}This same application supplies the client-credentials actor token for RFC 8693; the customer remains the subject, and gateway/Authorize policy decides whether the action is permitted.`
            : 'The existing agent registration and delegation checks remain in effect.'),
        { agentId: personalAgent.id, agentName: personalAgent.name, agentType: personalAgent.type },
      ));
      appEventService.logEvent('personal_agent', 'info', `${requestedUseCaseId}: ${agentType === 'saas-embedded-worker' ? 'website worker' : 'personal agent'} "${personalAgent.name}" verified`,
        { tag: 'personal_agent/verified', metadata: { userId, agentId: personalAgent.id } });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Platform wiring enters a separate runtime before processAgentMessage's
    // heuristic gate. Check only after customer and registration verification.
    if (isWorkloadAgent && resolveAgentMode(
      configStore.getEffective('agent_mode'), configStore.getEffective('agent_external_wiring')
    ).externalWiring === 'platform') {
      return res.status(409).json({ error: 'workload_action_requires_bff_wiring' });
    }

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

    // Hoisted for the cross-vertical mismatch guard below (which runs after the
    // agent responds, outside this block): what the pre-execution parser saw.
    let _itIntent = null;
    let _itConf = 0;

    if (intentTokenEnabled) {
      // Vertical-aware: the regex extractor alone classifies most vertical
      // chips as "unknown", whose permitted_tools exclude the sensitive reads
      // UC2/UC2.5 delegate — see extractIntentAndConfidence.
      ({ intent: _itIntent, confidence: _itConf } = extractIntentAndConfidence(prompt, vertical));
      const { token: _intentToken } = mintIntentToken({
        userId,
        sessionId: req.session?.id || null,
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
    if (flowTraceId) {
      const claim = mcpFlowSseHub.ensurePostTrace(flowTraceId, req.sessionID);
      if (claim === 'ok') {
        mcpFlowSseHub.publish(flowTraceId, {
          phase: 'request_accepted',
          label: 'Agent invoke accepted',
          detail: prompt.slice(0, 120),
        });
      }
    }
    const agentTokenEvents = [];
    if (requestedUseCaseId === 'protect-agent-dispatch-risk' && configStore.getEffective('ff_protect_agent_dispatch') === 'true') {
      if (!userId) return res.status(401).json({ error: 'protect_requires_signed_in_user', need_auth: true });
      protectEvaluation = await pingOneProtectService.createAgentDispatchEvaluation({
        user: { id: userId, name: req.user?.email || req.user?.username || null },
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        signalsData: typeof req.body?.protectSignalsData === 'string' && req.body.protectSignalsData.length <= 250000
          ? req.body.protectSignalsData
          : undefined,
        sessionId: req.session?.id,
      });
      protectTokenEvent = pingOneProtectService.toTokenEvent(protectEvaluation);
      req.tokenEvents.push(protectTokenEvent);
      if (protectTokenEvent.blocked) {
        protectCompletionAttempted = true;
        try {
          await pingOneProtectService.completeEvaluation(protectEvaluation.id, 'FAILED');
          protectTokenEvent.completionStatus = 'FAILED';
        } catch (completionError) {
          protectTokenEvent.completionStatus = 'UPDATE_FAILED';
          console.warn('[agentInvokeRoute] Protect block update failed:', completionError.message);
        }
        return res.json({
          reply: `PingOne Protect evaluated this browser as ${protectTokenEvent.level}${protectTokenEvent.recommendedAction ? ` (${protectTokenEvent.recommendedAction})` : ''}. The demo dispatch policy blocked the agent action.`,
          success: false,
          toolsCalled: [],
          tokenEvents: req.tokenEvents,
          protectRiskEvaluation: protectTokenEvent,
        });
      }
    }
    const agentResponse = await processAgentMessage({
      message: prompt,
      userId,
      userToken: req.session?.oauthTokens?.accessToken || null,
      sessionId: req.session?.id || null,
      tokenEvents: agentTokenEvents,
      langchainConfig: req.session?.langchain_config || {},
      vertical,
      isGuest,
      req,
    });

    if (protectEvaluation?.id) {
      const completed = agentResponse.success !== false && (agentResponse.toolsCalled?.length ?? 0) > 0;
      protectCompletionAttempted = true;
      try {
        await pingOneProtectService.completeEvaluation(protectEvaluation.id, completed ? 'SUCCESS' : 'FAILED');
        protectTokenEvent.completionStatus = completed ? 'SUCCESS' : 'FAILED';
      } catch (completionError) {
        protectTokenEvent.completionStatus = 'UPDATE_FAILED';
        console.warn('[agentInvokeRoute] Protect completion update failed:', completionError.message);
      }
      agentResponse.protectRiskEvaluation = protectTokenEvent;
    }

    console.log('[agentInvokeRoute] Agent response received, toolsCalled:', agentResponse.toolsCalled);

    // ── CROSS-VERTICAL INTENT MISMATCH GUARD ─────────────────────────────────
    // The pre-execution intent regexes are vertical-blind (nlIntentParser.js),
    // so "extend my rental $300" mints intent=extend_rental in ANY vertical.
    // But the heuristic dispatch runs against the ACTIVE vertical only: in a
    // vertical that has no such action, the prompt falls through to the LLM
    // reason loop, whose tool list does not contain the intent's tool — so the
    // model answers as chat ("which account? landlord details?") and the demo
    // silently does nothing (observed live 2026-09-22). Detect exactly that:
    // no tool ran, the minted intent has a toolName, and that tool belongs to
    // a DIFFERENT vertical's plugin. Reply with a guidance card naming the
    // right vertical instead of letting the LLM freestyle.
    if ((agentResponse.toolsCalled?.length ?? 0) === 0 && _itIntent && _itIntent !== 'unknown' && (_itConf ?? 0) >= 0.5) {
      try {
        const { verticalManifest: _vm } = require('../services/verticalManifest');
        const intentTool = _itIntent; // vertical regexes set toolName === intent
        const ownerVerticals = [];
        for (const { id: vid } of _vm.listAll()) {
          if (vid === vertical) continue;
          const plugin = _vm.plugins.get(vid);
          if (!plugin || typeof plugin.getTools !== 'function') continue;
          const names = plugin.getTools().map((t) => t && t.name);
          if (names.includes(intentTool)) ownerVerticals.push(vid);
        }
        if (ownerVerticals.length > 0 && ownerVerticals[0] !== vertical) {
          const owner = ownerVerticals[0];
          console.log('[agentInvokeRoute] Cross-vertical intent mismatch: intent=%s active=%s owner=%s — replying with switch hint', _itIntent, vertical, owner);
          return res.json({
            reply: `That request is a **${owner.replace(/-/g, ' ')}** action, but your session is pinned to **${String(vertical || 'banking').replace(/-/g, ' ')}**. Switch the vertical picker at the top of the page to continue — this action routes through that vertical's own MCP tools and authorization policies.`,
            success: true,
            toolsCalled: [],
            tokensUsed: 0,
            requiresConsent: false,
            agentConfigured: true,
            tokenEvents: req.tokenEvents || [],
            crossVerticalHint: { intent: _itIntent, activeVertical: vertical, ownerVertical: owner },
          });
        }
      } catch (_e) { /* diagnostics only — never break the agent path */ }
    }


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
    // Surface the PingOne Authorize evaluation the tool executor stashed on req.
    // On a successful (PERMIT) agent tool call the evaluation lives only inside
    // the pipeline outcome, which executeBffTool returns as a plain string — so
    // without this the Proof trace's authorize-decision step never matched on the
    // success path (UC1 rendered Incomplete though the tool ran). Only set when
    // the agent envelope did not already carry one (deny/HITL paths do).
    if (req._mcpAuthorizeEvaluation && !agentResponse.mcpAuthorizeEvaluation) {
      agentResponse.mcpAuthorizeEvaluation = req._mcpAuthorizeEvaluation;
    }
    if (req._mcpAuthorizeEvaluations && !agentResponse.mcpAuthorizeEvaluations) {
      agentResponse.mcpAuthorizeEvaluations = req._mcpAuthorizeEvaluations;
    }
    // Backfill useCaseId/vertical on every token event this run produced.
    // Deeper emitters (bffMcpToolExecutor, the /api/mcp/tool path in server.js)
    // already stamp the gateway-dispatched chains, and stampUseCaseId never
    // overwrites an existing tag — but a run whose tool never takes that path
    // (get_branch_hours, the A2A delegate_to_specialist chain) reached the
    // client with NOTHING tagged. ProofOfEnforcementContext.firstUseCaseId then
    // found no call-scoped useCaseId, filed no verdict for the run, and
    // ProofStrip rendered nothing at all — the tool had run correctly and the
    // demo's headline proof surface was simply absent (observed live on UC2,
    // UC2.5, UC2.6, UC24 and UC37, 2026-09-08). Same two calls as server.js's
    // chip path, at the one boundary every dispatch path passes through.
    if (Array.isArray(agentResponse.tokenEvents)) {
      stampUseCaseId(agentResponse.tokenEvents, requestedUseCaseId);
      stampVertical(agentResponse.tokenEvents, vertical);
    }
    ensureNonEmptyReply(agentResponse);
    return res.json(agentResponse);
  } catch (error) {
    if (protectEvaluation?.id && !protectCompletionAttempted) {
      protectCompletionAttempted = true;
      try {
        await pingOneProtectService.completeEvaluation(protectEvaluation.id, 'FAILED');
        if (protectTokenEvent) protectTokenEvent.completionStatus = 'FAILED';
      } catch (completionError) {
        if (protectTokenEvent) protectTokenEvent.completionStatus = 'UPDATE_FAILED';
        console.warn('[agentInvokeRoute] Protect failure update failed:', completionError.message);
      }
    }
    console.error('[agentInvokeRoute] Error:', error.message);
    appEventService.logEvent('intent_auth', 'error', 'Agent invocation error', {
      metadata: {
        error: error.message,
        userId: req.user?.sub,
      },
      flowId: flowTraceId,
    });
    // Preserve any exchange/authorize evidence attached to the thrown error so
    // the Token Chain still updates when the invoke path hard-fails.
    const errorTokenEvents = Array.isArray(error.tokenEvents) && error.tokenEvents.length
      ? error.tokenEvents
      : (Array.isArray(req.tokenEvents) ? req.tokenEvents : []);
    if (error.code === 'workload_actor_provider_unsupported') {
      return res.status(409).json({
        error: error.code,
        message: error.message,
        tokenEvents: errorTokenEvents,
      });
    }
    // Dead/expired user token: surface as 401 so the SPA can trigger re-auth
    // instead of treating it as a generic server error.
    if (error.code === 'TOKEN_INACTIVE') {
      return res.status(401).json({
        error: 'token_inactive',
        message: 'Your session is no longer active. Please sign in again.',
        tokenEvents: errorTokenEvents,
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
        tokenEvents: errorTokenEvents,
      });
    }
    res.status(500).json({
      error: 'Agent invocation failed',
      message: error.message,
      tokenEvents: errorTokenEvents,
    });
  }
});

module.exports = router;
// Exported for the never-silent contract test — the guard is the reply
// invariant, not an implementation detail.
module.exports.ensureNonEmptyReply = ensureNonEmptyReply;
