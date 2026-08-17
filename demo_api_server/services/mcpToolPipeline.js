'use strict';

const { HITL_CHALLENGE_ARG } = require('./hitlServiceClient');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { buildGwAuthorizeEventExtra } = require('./agentMcpTokenService');
const { resolveStepUpMethod } = require('./mcpToolAuthorizationService');
const { getUseCaseStepUpMethod } = require('../config/useCases');
const _CAT = LOG_CATEGORIES.MCP_TOOL_PIPELINE;

/**
 * Resolve the user id used for MCP tool audit rows (Token Chain mcpToolCallsChain).
 * Exchange may omit sub on the delegated token; session oauthId/id is the stable key.
 */
function resolveAuditUserId(req, userSub) {
  const sessionUser = req.session?.user;
  return userSub || sessionUser?.oauthId || sessionUser?.id || null;
}

/**
 * The Transaction/Amount secondary decision is a real live PingOne
 * Transaction-endpoint decision (`source: 'transaction-policy'`). The local
 * amount-ladder that used to synthesize one when that endpoint was unreachable
 * (`source: 'transaction-policy-fallback'`) is gone — that path now fails closed.
 * The fallback label is still recognised here so a Token Chain card replayed
 * from an older audit record is not relabelled as a PingOne decision.
 */
function secondaryEvaluationEngine(secondaryEvaluation) {
  return secondaryEvaluation && secondaryEvaluation.source === 'transaction-policy-fallback'
    ? 'local-amount-fallback'
    : 'pingone';
}

/**
 * Split the gate's merged evaluation (mcpAuthorizeEvaluationThisRequest) into
 * the singular field shape every existing consumer reads, plus, when a
 * Transaction/Amount secondary decision fired, the ordered plural array
 * (gate first, secondary second) buildTraceSteps renders as 2 Token Chain
 * cards. Returns null when there's nothing to report (gate skipped/not-run
 * — the input is falsy).
 * @param {object|null|undefined} v
 * @returns {{singular: object, plural: object[]|null}|null}
 */
function splitAuthorizeEvaluation(v) {
  if (!v) return null;
  const { gateEvaluation: _ge, secondaryEvaluation: _se, ...singular } = v;
  const plural = _ge && _se
    ? [
        { ..._ge, engine: 'pingone', decisionContext: 'McpFirstTool' },
        { ..._se, engine: secondaryEvaluationEngine(_se), decisionContext: 'TransactionAmount' },
      ]
    : null;
  return { singular, plural };
}

/**
 * Like splitAuthorizeEvaluation, but for the AG-UI SSE channel only: skip-shape
 * objects ({ran:false, skipped:true, skipReason} — a2a-supplied-token skip, or
 * gate-not-run skip) have no .decision and must never be published as if they
 * were a real PERMIT/DENY (Contract C4 — omission is not permission; the HTTP
 * response body still exposes the raw skip shape via out.mcpAuthorizeEvaluation,
 * this only guards the Token Chain UI's SSE feed from misrepresenting it).
 */
function splitAuthorizeEvaluationForSse(v) {
  const split = splitAuthorizeEvaluation(v);
  return split && split.singular && split.singular.decision != null ? split : null;
}

/**
 * runMcpToolPipeline — pure orchestration of a BFF MCP tool call (ADR-0004).
 * Returns a discriminated Outcome; never touches Express res/req response APIs.
 * Built up path-by-path under characterization tests.
 * @param {object} ctx { tool, params, flowTraceId, startTime, req, deps }
 * @returns {Promise<object>} Outcome { kind:'result'|'block'|'error', httpStatus, body, tokenEvents? }
 *
 * `tokenEvents?` (top-level) is the SSE side-channel mirror, NOT a copy of
 * `body`. Rule: present on every `result` and on `block` returns whose wire
 * `body` already carried events; intentionally absent on `error` and on the
 * `mcpNoBearerResponse` / `mcp_scope_denied` passthroughs whose original
 * server.js body sent none. The route shell must read the top-level field for
 * the SSE publish — never derive it from `body` (ADR-0004; verbatim mirror of
 * the pre-extraction wire shape, so it must not be "normalized").
 */
/**
 * Map a local-handler (callToolLocal) result to the correct pipeline Outcome.
 *
 * The local handler signals human-in-the-loop / step-up by RETURNING a result
 * object with `error: 'hitl_required' | 'step_up_required'` (not by throwing).
 * Before this, both local-fallback sites wrapped that as
 * `{ kind:'result', httpStatus:200, body:{ result } }` — so a transfer that
 * needs approval came back HTTP 200 with the signal buried in the tool text,
 * while the simulated-Authorize gate for the same logical outcome returns
 * HTTP 428. Same meaning, two wire shapes. This normalises the local path to
 * the proper 428 with an actionable message + the consent/step-up kind, so
 * callers (UI, agent, tests) get one consistent contract regardless of which
 * internal path produced it (REGRESSION_PLAN §1 — 428 enforcement).
 *
 * Non-HITL results (success, or ordinary tool errors) keep the existing
 * `kind:'result', httpStatus:200` envelope unchanged.
 */
function localResultOutcome(result, tokenEvents, extraBodyFields) {
  const errCode = result && result.error;
  const isHitl = errCode === 'hitl_required';
  const isStepUp = errCode === 'step_up_required';
  if (isHitl || isStepUp) {
    const hitlType = (result.hitl && result.hitl.type)
      || (isStepUp ? 'step_up' : 'consent');
    return {
      kind: 'block',
      httpStatus: 428,
      tokenEvents,
      body: {
        error: isStepUp ? 'mcp_step_up_required' : 'mcp_hitl_required',
        isError: false,
        error_description: result.message
          || (isStepUp
            ? 'This transaction requires step-up authentication (MFA). Approve it on the dashboard to continue.'
            : 'This transaction requires human approval. Confirm it on the dashboard to continue.'),
        hitl: { type: hitlType },
        ...(typeof result.hitl_threshold_usd !== 'undefined'
          ? { hitl_threshold_usd: result.hitl_threshold_usd }
          : {}),
        // Carry the step-up method/ACR so the client can drive CIBA with the
        // right acr_values (mirrors the transactionAuthorizationService 428 shape).
        ...(isStepUp && result.step_up_method ? { step_up_method: result.step_up_method } : {}),
        ...(isStepUp && result.step_up_acr ? { step_up_acr: result.step_up_acr } : {}),
        authorize_engine: 'local',
        tokenEvents,
        ...extraBodyFields,
      },
    };
  }
  return {
    kind: 'result',
    httpStatus: 200,
    tokenEvents,
    body: { result, tokenEvents, ...extraBodyFields },
  };
}

/**
 * Detect a HITL / step-up signal embedded in an MCP tool RESULT's content.
 *
 * The gateway→backend path can return `isError:false, success:true` while the
 * tool's `content[0].text` is itself a JSON string like
 * `{"error":"hitl_required","hitl":{"type":"consent"},"amount":100,...}`.
 * Phase 170: ALL transfers require consent — so this is a legitimate gate,
 * but it was reaching the client as HTTP 200 with the signal buried in tool
 * text, while the simulated-Authorize path returns 428 for the same outcome.
 * Returns the parsed HITL object ({ error, hitl, message, hitl_threshold_usd })
 * so the caller can normalise it via localResultOutcome → 428. Returns null
 * when the result is an ordinary success.
 */
function hitlSignalInResultContent(result) {
  const content = result && Array.isArray(result.content) ? result.content : null;
  if (!content) return null;
  for (const c of content) {
    if (!c || typeof c.text !== 'string') continue;
    const txt = c.text.trim();
    if (txt[0] !== '{' || !/hitl_required|step_up_required/.test(txt)) continue;
    try {
      const parsed = JSON.parse(txt);
      if (parsed && (parsed.error === 'hitl_required' || parsed.error === 'step_up_required')) {
        return parsed;
      }
    } catch { /* not JSON — ignore */ }
  }
  return null;
}

/**
 * Authorize evidence for a gateway-decided 428. The BFF gate skips on
 * gateway-routed calls (`gateway_authoritative`), so the gateway's own PingOne
 * Authorize call — relayed in x-gw-audit-trail — is the only decision this
 * request has; without surfacing it the run carries no authorize evidence and
 * the Proof strip reports "Run failed before authorize-decision" on a gate
 * that actually fired. Shape mirrors the local gate's `_blockAuthEval`:
 * `decision` is the ENFORCED outcome (INDETERMINATE approval gate), never the
 * raw PERMIT PingOne returns alongside an unfulfilled obligation — the raw
 * response stays inspectable via `response`.
 */
function gatewayBlockAuthEval(gwAuditTrail, outcome, ctx, decision = 'INDETERMINATE') {
  const authz = gwAuditTrail && gwAuditTrail.authorize;
  if (!authz) return null;
  return {
    decision,
    outcome,
    engine: authz.backend === 'simulated' ? 'simulated' : 'pingone',
    decisionContext: 'McpToolCall',
    decisionId: (authz.rawResponse && authz.rawResponse.correlationId) || null,
    request: authz.parameters ? { parameters: authz.parameters } : null,
    response: authz.rawResponse || null,
    ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
    ...(ctx.vertical ? { vertical: ctx.vertical } : {}),
  };
}

async function runMcpToolPipeline(ctx) {
  const { tool, req, deps } = ctx;
  let params = { ...ctx.params };
  // Resolved once and reused for the gateway's X-Active-Vertical header. Same
  // resolver the MCP authz gate uses, so the policy input the gateway sees
  // matches the one the BFF authorized against. Best-effort: a resolver failure
  // must not block a tool call — mcpGatewayClient falls back to the global.
  let sessionVertical = null;
  try {
    sessionVertical = require('./verticalManifest').verticalManifest.resolver.activeIdFor(req) || null;
  } catch (_) { /* fall through to the client's own fallback */ }
  // Full JSON-RPC envelope snapshot (pre-HITL-strip) — used as requestJson in
  // audit store and SSE payload so the MCP Results tab shows the actual wire request.
  // The real bearer token (server.js-injected for e.g. jwt_decode_full) must never
  // reach this display/audit snapshot — it is redacted here only; the actual
  // downstream call further below uses `params` (derived from ctx.params), untouched.
  const argumentsForDisplay = ctx.params && ctx.params.token
    ? { ...ctx.params, token: '[redacted]' }
    : ctx.params;
  const requestJson = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { ...argumentsForDisplay } } };
  const { config } = deps;
  // Hoisted above the authorize-gate block (below) so both the simulated-path
  // gw-authorize pushes (PERMIT and DENY branches) and the real-gateway call
  // site further down can gate on the same value — a call either goes through
  // the real gateway or it doesn't, decided once per pipeline run.
  const useGateway = deps.config.useGateway;

  const flowTraceId = ctx.flowTraceId;
  const startTime = ctx.startTime;
    let mcpAccessToken; // RFC 8693 §3.2: MCP-scoped access token (result of exchange)
    let userSub = null;
    let tokenEvents = [];
    let tratContextHeader = null;
    try {
        deps.emit({
            phase: 'resolving_access_token'
        });
        // BFF performs the single canonical RFC 8693 exchange (user subject +
        // agent actor -> MCP-gateway-audienced token); the gateway and MCP
        // server re-exchange downstream. The mcpWriteToken session cache is
        // bypassed so every tool call produces the complete token chain.
        // A2A specialist path: when a pre-minted token is supplied (the nested-act
        // token from a2aDelegationService's chained exchange), use it directly and
        // SKIP the user→agent exchange. The act chain (act:{specialist, act:{generalist}})
        // then flows into Authorize, where the depth-2 chain is PERMITTED. Events for
        // the chained exchange were already pushed/published by the caller.
        const resolved = ctx.suppliedToken
            ? { token: ctx.suppliedToken, tokenEvents: [], userSub: ctx.suppliedUserSub || null, tratContextHeader: null }
            : await deps.resolveMcpAccessTokenWithEvents(req, tool);
        mcpAccessToken = resolved.token;
        tokenEvents = resolved.tokenEvents;
        userSub = resolved.userSub || null;
        tratContextHeader = resolved.tratContextHeader || null;
        if (resolved.blocked) {
            deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
            return {
                kind: 'block',
                httpStatus: resolved.blockHttpStatus || 403,
                tokenEvents,
                body: {
                    error: resolved.blockCode || 'user_token_forwarding_disabled',
                    message: resolved.blockMessage || 'Raw user-token forwarding to MCP is disabled.',
                    tokenEvents,
                },
            };
        }
        // Publish token events to SSE hub for real-time Token Chain display
        deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
        const evs = tokenEvents || [];
        deps.emit({
            phase: 'access_token_ready',
            hasUserToken: evs.some((e) => e && e.id === 'user-token'),
            exchanged: evs.some((e) => e && e.id === 'exchanged-token'),
            exchangeRequired: evs.some((e) => e && e.id === 'exchange-required'),
        });
    } catch (err) {
        logger.error(_CAT, `[MCP Proxy] Token resolution failed for tool ${tool}: ${err.message}`);
        deps.emit({
            phase: 'access_token_error',
            code: err.code || 'token_exchange_failed'
        });

        // When the exchange fails because the subject token lacks the required scopes
        // (e.g. ENDUSER_AUDIENCE login path only carries agent:invoke, not
        // write), PingOne returns 400 "At least one scope must be granted".
        // In that case, fall back to the local tool handler so the operation still
        // completes — the UI receives _exchangeFailed:true so it can show a soft
        // informational message instead of an error toast.
        //
        // PingOne also returns 401 for token-exchange policy rejections such as
        // "Request denied: Unsupported authentication method" — this happens when the
        // exchanger client (admin OAuth app) is a PKCE Web app whose token-exchange
        // grant or auth method is not configured correctly in PingOne.  These are
        // server-side config errors, not invalid user tokens, so local fallback is safe.
        // We distinguish PingOne-origin 401s from session-guard 401s via err.pingoneError
        // (only set when the 401 response body was parsed from the PingOne token endpoint).
        // missing_exchange_scopes: the user's access token doesn't carry the required scopes.
        // Return a structured 403 so the UI can display an actionable config-fix modal.
        // Do NOT fall back to local tool execution — that would hide the misconfiguration.
        if (err.code === 'missing_exchange_scopes') {
            const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
            deps.publishTokenEventsToSse(flowTraceId, events);
            return { kind: 'block', httpStatus: 403, tokenEvents: events, body: {
                error: 'missing_exchange_scopes',
                message: err.message,
                missingScopes: err.missingScopes || [],
                userScopes: err.userScopes || '',
                requiredScopes: err.requiredScopes || '',
                tokenEvents: events,
            } };
        }

        const sessionUser = req.session ?.user;
        const isExchangeScopeError =
            err.httpStatus === 400 ||
            err.code === 'token_exchange_failed' ||
            (err.httpStatus === 401 && Boolean(err.pingoneError));
        // F5: this fallback runs the tool through the LOCAL handler, bypassing
        // the gateway AND the MCP server — and therefore every authorization
        // check on that path. It is a demo convenience, not a safe default, so
        // it is now opt-in and OFF by default. When enabled, the response is
        // marked degraded (contract C2) so the caller can see the call was not
        // authorized by any policy engine.
        const localFallbackOnExchangeFailure =
            require('./configStore').getEffective('ff_local_fallback_on_exchange_failure') === 'true';
        logger.debug(_CAT,
            `[MCP Fallback] tool=${tool} httpStatus=${err.httpStatus ?? '(none)'} errCode=${err.code ?? '(none)'} pingoneError=${err.pingoneError ?? '(none)'} sessionUserId=${sessionUser?.id ?? '(missing)'} isExchangeScopeError=${isExchangeScopeError} localFallbackEnabled=${localFallbackOnExchangeFailure}`
        );
        const localFallbackApplies = Boolean(sessionUser ?.id) && isExchangeScopeError;
        if (localFallbackApplies && !localFallbackOnExchangeFailure) {
            logger.warn(_CAT,
                `[MCP Fallback] ${tool} — exchange failed and the ungated local fallback is DISABLED ` +
                '(ff_local_fallback_on_exchange_failure=false); surfacing the error instead of running unauthorized.'
            );
        }
        if (localFallbackApplies && localFallbackOnExchangeFailure) {
            const fallbackEvents = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
            deps.publishTokenEventsToSse(flowTraceId, fallbackEvents);
            const effectiveUserId = sessionUser.oauthId || sessionUser.id;
            logger.info(_CAT, `[MCP Local] ${tool} — exchange failed (${err.code ?? err.httpStatus}), falling back to local handler. effectiveUserId=${effectiveUserId}`);
            try {
                deps.emit({
                    phase: 'local_tool_start',
                    path: 'exchange_failed_fallback'
                });
                const result = await deps.callToolLocal(tool, params || {}, effectiveUserId, req);
                deps.emit({
                    phase: 'local_tool_done',
                    path: 'exchange_failed_fallback'
                });
                logger.debug(_CAT, `[MCP Local] ${tool} — local fallback result keys=${result ? Object.keys(result).join(',') : '(null)'} resultError=${result?.error ?? '(none)'}`);
                const _efDuration = Date.now() - startTime;
                deps.publishMcpResultToSse(flowTraceId, { tool, result, durationMs: _efDuration, isDelegated: false, requestJson });
                deps.recordMcpToolCall({ userId: effectiveUserId || 'unknown', toolName: tool, success: !result?.error, duration: _efDuration, requestJson, resultJson: result ?? null, summary: result?.error ? `${tool} failed` : `${tool} completed` });
                return localResultOutcome(result, fallbackEvents, {
                    _localFallback: true,
                    _exchangeFailed: true,
                    // Contract C2 — this result was produced without the
                    // gateway/MCP-server authorization path.
                    _degraded: true,
                    policy_source: 'local-fallback',
                });
            } catch (localErr) {
                logger.error(_CAT, `[MCP Local] ${tool} — callToolLocal threw after exchange failure: ${localErr.message}`, { stack: localErr.stack });
                // Fall through to original error response
            }
        }

        // TOKEN_INACTIVE — user's PingOne session expired; signal UI to re-authenticate
        if (err.code === 'TOKEN_INACTIVE') {
            const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
            deps.publishTokenEventsToSse(flowTraceId, events);
            return { kind: 'error', httpStatus: 401, body: { error: 'Session expired', need_auth: true, agentInitRequired: true, tokenEvents: events } };
        }

        const status = err.httpStatus || 502;
        const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
        deps.publishTokenEventsToSse(flowTraceId, events);
        const errCode = err.error || err.code;  // RFCCompliantError uses .error, not .code
        const requiresLogin = false; // actor_token_invalid is a server config issue; user session expiry is caught by middleware before this
        return { kind: 'error', httpStatus: status, body: {
            error: errCode || 'token_exchange_failed',
            message: err.message,
            tokenEvents: events,
            ...(requiresLogin && { requiresLogin: true }),
        } };
    }

    if (!mcpAccessToken) {
        // No real bearer (cookie-only / unhydrated session). Do NOT fall back to
        // the local handler: that bypasses the gateway, the MCP server, and the
        // PingOne Authorize gate below, so the tool would "succeed" with NO
        // authorization decision and Proof of Enforcement renders "Incomplete" on a
        // call that actually ran. Surface the re-auth block instead
        // (mcpNoBearerResponse already distinguishes the cookie-only
        // 'session_not_hydrated' case from a plain unauthenticated one) so the SPA
        // restores real tokens and the retry runs the real exchange → gateway →
        // Authorize path. Mirrors the exchange-failure fallback (F5), likewise made
        // non-bypassing, and honors restoreSessionFromCookie's own contract that
        // token-needing routes must error for a cookie-restored session.
        deps.emit({
            phase: 'no_bearer_token_branch'
        });
        const r = deps.mcpNoBearerResponse(req, tokenEvents);
        deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
        return { kind: 'block', httpStatus: r.status, body: r.body };
    }

    // Kill switch: the ONE point every real tool call passes through,
    // regardless of whether PingOne Authorize runs locally
    // (evaluateMcpFirstToolGate) or the call is gateway-authoritative
    // (which skips that function entirely) — see the 2026-08-10 final
    // review that found the prior location never ran under the default
    // gateway-enabled deployment.
    const { deriveAgentKey } = require('./sessionKeyService');
    const killSwitchService = require('./killSwitchService');
    const _killUserId = userSub || req.session?.user?.oauthId || req.session?.user?.id || null;
    const _killAgentKey = deriveAgentKey(req, null, _killUserId);
    if (await killSwitchService.isAgentRevoked(_killAgentKey)) {
        deps.emit({ phase: 'kill_switch_blocked' });
        deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
        return {
            kind: 'block',
            httpStatus: 403,
            tokenEvents,
            body: {
                error: 'agent_killed',
                error_description: 'This agent was stopped via the kill switch and cannot make further tool calls.',
                agentId: _killAgentKey,
                tokenEvents,
            },
        };
    }

    // PingOne Authorize (or simulated) on every MCP tool call — docs/PINGONE_AUTHORIZE_PLAN.md §7
    /** @type {object|undefined} */
    let mcpAuthorizeEvaluationThisRequest;
    // Two reasons the BFF does not pre-flight the decision itself:
    //
    //   a2a_supplied_token   — A2A specialist calls (suppliedToken + skipBffAuthorize):
    //                          the gateway runs its own PingOne Authorize on the
    //                          nested-act token, and the BFF's policy doesn't cover
    //                          specialist tools.
    //   gateway_authoritative — the call is routed through the agent gateway, which
    //                          calls PingOne Authorize itself and returns 403 / 428
    //                          (step-up or HITL) on its own. The BFF forwards the
    //                          request and relays the answer. Pre-flighting here as
    //                          well made the BFF the de-facto decision point: its
    //                          block returned before the gateway was ever called, so
    //                          the gateway's PDP call was dead code for gated tools.
    //
    // This deliberately does NOT skip when the tool executes locally (no gateway) —
    // there is no other PEP on that path, and skipping would be fail-open.
    // `_hitl_challenge_id` is likewise left in `params` here on purpose: the gateway
    // verifies and strips it, so the BFF must not consume it first.
    const gatewayAuthoritative = !!useGateway;
    if (ctx.skipBffAuthorize || gatewayAuthoritative) {
        const skipReason = ctx.skipBffAuthorize ? 'a2a_supplied_token' : 'gateway_authoritative';
        deps.emit({ phase: 'authorize_gate_skipped', reason: skipReason });
        // Contract C4 — omission is not permission. The SSE phase alone left the
        // RESPONSE BODY byte-identical to a run where the gate PERMITted, so a
        // caller reading the response could not tell the two apart. The other
        // two skip paths already set this; this was the last gap.
        mcpAuthorizeEvaluationThisRequest = {
            ran: false,
            skipped: true,
            skipReason,
            decisionContext: 'McpFirstTool',
            ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
            ...(ctx.vertical ? { vertical: ctx.vertical } : {}),
        };
    } else {
    try {
        deps.emit({
            phase: 'authorize_gate_begin'
        });
        // "One HITL solution": on a retry the agent echoes the challenge id as a
        // reserved tool-arg `_hitl_challenge_id` (mirrors the gateway). The gate
        // verifies it against the canonical HITL service (3009) before deciding.
        // Strip it from params so it never reaches the downstream tool.
        const hitlChallengeId = params?.[HITL_CHALLENGE_ARG] || null;
        if (hitlChallengeId) { delete params[HITL_CHALLENGE_ARG]; }

        logger.debug(_CAT, `[mcpToolPipeline] Before authorize-decision: tool=${tool} userSub=${userSub ?? '(none)'}`);
        const mcpAuthz = await deps.evaluateMcpFirstToolGate({
            req,
            tool,
            agentToken: mcpAccessToken, // RFC 8693: pass as agentToken for backward compat
            userSub,
            userAcr: req.session ?.user ?.acr,
            toolParams: params,
            hitlChallengeId,
        });
        logger.debug(_CAT, `[mcpToolPipeline] After authorize-decision: tool=${tool} ran=${mcpAuthz.ran} blocked=${!!mcpAuthz.block} decision=${mcpAuthz.block?.body?.decision ?? '(none)'}`);
        if (mcpAuthz.ran && mcpAuthz.block) {
            deps.emit({
                phase: 'authorize_denied',
                status: mcpAuthz.block.status
            });
            // Guided Demo Track — best-effort observation; never blocks the response.
            try {
                const _b = mcpAuthz.block.body || {};
                const _trackDecision = _b.error === 'mcp_step_up_required' ? 'STEP_UP'
                    : _b.error === 'mcp_hitl_required' ? 'HITL'
                        : 'DENY';
                require('./demoTrackService').observeDecision({
                    tool,
                    decision: _trackDecision,
                    decisionId: _b.decisionId || null,
                    errorCode: _b.error || null,
                });
            } catch { /* track observation is optional */ }
            // Scenario 5 — record the preflight authorize decision to the durable
            // compliance trail. These BFF-side blocks (deny / step-up / HITL,
            // including the Scenario 1 group-deny) never reach the gateway, so
            // they'd otherwise be absent from the MCP Audit / Compliance Report.
            // Best-effort + optional dep: a no-op in tests that don't wire it.
            if (deps.recordComplianceAudit) {
                const b = mcpAuthz.block.body || {};
                const denyParams = b.deny_parameters || {};
                const decision = b.error === 'mcp_step_up_required'
                    ? 'STEP_UP'
                    : b.error === 'mcp_hitl_required'
                        ? 'HITL'
                        : 'DENY';
                try {
                    deps.recordComplianceAudit({
                        eventType: 'authorization',
                        operation: tool,
                        outcome: decision === 'DENY' ? 'failure' : 'partial',
                        userId: userSub,
                        agentId: deps.decodeAgentId ? deps.decodeAgentId(mcpAccessToken) : undefined,
                        details: {
                            decision,
                            authorize_engine: b.authorize_engine || null,
                            decisionId: b.decisionId || null,
                            deny_reason: b.deny_reason || null,
                            requiredGroup: denyParams.RequiredGroup || null,
                            userGroups: denyParams.UserGroups || null,
                            tokenScopes: denyParams.TokenScopes || null,
                            acr: req.session?.user?.acr || null,
                        },
                    });
                } catch (_) { /* never block the response on audit */ }
            }
            // HITL: create a challenge in the canonical HITL service (3009) — the
            // single store both BFF and gateway use. Return its challengeId so the
            // agent can echo it back as `_hitl_challenge_id` on retry after the
            // human approves at the dashboard. Fail-soft: if 3009 is unreachable
            // the 428 still returns (without a challengeId) so the caller isn't
            // silently permitted.
            let hitlChallenge = null;
            if (mcpAuthz.block.body.error === 'mcp_hitl_required') {
                deps.emit({ phase: 'authorize_denied_hitl', challenge_type: 'hitl' });
                try {
                    const agentId = deps.decodeAgentId ? deps.decodeAgentId(mcpAccessToken) : undefined;
                    hitlChallenge = await deps.createHitlChallenge({
                        tool,
                        userId: userSub,
                        agentId,
                        userEmail: req.session?.user?.email,
                        // Bind tool args (amount, payee/source) so verifyHitlReceipt
                        // can reject same-amount recipient swaps on retry.
                        context: {
                            ...(params && typeof params === 'object' ? params : {}),
                            decisionId: mcpAuthz.block.body.decisionId,
                            decisionContext: mcpAuthz.block.body.decisionContext,
                            reason: mcpAuthz.block.body.error_description,
                        },
                    }, req.correlationId);
                } catch (hitlErr) {
                    logger.error(_CAT, `[MCP HITL] Failed to create challenge in HITL service: ${hitlErr.message}`);
                }
            }
            const authorizeDecision = mcpAuthz.block.body.error === 'mcp_step_up_required'
                ? 'INDETERMINATE'
                : mcpAuthz.block.body.error === 'mcp_hitl_required'
                    ? 'INDETERMINATE'
                    : 'DENY';
            // Which KIND of block this was. `authorizeDecision` above collapses
            // step-up and HITL to the same 'INDETERMINATE', so a consumer checking
            // "decision !== PERMIT" cannot tell a hard deny from an approval gate —
            // that made a use case expecting DENY render green on a HITL block.
            // The block's `error` code already names the outcome exactly; surface it.
            const authorizeOutcome = {
                mcp_authorization_denied: 'DENY',
                mcp_step_up_required: 'STEP_UP',
                mcp_hitl_required: 'HITL_REQUIRED',
                mcp_hitl_receipt_rejected: 'HITL_REQUIRED',
                policy_not_found: 'POLICY_NOT_FOUND',
            }[mcpAuthz.block.body.error] || null;
            // BFF-simulated engine decided (ff_authorize_real, or a genuine
            // PingOne-unreachable fallback): mirror the PERMIT branch below and
            // push the gw-authorize Token Chain card here too, so DENY/step-up/
            // HITL outcomes render the same card the real-gateway path would.
            // NOT guarded by !useGateway (unlike the PERMIT branch below): this
            // branch returns early, before the real gateway is ever called, so
            // there is no later gwAuditTrail.authorize push that could ever
            // supply a card — the simulated engine's decision is the only
            // decision that will be made, so its card must always be pushed
            // here regardless of useGateway (final whole-branch review finding).
            if (mcpAuthz.block.body.authorize_engine === 'simulated') {
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    authorizeDecision === 'INDETERMINATE' ? 'indeterminate' : 'deny',
                    null,
                    `PingOne Authorize decision: ${authorizeDecision}`,
                    buildGwAuthorizeEventExtra({
                        decision: authorizeDecision,
                        engine: 'simulated',
                        decisionId: mcpAuthz.block.body.decisionId,
                        request: mcpAuthz.block.body.authorize_request,
                        response: mcpAuthz.block.body.authorize_response,
                    })
                ));
            }
            // Final whole-branch review finding: this branch (the gate's own
            // DENY/step-up/HITL block) returns early and never previously called
            // publishMcpResultToSse, so a dual gateEvaluation+secondaryEvaluation
            // DENY (e.g. the $2500 create_transfer example) produced zero Token
            // Chain cards on the AG-UI SSE feed despite building both evaluation
            // shapes for the HTTP response body right below. Factor them into
            // named consts and reuse for both the new publish call and the body,
            // to avoid duplicating/drifting the construction logic.
            const _blockAuthEval = {
                decision: authorizeDecision,
                outcome: authorizeOutcome,
                engine: mcpAuthz.block.body.authorize_engine || null,
                decisionContext: mcpAuthz.block.body.decisionContext,
                decisionId: mcpAuthz.block.body.decisionId,
                request: mcpAuthz.block.body.authorize_request || null,
                response: mcpAuthz.block.body.authorize_response || null,
                ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
                ...(ctx.vertical ? { vertical: ctx.vertical } : {}),
            };
            const _blockAuthEvals = mcpAuthz.block.body.gateEvaluation && mcpAuthz.block.body.secondaryEvaluation
                ? [
                    { ...mcpAuthz.block.body.gateEvaluation, engine: 'pingone', decisionContext: 'McpFirstTool' },
                    { ...mcpAuthz.block.body.secondaryEvaluation, engine: secondaryEvaluationEngine(mcpAuthz.block.body.secondaryEvaluation), decisionContext: 'TransactionAmount' },
                ]
                : null;
            try {
                deps.publishMcpResultToSse(flowTraceId, {
                    tool,
                    result: { error: mcpAuthz.block.body.error, message: mcpAuthz.block.body.error_description },
                    durationMs: Date.now() - startTime,
                    isDelegated: !!mcpAccessToken,
                    requestJson,
                    denied: true,
                    mcpAuthorizeEvaluation: _blockAuthEval,
                    mcpAuthorizeEvaluations: _blockAuthEvals,
                });
            } catch (_) { /* SSE best-effort */ }
            return { kind: 'block', httpStatus: mcpAuthz.block.status, tokenEvents, body: {
                ...mcpAuthz.block.body,
                // 428 is a valid authorization precondition (step-up/HITL), not a
                // failure — 403 (DENY) is the only genuine error status this block
                // returns. Explicit so callers don't have to infer it from status.
                isError: mcpAuthz.block.status !== 428,
                tool,
                ...(hitlChallenge ? {
                    challengeId: hitlChallenge.challengeId,
                    expiresAt: hitlChallenge.expiresAt,
                    // Back-compat: the agent UI polled `taskId`; keep it pointing at the
                    // canonical challenge id so existing pollers resolve against 3009.
                    taskId: hitlChallenge.challengeId,
                    instructions: `Approve at the dashboard, then retry the tool with ${HITL_CHALLENGE_ARG} in arguments.`,
                } : {}),
                tokenEvents,
                mcpAuthorizeEvaluation: _blockAuthEval,
                ...(_blockAuthEvals ? { mcpAuthorizeEvaluations: _blockAuthEvals } : {}),
            } };
        }
        if (mcpAuthz.ran && mcpAuthz.simulatedError) {
            deps.emit({
                phase: 'authorize_simulated_error'
            });
            logger.error(_CAT, `[MCP Authorize][Simulated] unexpected error: ${mcpAuthz.simulatedError.message}`);
            return { kind: 'error', httpStatus: 500, body: {
                error: 'mcp_authorize_error',
                error_description: 'Simulated MCP authorization evaluation failed unexpectedly.',
                tokenEvents,
            } };
        }
        if (mcpAuthz.ran && mcpAuthz.pingoneError) {
            deps.emit({
                phase: 'authorize_unavailable'
            });
            logger.error(_CAT, `[MCP Authorize] PingOne error — failing closed: ${mcpAuthz.pingoneError.message}`);
            return { kind: 'error', httpStatus: 503, body: {
                error: 'mcp_authorize_unavailable',
                error_description: 'PingOne Authorize is unavailable for MCP tool access.',
                // Debug "PingOne fell back" modal signal (strict pingone => denied).
                ...(mcpAuthz.authorizeFallback ? { authorizeFallback: mcpAuthz.authorizeFallback } : {}),
                tokenEvents,
            } };
        }
        if (mcpAuthz.ran && mcpAuthz.permit) {
            deps.emit({
                phase: 'authorize_permitted'
            });
            mcpAuthorizeEvaluationThisRequest = (ctx.useCaseId || ctx.vertical)
              ? { ...mcpAuthz.evaluation, ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}), ...(ctx.vertical ? { vertical: ctx.vertical } : {}) }
              : mcpAuthz.evaluation;
            // BFF-simulated engine decided (ff_authorize_real, or a genuine
            // PingOne-unreachable fallback): no gateway audit trail exists for
            // this call, so the gw-authorize Token Chain card is built here —
            // same id/status contract as the real-gateway path (gwAuditTrail.
            // authorize, above) so TokenChainDisplay renders the same card
            // regardless of which backend actually decided.
            // Guarded by !useGateway: when the call goes through the real
            // gateway (ff_authorize_real + ff_mcp_gateway_pinggateway both
            // on), PingGateway runs its own decision too and the audit-trail
            // push below (gwAuditTrail.authorize) already covers it — pushing
            // here as well would double the gw-authorize card for one call.
            if (!useGateway && mcpAuthz.evaluation?.engine === 'simulated') {
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    'permit',
                    null,
                    `PingOne Authorize decision: ${mcpAuthz.evaluation.decision || 'PERMIT'}`,
                    buildGwAuthorizeEventExtra(mcpAuthz.evaluation)
                ));
            }
            deps.appEventLog('authorize', 'info',
                `Authorize gate permitted — ${tool}`,
                { tag: 'authorize/gate-permitted', metadata: { tool, useCaseId: ctx.useCaseId, vertical: ctx.vertical } });
        }
        if (!mcpAuthz.ran) {
            // Contract C4 — omission is not permission. A gate that did not run
            // must be visible to the caller and the UI, never silently
            // indistinguishable from a PERMIT. Logged at WARN (not info): an
            // unauthorized tool call is not routine.
            const skipReason = mcpAuthz.skipReason || mcpAuthz.reason || 'unknown';
            deps.emit({
                phase: 'authorize_gate_skipped',
                reason: skipReason,
            });
            deps.appEventLog('authorize', 'warn',
                `Authorize gate did NOT run — ${skipReason} (tool=${tool} is unauthorized)`,
                { tag: 'authorize/gate-skipped', metadata: { reason: skipReason, useCaseId: ctx.useCaseId, vertical: ctx.vertical } });
            mcpAuthorizeEvaluationThisRequest = {
                ran: false,
                skipped: true,
                skipReason,
                decisionContext: 'McpFirstTool',
                ...(mcpAuthz.authorizeFallback ? { authorizeFallback: mcpAuthz.authorizeFallback } : {}),
                ...(ctx.useCaseId ? { useCaseId: ctx.useCaseId } : {}),
                ...(ctx.vertical ? { vertical: ctx.vertical } : {}),
            };
        }
    } catch (mcpAuthzErr) {
        deps.emit({
            phase: 'authorize_internal_error'
        });
        logger.error(_CAT, `[MCP Authorize] Unexpected error in gate: ${mcpAuthzErr.message}`);
        return { kind: 'error', httpStatus: 500, body: {
            error: 'mcp_authorize_internal',
            message: mcpAuthzErr.message,
            tokenEvents,
        } };
    }
    } // end else (skipBffAuthorize)

    // Introspect session token for zero-trust validation (RFC 7662)
    const sessionAccessToken = deps.getSessionAccessToken(req);
    const introspectionConfigured = deps.config.introspectionConfigured;
    if (introspectionConfigured) {
        deps.emit({
            phase: 'introspection_begin'
        });
        if (!sessionAccessToken || sessionAccessToken === '_cookie_session') {
            deps.emit({
                phase: 'introspection_skipped_no_session_token'
            });
            const r = deps.mcpNoBearerResponse(req, tokenEvents);
            return { kind: 'block', httpStatus: r.status, body: r.body };
        }
        try {
            const introspectionResult = await deps.introspectToken(sessionAccessToken);
            if (!introspectionResult.active) {
                deps.emit({
                    phase: 'introspection_inactive'
                });
                tokenEvents.push(deps.buildTokenEvent(
                    'session-token-introspection',
                    'Session Token — PingOne Introspection (RFC 7662)',
                    'failed',
                    null,
                    'PingOne returned active=false for the session token. The tool call cannot proceed with an inactive session.',
                    {
                        rfc: 'RFC 7662',
                        introspectionResult: {
                            active: false,
                            sub: introspectionResult.sub,
                            scope: introspectionResult.scope,
                            exp: introspectionResult.exp,
                        },
                    }
                ));
                logger.warn(_CAT, `[MCP Proxy] Session token introspection failed: token inactive for tool ${tool}`);
                return { kind: 'error', httpStatus: 401, body: {
                    error: 'token_inactive',
                    need_auth: true,
                    agentInitRequired: true,
                    message: 'Session token is no longer active. Please sign in again.',
                    tokenEvents,
                } };
            }
            deps.emit({
                phase: 'introspection_active_ok'
            });
            tokenEvents.push(deps.buildTokenEvent(
                'session-token-introspection',
                'Session Token — PingOne Introspection (RFC 7662)',
                'active',
                // Pass claims so the UI Claims tab shows real PingOne data
                {
                    header: null,
                    claims: {
                        sub:    introspectionResult.sub   || null,
                        active: true,
                        scope:  introspectionResult.scope || null,
                        exp:    introspectionResult.exp   || null,
                        aud:    introspectionResult.aud   || null,
                        client_id: introspectionResult.client_id || null,
                    },
                },
                `PingOne confirmed the session token is active. sub=${introspectionResult.sub || '—'} scope="${introspectionResult.scope || ''}"`,
                {
                    rfc: 'RFC 7662',
                    introspectionResult: {
                        active: true,
                        sub: introspectionResult.sub,
                        scope: introspectionResult.scope,
                        exp: introspectionResult.exp,
                    },
                }
            ));
        } catch (err) {
            deps.emit({
                phase: 'introspection_error_degraded'
            });
            tokenEvents.push(deps.buildTokenEvent(
                'session-token-introspection',
                'Session Token — PingOne Introspection (RFC 7662)',
                'degraded',
                null,
                `Introspection endpoint error — continuing in degraded mode. ${err.message}`,
                { rfc: 'RFC 7662' }
            ));
            logger.error(_CAT, `[MCP Proxy] Session token introspection error for tool ${tool}: ${err.message}`);
            // Continue on introspection failure (graceful degradation) but log the error
        }
    } else {
        deps.emit({
            phase: 'introspection_not_configured'
        });
        tokenEvents.push(deps.buildTokenEvent(
            'session-token-introspection',
            'Session Token — PingOne Introspection (RFC 7662)',
            'skipped',
            null,
            'PINGONE_INTROSPECTION_ENDPOINT is not configured. Session token liveness is not verified on this tool call.',
            { rfc: 'RFC 7662' }
        ));
    }

    // ── Try remote MCP server first; fall back to local handler if unreachable ──
    // When MCP_GATEWAY_HTTP_URL is set, route through the banking-mcp-gateway (Phase 243).
    // The gateway owns RFC 9728 metadata, runs PingOne Authorize policy evaluation, and
    // performs RFC 8693 token exchange to the upstream MCP server — the mcpAccessToken
    // must already be scoped to the gateway audience (MCP_GW_RESOURCE_URI).
    // Graceful fallback: if MCP_GATEWAY_HTTP_URL is not set, use the previous direct path.
    const gatewayHttpUrl = deps.config.gatewayHttpUrl;
    // useGateway hoisted above the authorize-gate block — see declaration near
    // the top of the function.
    const mcpUrl = deps.config.mcpUrl;
    const isLocalDefault = mcpUrl === 'ws://localhost:8080' && !deps.config.mcpServerUrlEnv;
    const useHttp2 = deps.config.useHttp2;

    try {
        deps.emit({
            phase: 'mcp_remote_begin'
        });
        // Walk the MCP authorization handshake before the credentialed call, so
        // the trace shows both halves: the anonymous tools/call the gateway
        // answers with 401 + WWW-Authenticate, then the authorized one below.
        // Gateway path only — direct mode has no HTTP MCP endpoint to challenge.
        // Evidence only: probeMcpChallenge never throws and its result is unused.
        if (useGateway) {
            const challengeProbe = await require('./mcpChallengeProbe').probeMcpChallenge(req, {
                method: 'tools/call',
                phase: 'tools/call',
                gatewayUrl: gatewayHttpUrl,
                params: { name: tool },
            });
            if (challengeProbe.events.length) {
                tokenEvents.push(...challengeProbe.events);
                deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
            }
        }
        deps.appEventLog('mcp', 'info', `MCP tool call → ${tool}`,{ tag: 'mcp/tool', metadata: { tool, gatewayUrl: useGateway ? gatewayHttpUrl : mcpUrl, via: useGateway ? 'gateway' : 'direct' } });
        let result;
        let gwAuditTrail = null;
        // DPoP (RFC 9449): pass the session's ephemeral key so the gateway client signs a
        // per-hop proof. Only when ff_dpop is on AND Phase A minted a key during token
        // resolution — never create one here.
        let _dpopKey = null;
        try {
            const _ff = require('./configStore').getEffective('ff_dpop');
            if ((_ff === true || _ff === 'true') && req.session && req.session.dpopKey) {
                _dpopKey = req.session.dpopKey;
            }
        } catch (_) { /* best-effort */ }
        // get_branch_hours (UC24 public catalog) selects its catalog by a
        // `vertical` tool param — MCP handlers never see the X-Active-Vertical
        // header, so without this every non-banking vertical got Super Banking
        // branches from the real MCP server (the local fallback in
        // mcpLocalTools.js already resolves it from req.body.vertical).
        if (tool === 'get_branch_hours' && !params.vertical) {
            const catalogVertical = ctx.vertical || sessionVertical;
            if (catalogVertical) params.vertical = catalogVertical;
        }
        if (useGateway) {
            // testActClientId is a SHOWCASE-ONLY demo affordance (confused-deputy chip):
            // it overrides the bridged actor with a rogue id so Authorize denies it.
            // Never populated by normal/production tool calls.
            // vertical: send the SESSION's active vertical, not the process-global
            // that mcpGatewayClient falls back to. PingOne Authorize uses this as a
            // policy input, and the BFF's own authz gate
            // (mcpToolAuthorizationService) already resolved this request with
            // resolver.activeIdFor(req) — so leaving the header on the global made
            // the two halves of the same decision disagree whenever an admin had
            // switched the global vertical. Still server-resolved: activeIdFor only
            // returns a vertical this session legitimately selected, falling back to
            // the global otherwise.
            // Tier (groupToTier) — neither gateway can map a PingOne group array to a
            // tier locally (no set-membership operator), so resolve it here the same
            // way the McpFirstTool gate does and forward it as headers for the
            // gateway's own local backstop (snapshots/gen-authorize-snapshot.js:44-47).
            // Scoped to the main group-policy flag only — the UC9/UC21 demo-specific
            // override paths that also feed the McpFirstTool gate are intentionally
            // not replicated here to avoid duplicating that flag logic.
            let gatewayUserGroups;
            try {
                const groupPolicy = require('./groupPolicy');
                if (groupPolicy.isEnabled(require('./configStore'))) {
                    gatewayUserGroups = await groupPolicy.groupsForUser(
                        req.session?.user?.username,
                        sessionVertical,
                        { pingOneUserId: req.session?.user?.oauthId || req.session?.user?.sub || null },
                    );
                }
            } catch (_) { /* best-effort */ }
            ({ result, gwAuditTrail } = await deps.callToolViaGateway(gatewayHttpUrl, mcpAccessToken, tool, params || {}, { correlationId: req.correlationId, vertical: sessionVertical, useCaseId: ctx.useCaseId, tratContextHeader, intentToken: req.intentToken || null, dpopKey: _dpopKey, testActClientId: req.body?._testActClientId, userGroups: gatewayUserGroups }));
        } else if (useHttp2) {
            const h2Session = deps.http2Bridge.createHttp2Session(mcpUrl, mcpAccessToken);
            result = await deps.http2Bridge.forwardToolCall(h2Session, tool, params || {}, mcpAccessToken, userSub, req.correlationId);
        } else {
            // Collect the MCP spec handshake so the chain can show it. Three
            // messages go over this connection — initialize, then
            // notifications/initialized, then tools/call — and only the last
            // was ever surfaced.
            const mcpFrames = {};
            result = await deps.mcpCallTool(tool, params || {}, mcpAccessToken, userSub, req.correlationId, { emit: deps.emit, frameSink: mcpFrames });
            if (mcpFrames.initializeRequest) {
                const initEvents = [
                    deps.buildTokenEvent('mcp-initialize', 'MCP handshake — initialize', 'active', null,
                        `Client opened the MCP session (protocol ${mcpFrames.initializeRequest.params?.protocolVersion || '?'}) before any tool ran.`,
                        {
                            rfc: 'MCP 2025-11-25 §Lifecycle',
                            request: mcpFrames.initializeRequest,
                            response: mcpFrames.initializeResponse || null,
                            negotiatedVersion: mcpFrames.initializeResponse?.result?.protocolVersion || null,
                            serverInfo: mcpFrames.initializeResponse?.result?.serverInfo || null,
                        }),
                ];
                if (mcpFrames.initializedNotification) {
                    initEvents.push(deps.buildTokenEvent('mcp-initialized', 'MCP handshake — notifications/initialized', 'active', null,
                        'Client confirmed the negotiated session. Only after this notification may it invoke a tool.',
                        { rfc: 'MCP 2025-11-25 §Lifecycle', request: mcpFrames.initializedNotification }));
                }
                tokenEvents.push(...initEvents);
                deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
            }
        }
        deps.appEventLog('mcp', 'info', `MCP tool done ← ${tool} (${Date.now() - startTime}ms)`, { tag: 'mcp/tool', metadata: { tool, durationMs: Date.now() - startTime } });

        // Build token events from gateway audit trail if present (Phase 259)
        const gwEvents = [];
        if (gwAuditTrail) {
            if (gwAuditTrail.introspection) {
                const introspRes = gwAuditTrail.introspection;
                const status = introspRes.skipped ? 'skipped' : (introspRes.active ? 'valid' : 'revoked');
                const desc = introspRes.skipped
                    ? 'Gateway introspection skipped (endpoint not configured)'
                    : (introspRes.active ? 'Token verified active at gateway' : 'Token is revoked or no longer active');
                const gwIntrospectionEvent = deps.buildTokenEvent(
                    'gw-introspection',
                    'PingGateway — Token Introspection (RFC 7662)',
                    status,
                    null,
                    desc,
                    {
                        rfc: 'RFC 7662',
                        sub: introspRes.sub,
                        exp: introspRes.exp,
                        scope: introspRes.scope,
                        iss: introspRes.iss,
                        client_id: introspRes.client_id,
                        active: introspRes.active,
                        skipped: introspRes.skipped,
                        rawResponse: introspRes,
                    }
                );
                tokenEvents.push(gwIntrospectionEvent);
                gwEvents.push(gwIntrospectionEvent);
            }
            if (gwAuditTrail.authorize) {
                const authzRes = gwAuditTrail.authorize;
                const decision = authzRes.decision; // PERMIT, DENY, INDETERMINATE
                const status = decision === 'PERMIT' ? 'permit' : (decision === 'INDETERMINATE' ? 'indeterminate' : 'deny');
                const desc = `PingOne Authorize decision: ${decision}${authzRes.reason ? ' — ' + authzRes.reason : ''}`;
                const gwAuthorizeEvent = deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    status,
                    null,
                    desc,
                    buildGwAuthorizeEventExtra({
                        ...authzRes,
                        denyingFilter: gwAuditTrail.denyingFilter || authzRes.denyingFilter,
                        lastFilter: gwAuditTrail.lastFilter || authzRes.lastFilter,
                        filterChain: gwAuditTrail.filterChain || authzRes.filterChain,
                        policy: gwAuditTrail.policy || authzRes.policy,
                    })
                );
                tokenEvents.push(gwAuthorizeEvent);
                gwEvents.push(gwAuthorizeEvent);
            }
            if (gwAuditTrail.mcpAudit) {
                const a = gwAuditTrail.mcpAudit;
                const howResult = a.how?.result || a.how?.decision || 'recorded';
                const whoUser = a.who?.userSub || a.who?.clientId || 'unknown';
                const whatTool = a.what?.tool || a.what?.mcpMethod || 'mcp';
                const gwMcpAuditEvent = deps.buildTokenEvent(
                    'gw-mcp-audit',
                    'PingGateway McpAuditFilter — who / what / when / where / how',
                    howResult === 'blocked' ? 'deny' : 'active',
                    null,
                    `MCP audit: ${whoUser} called ${whatTool} → ${howResult} (also written to audit/mcp.audit.json)`,
                    {
                        mcpAudit: a,
                        who: a.who,
                        what: a.what,
                        when: a.when,
                        where: a.where,
                        how: a.how,
                        eventName: a.eventName || 'PING-GATEWAY-MCP',
                    }
                );
                tokenEvents.push(gwMcpAuditEvent);
                gwEvents.push(gwMcpAuditEvent);
            }
            if (gwAuditTrail.mtls) {
                const mtlsRes = gwAuditTrail.mtls;
                const status = mtlsRes.enabled ? 'active' : 'skipped';
                const desc = mtlsRes.enabled
                    ? `Gateway → MCP server mTLS verified. Client cert subject: ${mtlsRes.subject || 'banking-mcp-gateway'}`
                    : 'mTLS not enforced between gateway and MCP server (MCP_MTLS_ENABLED=false). Set MCP_MTLS_ENABLED=true to enforce.';
                const gwMtlsEvent = deps.buildTokenEvent(
                    'gw-mtls',
                    'Gateway → MCP Server mTLS',
                    status,
                    null,
                    desc,
                    { mtlsEnabled: mtlsRes.enabled, subject: mtlsRes.subject }
                );
                tokenEvents.push(gwMtlsEvent);
                gwEvents.push(gwMtlsEvent);
            }
            if (gwAuditTrail.backend) {
                const backendRes = gwAuditTrail.backend;
                const gwRouteEvent = deps.buildTokenEvent(
                    'gw-route',
                    'Gateway — Backend Routing',
                    'active',
                    null,
                    `Gateway routed "${tool}" to backend: ${backendRes.target}`,
                    { target: backendRes.target }
                );
                tokenEvents.push(gwRouteEvent);
                gwEvents.push(gwRouteEvent);

                const exchangeDesc = backendRes.exchanged
                    ? `RFC 8693 exchange: token scoped to audience ${backendRes.audience}${backendRes.cached ? ' (cache hit)' : ''}`
                    : `RFC 8693 exchange failed: ${backendRes.error || 'unknown error'} — request not forwarded`;
                const gwBackendExchangeEvent = deps.buildTokenEvent(
                    'gw-backend-exchange',
                    'Gateway — RFC 8693 Token Exchange',
                    backendRes.exchanged ? 'active' : 'deny',
                    null,
                    exchangeDesc,
                    { target: backendRes.target, audience: backendRes.audience, cached: backendRes.cached, exchanged: backendRes.exchanged, error: backendRes.error }
                );
                tokenEvents.push(gwBackendExchangeEvent);
                gwEvents.push(gwBackendExchangeEvent);
            }
            // Weather / ScriptableFilter permit: surface filter chain when present
            // (often the only Agent Gateway teaching evidence on UC30 success).
            if (gwAuditTrail.filterChain
                && !tokenEvents.some((e) => e && e.id === 'gw-filter-chain')) {
                const policyPassed = gwAuditTrail.policy?.passed !== false;
                const gwFilterEvent = deps.buildTokenEvent(
                    'gw-filter-chain',
                    'PingGateway — filter chain',
                    policyPassed ? 'active' : 'deny',
                    null,
                    policyPassed
                        ? `Agent Gateway forwarded “${tool}” through ${gwAuditTrail.lastFilter || 'filter chain'} (state-scope policy passed).`
                        : (gwAuditTrail.policy?.name
                            ? `Agent Gateway blocked “${tool}” (${gwAuditTrail.policy.name}).`
                            : `Agent Gateway blocked “${tool}”.`),
                    {
                        denyingFilter: policyPassed ? null : (gwAuditTrail.denyingFilter || gwAuditTrail.lastFilter || null),
                        lastFilter: gwAuditTrail.lastFilter || null,
                        filterChain: gwAuditTrail.filterChain,
                        policy: gwAuditTrail.policy || null,
                        tool,
                        route: gwAuditTrail.policy?.route || null,
                    }
                );
                tokenEvents.push(gwFilterEvent);
                gwEvents.push(gwFilterEvent);
            }
        }
        if (gwEvents.length > 0) {
            deps.publishTokenEventsToSse(flowTraceId, gwEvents);
        }

        // Log the actual MCP result so it's queryable via /api/app-events
        if (result) {
          const resultMeta = {
            tool,
            durationMs: Date.now() - startTime,
            hasContent: !!result.content,
            contentLength: result.content ? JSON.stringify(result.content).length : 0,
            contentType: result.isError ? 'error' : 'success'
          };
          deps.appEventLog('mcp', 'info', `MCP result: ${tool} → ${result.isError ? 'error' : 'success'} (${resultMeta.contentLength} bytes)`, { tag: 'mcp/result', metadata: resultMeta });
        }

        // Publish MCP result via SSE so Token Chain MCP Results tab updates immediately
        const _durationMs = Date.now() - startTime;
        const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
        deps.publishMcpResultToSse(flowTraceId, {
            tool, result, durationMs: _durationMs, isDelegated: !!mcpAccessToken, requestJson,
            mcpAuthorizeEvaluation: _authEval?.singular || null,
            mcpAuthorizeEvaluations: _authEval?.plural || null,
        });
        // Also record in local audit store (covers BFF-proxied calls)
        // decisionId: BFF-gate eval when it ran; on the gateway-authoritative path
        // the BFF eval is the skip object, so fall back to the gateway's own
        // authorize correlationId from the audit trail (same id contract).
        deps.recordMcpToolCall({ userId: resolveAuditUserId(req, userSub) || 'unknown', toolName: tool, success: !result?.isError, duration: _durationMs, requestJson, resultJson: result ?? null, summary: result?.isError ? `${tool} failed` : `${tool} completed`, isDelegated: !!mcpAccessToken, decisionId: mcpAuthorizeEvaluationThisRequest?.decisionId || gwAuditTrail?.authorize?.rawResponse?.correlationId || null });

        deps.emit({
            phase: 'mcp_remote_done'
        });

        // Detect auth challenge from MCP server — fall back to local handler
        // instead of surfacing the redirect challenge to the client. The BFF
        // already has the user's session so local execution is preferred.
        // Published canonically under result._meta.authChallenge.
        const hasAuthChallenge = !!result?._meta?.authChallenge;
        if (hasAuthChallenge) {
            deps.emit({ phase: 'mcp_auth_challenge_intercepted' });
            logger.info(_CAT, `[MCP Proxy] ${tool} — MCP server returned auth challenge, using local fallback`);
            const sessionUser = req.session?.user;
            if (sessionUser?.id) {
                try {
                    const effectiveUserId = sessionUser.oauthId || sessionUser.id;
                    deps.emit({ phase: 'local_tool_start', path: 'auth_challenge_fallback' });
                    const localResult = await deps.callToolLocal(tool, params || {}, effectiveUserId, req);
                    deps.emit({ phase: 'local_tool_done', path: 'auth_challenge_fallback' });
                    const _acDuration = Date.now() - startTime;
                    const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
                    deps.publishMcpResultToSse(flowTraceId, {
                        tool, result: localResult, durationMs: _acDuration, isDelegated: false, requestJson,
                        mcpAuthorizeEvaluation: _authEval?.singular || null,
                        mcpAuthorizeEvaluations: _authEval?.plural || null,
                    });
                    deps.recordMcpToolCall({ userId: effectiveUserId || 'unknown', toolName: tool, success: !localResult?.error, duration: _acDuration, requestJson, resultJson: localResult ?? null, summary: localResult?.error ? `${tool} failed` : `${tool} completed`, decisionId: mcpAuthorizeEvaluationThisRequest?.decisionId || null });
                    return localResultOutcome(localResult, tokenEvents, { _localFallback: true });
                } catch (localErr) {
                    logger.error(_CAT, `[MCP Local] ${tool} — auth-challenge fallback failed: ${localErr.message}`);
                    deps.emit({ phase: 'local_tool_error', path: 'auth_challenge_fallback' });
                }
            }
        }

        // Get active LLM model for logging and client display
        const langchainConfig = req.session?.langchain_config || {};
        const activeProvider = langchainConfig.provider || 'helix';
        const activeModel = langchainConfig.model || 'gpt-4o-mini';
        logger.debug(_CAT, `[/api/mcp/tool] ${tool} — using LLM: ${activeProvider}/${activeModel}`);

        // A successful gateway/backend tool result whose CONTENT is a
        // hitl_required / step_up_required signal must surface as HTTP 428
        // (consistent with the simulated-Authorize gate and the local-handler
        // path), not HTTP 200 with the signal buried in tool text
        // (REGRESSION_PLAN §1 — 428 enforcement; Phase 170 all-transfers-consent).
        const contentHitl = hitlSignalInResultContent(result);
        if (contentHitl) {
            deps.emit({ phase: 'mcp_result_hitl_required' });
            return localResultOutcome(contentHitl, tokenEvents, { _hitlFromResultContent: true });
        }

        // A gateway-brokered call whose P1AZ check came back DENY does NOT throw
        // (callToolViaGateway returns { result, gwAuditTrail } normally even on a
        // gateway-side denial) — without this check the call fell through to the
        // ordinary httpStatus 200 result below, handing the LLM a raw error
        // envelope (e.g. {"message":"Unauthorized"}) to narrate instead of the
        // request stopping with the same gateway_policy_denied / gateway_misconfigured
        // Outcome the thrown-error path above already produces. A response with no
        // correlationId and a bare "Unauthorized" rawResponse means PingGateway's own
        // call to PingOne Authorize failed (its worker credentials), not a real
        // policy verdict — that must read as "fix the gateway", not "you are denied"
        // (same distinction the gateway_misconfigured catch-block handler makes).
        // Ensure gateway authorize decision is always surfaced, even on successful
        // tool calls. When gwAuditTrail.authorize exists but wasn't added during the
        // normal success flow (line 956-977), add it here to prevent "Run failed before
        // authorize-decision" on calls that actually reached Authorize.
        if (useGateway && gwAuditTrail?.authorize && !tokenEvents.some((e) => e && e.id === 'gw-authorize')) {
            const authzRes = gwAuditTrail.authorize;
            const decision = authzRes.decision; // PERMIT, DENY, INDETERMINATE
            const status = decision === 'PERMIT' ? 'permit' : (decision === 'INDETERMINATE' ? 'indeterminate' : 'deny');
            tokenEvents.push(deps.buildTokenEvent(
                'gw-authorize',
                'PingGateway → PingOne Authorize',
                status,
                null,
                `PingOne Authorize decision: ${decision}${authzRes.reason ? ' — ' + authzRes.reason : ''}`,
                buildGwAuthorizeEventExtra({
                    ...authzRes,
                    denyingFilter: gwAuditTrail.denyingFilter || authzRes.denyingFilter,
                    lastFilter: gwAuditTrail.lastFilter || authzRes.lastFilter,
                    filterChain: gwAuditTrail.filterChain || authzRes.filterChain,
                    policy: gwAuditTrail.policy || authzRes.policy,
                })
            ));
        }

        if (useGateway && gwAuditTrail?.authorize?.decision === 'DENY') {
            const authzRes = gwAuditTrail.authorize;
            const isInfraFault = !authzRes.correlationId
                && (/unauthorized/i.test(authzRes.rawResponse?.message || ''));
            if (isInfraFault) {
                logger.warn(_CAT, `[/api/mcp/tool] Gateway's own PingOne Authorize call failed for tool '${tool}' — infra fault, not a policy denial.`);
                deps.emit({ phase: 'gateway_misconfigured' });
                return { kind: 'block', httpStatus: 503, tokenEvents, body: {
                    error: 'gateway_misconfigured',
                    tool,
                    message: 'The gateway could not reach PingOne Authorize to evaluate this request (its own credentials were rejected). Contact an administrator.',
                    tokenEvents,
                } };
            }
            logger.warn(_CAT, `[/api/mcp/tool] Gateway denied tool '${tool}' via PingOne Authorize.`);
            deps.emit({ phase: 'gateway_policy_denied' });
            // The gateway's Authorize call is the only decision this request has —
            // without surfacing it the Proof strip reports "Run failed before
            // authorize-decision" on a DENY that actually fired (#1313 did this
            // for the 428 branches; this is the 403 counterpart).
            const gwDenyEval = gatewayBlockAuthEval(gwAuditTrail, 'DENY', ctx, 'DENY');
            return { kind: 'block', httpStatus: 403, tokenEvents, body: {
                error: 'gateway_policy_denied',
                tool,
                message: authzRes.reason || 'PingOne Authorize declined this request.',
                tokenEvents,
                ...(gwDenyEval ? { mcpAuthorizeEvaluation: gwDenyEval } : {}),
            } };
        }

        const out = {
            result,
            tokenEvents,
            activeModel,
            activeProvider
        };
        const authEval = splitAuthorizeEvaluation(mcpAuthorizeEvaluationThisRequest);
        if (authEval) {
            out.mcpAuthorizeEvaluation = authEval.singular;
            if (authEval.plural) out.mcpAuthorizeEvaluations = authEval.plural;
        }

        // Stream response when using HTTP/2 transport (client detects via Content-Type)
        if (useHttp2) {
            return { kind: 'result', httpStatus: 200, stream: true, tokenEvents, body: { result, tokenEvents } };
        }
        return { kind: 'result', httpStatus: 200, tokenEvents, body: out };
    } catch (err) {
        // HTTP 428 Precondition Required: the gateway's PDP asked for step-up
        // MFA. Relayed in the SAME envelope the BFF's own gate used to emit
        // (`mcp_step_up_required` + `step_up_method`) so the agent's existing
        // single step-up handler works regardless of which layer decided.
        // `step_up_method` stays a BFF concern: the per-use-case method lives in
        // the use-case catalog, which the gateway has no knowledge of.
        if (err.gatewayErrorCode === 'step_up_required') {
            deps.emit({ phase: 'gateway_step_up_required' });
            const gwEval = gatewayBlockAuthEval(err.gwAuditTrail, 'STEP_UP', ctx);
            if (gwEval) {
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    'indeterminate',
                    null,
                    'PingOne Authorize decision: INDETERMINATE',
                    buildGwAuthorizeEventExtra({
                        ...err.gwAuditTrail.authorize,
                        decision: 'INDETERMINATE',
                        denyingFilter: err.gwAuditTrail.denyingFilter,
                        lastFilter: err.gwAuditTrail.lastFilter,
                        filterChain: err.gwAuditTrail.filterChain,
                    })
                ));
            }
            const stepUpBody = {
                error: 'mcp_step_up_required',
                isError: false,
                error_description: 'PingOne Authorize requires additional authentication before this tool can run.',
                tool,
                step_up_method: resolveStepUpMethod(ctx.useCaseId),
                tokenEvents,
                requestJson,
                ...(gwEval ? { mcpAuthorizeEvaluation: gwEval } : {}),
            };
            try {
                const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
                deps.publishMcpResultToSse(flowTraceId, {
                    tool,
                    result: { error: 'mcp_step_up_required', message: stepUpBody.error_description },
                    durationMs: Date.now() - startTime,
                    isDelegated: !!mcpAccessToken,
                    requestJson,
                    denied: true,
                    mcpAuthorizeEvaluation: gwEval || _authEval?.singular || null,
                    mcpAuthorizeEvaluations: _authEval?.plural || null,
                });
            } catch (_) { /* SSE best-effort */ }
            return { kind: 'block', httpStatus: 428, tokenEvents, body: stepUpBody };
        }

        // HTTP 428 Precondition Required: P1AZ ELICITATION obligation — the agent
        // must confirm intent before the tool call proceeds. Distinct from HITL
        // (no human at the dashboard, no challenge minted) and step-up (no MFA);
        // checked first since mcpGatewayClient.js tags it with its own
        // gatewayErrorCode, separate from 'hitl_required'.
        if (err.gatewayErrorCode === 'elicitation_required') {
            deps.emit({ phase: 'gateway_elicitation_required' });
            const elicitationBody = {
                error: 'elicitation_required',
                isError: false,
                tool,
                message: err.rpcData?.prompt || 'This action requires your confirmation.',
                // The agent retries by echoing this id back as `_elicitation_id`
                // with `_elicitation_confirmed:true` — without it the confirmation
                // modal has nothing to send and the confirmation can never be spent.
                elicitationId: err.rpcData?.elicitationId || null,
                prompt: err.rpcData?.prompt || null,
                tokenEvents,
                requestJson,
            };
            try {
                deps.publishMcpResultToSse(flowTraceId, {
                    tool,
                    result: { error: 'elicitation_required', message: elicitationBody.message },
                    durationMs: Date.now() - startTime,
                    isDelegated: !!mcpAccessToken,
                    requestJson,
                    denied: true,
                });
            } catch (_) { /* SSE best-effort */ }
            return { kind: 'block', httpStatus: 428, tokenEvents, body: elicitationBody };
        }

        // HTTP 428 Precondition Required: HITL consent needed (INDETERMINATE decision)
        if (err.gatewayErrorCode === 'hitl_required') {
            deps.emit({ phase: 'gateway_hitl_required' });
            // A use case that DECLARES a step-up method (UC7 'p1mfa', UC22
            // 'ciba') must present STEP_UP even when the gateway's wire code was
            // hitl_required — the live MCP policy answers HITL for every
            // amount, and this is the same declared-method rule
            // _applyTransactionPolicy uses on the local-gate path. This has to
            // change the RESPONSE BODY, not just the mcpAuthorizeEvaluation
            // display label below — the label used to say STEP_UP while
            // `error` stayed 'hitl_required', so the client (and the policy-
            // conformance checker) never saw the declared override take effect.
            const declaredStepUpMethod = getUseCaseStepUpMethod(ctx.useCaseId);
            const gwEval = gatewayBlockAuthEval(
                err.gwAuditTrail,
                declaredStepUpMethod ? 'STEP_UP' : 'HITL_REQUIRED',
                ctx
            );
            if (gwEval) {
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    'indeterminate',
                    null,
                    'PingOne Authorize decision: INDETERMINATE',
                    buildGwAuthorizeEventExtra({
                        ...err.gwAuditTrail.authorize,
                        decision: 'INDETERMINATE',
                        denyingFilter: err.gwAuditTrail.denyingFilter,
                        lastFilter: err.gwAuditTrail.lastFilter,
                        filterChain: err.gwAuditTrail.filterChain,
                    })
                ));
            }
            if (declaredStepUpMethod) {
                const stepUpBody = {
                    error: 'mcp_step_up_required',
                    isError: false,
                    error_description: 'PingOne Authorize requires additional authentication before this tool can run.',
                    tool,
                    step_up_method: declaredStepUpMethod,
                    tokenEvents,
                    requestJson,
                    ...(gwEval ? { mcpAuthorizeEvaluation: gwEval } : {}),
                };
                try {
                    const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
                    deps.publishMcpResultToSse(flowTraceId, {
                        tool,
                        result: { error: 'mcp_step_up_required', message: stepUpBody.error_description },
                        durationMs: Date.now() - startTime,
                        isDelegated: !!mcpAccessToken,
                        requestJson,
                        denied: true,
                        mcpAuthorizeEvaluation: gwEval || _authEval?.singular || null,
                        mcpAuthorizeEvaluations: _authEval?.plural || null,
                    });
                } catch (_) { /* SSE best-effort */ }
                return { kind: 'block', httpStatus: 428, tokenEvents, body: stepUpBody };
            }
            const hitlBody = {
                error: 'hitl_required',
                isError: false,
                tool,
                message: 'Transaction requires human approval (HITL consent)',
                // The agent retries by echoing this id back as
                // `_hitl_challenge_id`; without it on the body the consent modal
                // has nothing to send and the approval can never be spent.
                hitl: true,
                challengeId: err.rpcData?.challengeId || null,
                challenge_type: err.rpcData?.challenge_type || 'consent',
                tokenEvents,
                requestJson,
                ...(gwEval ? { mcpAuthorizeEvaluation: gwEval } : {}),
            };
            // Guided Demo Track — gateway-raised HITL challenge is an enforcement
            // block too (the BFF-authorize block site at observeDecision above
            // never sees it). Best-effort; never blocks the response.
            try {
                require('./demoTrackService').observeDecision({
                    tool,
                    decision: 'HITL',
                    decisionId: err.rpcData?.challengeId || null,
                    errorCode: 'mcp_hitl_required',
                });
            } catch (_) { /* track observation is optional */ }
            try {
                const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
                deps.publishMcpResultToSse(flowTraceId, {
                    tool,
                    result: { error: 'hitl_required', message: hitlBody.message },
                    durationMs: Date.now() - startTime,
                    isDelegated: !!mcpAccessToken,
                    requestJson,
                    denied: true,
                    mcpAuthorizeEvaluation: gwEval || _authEval?.singular || null,
                    mcpAuthorizeEvaluations: _authEval?.plural || null,
                });
            } catch (_) { /* SSE best-effort */ }
            return { kind: 'block', httpStatus: 428, tokenEvents, body: hitlBody };
        }

        // Scope denial: MCP server returned -32005 (valid token, wrong scope).
        // Return 403 — do NOT fall back to the local tool handler.
        if (err.code === 'mcp_insufficient_scope') {
            const d = err.mcpErrorData || {};
            logger.warn(_CAT, `[/api/mcp/tool] Scope denied for tool '${tool}': missing [${(d.missingScopes || []).join(', ')}]`);
            return { kind: 'block', httpStatus: 403, body: {
                error: 'mcp_scope_denied',
                tool,
                requiredScopes: d.requiredScopes || [],
                missingScopes: d.missingScopes || [],
                availableScopes: d.availableScopes || [],
            } };
        }

        // Gateway self-diagnosed misconfiguration (introspection unavailable,
        // PingOne user-lookup unreachable) — an infrastructure fault, not a
        // policy decision. Do NOT fall back to the local handler (the fault
        // is on the auth path, not the tool call) and do NOT label it a
        // policy denial — that reads as "you are not authorized" when the
        // real story is "an administrator needs to fix the gateway."
        if (err.code === 'gateway_misconfigured') {
            logger.warn(_CAT, `[/api/mcp/tool] Gateway misconfigured for tool '${tool}': ${err.message}`);
            deps.emit({ phase: 'gateway_misconfigured' });
            return { kind: 'block', httpStatus: err.httpStatus || 503, tokenEvents, body: {
                error: 'gateway_misconfigured',
                tool,
                message: err.message,
                tokenEvents,
            } };
        }

        // Gateway policy denial — propagate structured error to the UI for educational display.
        // Do NOT fall back to the local handler: the gateway denied for a policy reason
        // (audience mismatch, expired token, origin restriction) that local execution cannot bypass.
        if (err.code === 'gateway_policy_denied' || err.code === 'gateway_auth_failed') {
            logger.warn(_CAT, `[/api/mcp/tool] Gateway denied tool '${tool}': ${err.gatewayErrorCode || err.code} — ${err.message}`);
            deps.emit({ phase: 'gateway_policy_denied', gatewayErrorCode: err.gatewayErrorCode });

            // Surface the gateway's P1AZ decision trail — preserved on the thrown
            // error (X-Gw-Audit-Trail) — as a gw-authorize card so the DENY shows
            // in the token chain instead of only as an error message.
            if (err.gwAuditTrail && err.gwAuditTrail.authorize) {
                const authzRes = err.gwAuditTrail.authorize;
                const trail = err.gwAuditTrail;
                const decision = authzRes.decision;
                const status = decision === 'PERMIT' ? 'permit' : (decision === 'INDETERMINATE' ? 'indeterminate' : 'deny');
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    status,
                    null,
                    `PingOne Authorize decision: ${decision}${authzRes.reason ? ' — ' + authzRes.reason : ''}`,
                    buildGwAuthorizeEventExtra({
                        ...authzRes,
                        denyingFilter: trail.denyingFilter || authzRes.denyingFilter,
                        lastFilter: trail.lastFilter || authzRes.lastFilter,
                        filterChain: trail.filterChain || authzRes.filterChain,
                        policy: trail.policy || authzRes.policy,
                    })
                ));
            }
            if (err.gwAuditTrail && err.gwAuditTrail.mcpAudit) {
                const a = err.gwAuditTrail.mcpAudit;
                const howResult = a.how?.result || a.how?.decision || 'blocked';
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-mcp-audit',
                    'PingGateway McpAuditFilter — who / what / when / where / how',
                    howResult === 'forwarded' ? 'active' : 'deny',
                    null,
                    `MCP audit: ${a.who?.userSub || 'unknown'} called ${a.what?.tool || a.what?.mcpMethod || tool} → ${howResult}`,
                    {
                        mcpAudit: a,
                        who: a.who,
                        what: a.what,
                        when: a.when,
                        where: a.where,
                        how: a.how,
                        eventName: a.eventName || 'PING-GATEWAY-MCP',
                        denyingFilter: err.gwAuditTrail.denyingFilter || a.where?.filter || null,
                    }
                ));
            }
            // Weather / ScriptableFilter denials: always emit gw-filter-chain so
            // TraceRail's gateway step lights even when X-Gw-Audit-Trail was absent.
            const denyTrail = err.gwAuditTrail || {};
            if ((denyTrail.denyingFilter || err.gatewayErrorCode === 'weather_scope_denied'
                || /weather scope|weather capability/i.test(err.gatewayMessage || err.message || ''))
                && !tokenEvents.some((e) => e && e.id === 'gw-filter-chain')) {
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-filter-chain',
                    'PingGateway — filter chain',
                    'deny',
                    null,
                    err.gatewayMessage || err.message || 'Gateway filter denied the call',
                    {
                        denyingFilter: denyTrail.denyingFilter || 'tx-weather-scope.groovy',
                        lastFilter: denyTrail.lastFilter || denyTrail.denyingFilter || 'TxWeatherScope',
                        filterChain: denyTrail.filterChain || null,
                        policy: denyTrail.policy || null,
                        tool,
                        gatewayErrorCode: err.gatewayErrorCode || 'gateway_policy_denied',
                        route: denyTrail.policy?.route || '/mcp/weather',
                    }
                ));
            }

            // 403 counterpart of #1313's 428 evidence hand-over: the gateway's
            // P1AZ decision is the run's only authorize evidence.
            const gwDenyEval = err.gwAuditTrail
                ? gatewayBlockAuthEval(err.gwAuditTrail, 'DENY', ctx, (err.gwAuditTrail.authorize && err.gwAuditTrail.authorize.decision) || 'DENY')
                : null;
            const denyBody = {
                error: 'gateway_policy_denied',
                tool,
                gatewayErrorCode: err.gatewayErrorCode || err.code,
                message: err.message,
                tokenEvents,
                requestJson,
                ...(gwDenyEval ? { mcpAuthorizeEvaluation: gwDenyEval } : {}),
                ...(req.body?._testActClientId
                    ? { allowedActor: require('./configStore').getEffective('pingone_ai_agent_client_id') || null }
                    : {}),
            };
            // Phase D teaching: deny paths still publish attempted JSON-RPC + error
            // so TraceRail MCP step is not blank.
            try {
                const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
                deps.publishMcpResultToSse(flowTraceId, {
                    tool,
                    result: {
                        error: denyBody.error,
                        gatewayErrorCode: denyBody.gatewayErrorCode,
                        message: denyBody.message,
                    },
                    durationMs: Date.now() - startTime,
                    isDelegated: !!mcpAccessToken,
                    requestJson,
                    denied: true,
                    mcpAuthorizeEvaluation: gwDenyEval || _authEval?.singular || null,
                    mcpAuthorizeEvaluations: _authEval?.plural || null,
                });
            } catch (_) { /* SSE best-effort */ }
            return { kind: 'block', httpStatus: 403, tokenEvents, body: denyBody };
        }

        // Any gateway error that carried an X-Gw-Audit-Trail (e.g. 401
        // token_exchange_failed AFTER a P1AZ PERMIT) still represents real
        // introspection + decision hops — surface them as token events so the
        // token chain shows how far the call got before the failing hop.
        if (err.gwAuditTrail) {
            const trail = err.gwAuditTrail;
            if (trail.introspection && !tokenEvents.some((e) => e && e.id === 'gw-introspection')) {
                const introspRes = trail.introspection;
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-introspection',
                    'PingGateway — Token Introspection (RFC 7662)',
                    introspRes.skipped ? 'skipped' : (introspRes.active ? 'valid' : 'revoked'),
                    null,
                    introspRes.active ? 'Token verified active at gateway' : 'Token is revoked or no longer active',
                    { rfc: 'RFC 7662', sub: introspRes.sub, exp: introspRes.exp, scope: introspRes.scope,
                      iss: introspRes.iss, client_id: introspRes.client_id, active: introspRes.active,
                      skipped: introspRes.skipped, rawResponse: introspRes }
                ));
            }
            if (trail.authorize && !tokenEvents.some((e) => e && e.id === 'gw-authorize')) {
                const authzRes = trail.authorize;
                const decision = authzRes.decision;
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-authorize',
                    'PingGateway → PingOne Authorize',
                    decision === 'PERMIT' ? 'permit' : (decision === 'INDETERMINATE' ? 'indeterminate' : 'deny'),
                    null,
                    `PingOne Authorize decision: ${decision}${authzRes.reason ? ' — ' + authzRes.reason : ''}`,
                    buildGwAuthorizeEventExtra({
                        ...authzRes,
                        denyingFilter: trail.denyingFilter || authzRes.denyingFilter,
                        lastFilter: trail.lastFilter || authzRes.lastFilter,
                        filterChain: trail.filterChain || authzRes.filterChain,
                        policy: trail.policy || authzRes.policy,
                    })
                ));
            }
            if (trail.mcpAudit && !tokenEvents.some((e) => e && e.id === 'gw-mcp-audit')) {
                const a = trail.mcpAudit;
                const howResult = a.how?.result || a.how?.decision || 'recorded';
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-mcp-audit',
                    'PingGateway McpAuditFilter — who / what / when / where / how',
                    howResult === 'blocked' ? 'deny' : 'active',
                    null,
                    `MCP audit: ${a.who?.userSub || 'unknown'} called ${a.what?.tool || a.what?.mcpMethod || 'mcp'} → ${howResult}`,
                    {
                        mcpAudit: a,
                        who: a.who,
                        what: a.what,
                        when: a.when,
                        where: a.where,
                        how: a.how,
                        eventName: a.eventName || 'PING-GATEWAY-MCP',
                    }
                ));
            }
            if (trail.backend && !tokenEvents.some((e) => e && e.id === 'gw-route')) {
                const backendRes = trail.backend;
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-route',
                    'Gateway — Backend Routing',
                    'active',
                    null,
                    `Gateway routed "${tool}" to backend: ${backendRes.target}`,
                    { target: backendRes.target }
                ));
                const exchangeDesc = backendRes.exchanged
                    ? `RFC 8693 exchange: token scoped to audience ${backendRes.audience}${backendRes.cached ? ' (cache hit)' : ''}`
                    : `RFC 8693 exchange failed: ${backendRes.error || 'unknown error'} — request not forwarded`;
                tokenEvents.push(deps.buildTokenEvent(
                    'gw-backend-exchange',
                    'Gateway — RFC 8693 Token Exchange',
                    backendRes.exchanged ? 'active' : 'deny',
                    null,
                    exchangeDesc,
                    { target: backendRes.target, audience: backendRes.audience, cached: backendRes.cached, exchanged: backendRes.exchanged, error: backendRes.error }
                ));
            }
        }

        const isConnErr =
            err.useLocal ||
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENETUNREACH') ||
            err.message.includes('timed out') ||
            err.message.includes('connect ETIMEDOUT') ||
            (err.code && ['ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT'].includes(err.code));

        if (!isConnErr) {
            deps.emit({
                phase: 'mcp_remote_tool_error'
            });
            logger.error(_CAT, `[MCP Proxy] Error calling ${tool}: ${err.message}`);
            return { kind: 'error', httpStatus: 502, body: {
                error: 'mcp_error',
                message: err.message,
                tokenEvents
            } };
        }

        deps.emit({
            phase: 'mcp_remote_unreachable'
        });
        // #67 — When the call is gateway-authoritative the BFF deliberately skips
        // its own authorize gate (gatewayAuthoritative, ~:452) because the gateway
        // is the sole PDP. A transport failure reaching the gateway
        // (GATEWAY_UNREACHABLE/GATEWAY_TIMEOUT, whose messages contain
        // ECONNREFUSED/"timed out" and so satisfy isConnErr) must NOT silently run
        // the tool via callToolLocal: that bypasses the gateway, the MCP server,
        // AND PingOne Authorize (group/tier/RAR/scope), i.e. fail-open on the
        // money-movement path. Surface the transport error (503/504) instead.
        // Mirrors the no-bearer (~:385) and exchange-failure (F5, ~:320) paths,
        // both made non-bypassing. The degraded local-demo affordance is gated
        // behind the SAME opt-in (default OFF) and marks the result _degraded so
        // the caller can see the call was not authorized by any policy engine.
        if (useGateway) {
            const localFallbackOnGatewayDown =
                require('./configStore').getEffective('ff_local_fallback_on_exchange_failure') === 'true';
            if (!localFallbackOnGatewayDown) {
                deps.emit({ phase: 'gateway_unreachable_no_fallback' });
                logger.warn(_CAT,
                    `[MCP Gateway] ${tool} — gateway unreachable/timed out and the ungated local fallback is DISABLED ` +
                    '(ff_local_fallback_on_exchange_failure=false); surfacing the transport error instead of running unauthorized.'
                );
                const gwTimeout = err.code === 'GATEWAY_TIMEOUT' || err.message.includes('timed out');
                deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
                return { kind: 'error', httpStatus: err.httpStatus || (gwTimeout ? 504 : 503), tokenEvents, body: {
                    error: gwTimeout ? 'GATEWAY_TIMEOUT' : 'GATEWAY_UNREACHABLE',
                    message: err.message,
                    tokenEvents,
                } };
            }
        }
        // ── Local fallback ──────────────────────────────────────────────────────
        const sessionUser = req.session ?.user;
        if (!sessionUser ?.id) {
            deps.emit({
                phase: 'local_fallback_blocked_no_user'
            });
            const r = deps.mcpNoBearerResponse(req, tokenEvents);
            return { kind: 'block', httpStatus: r.status, body: r.body };
        }

        logger.info(_CAT, `[MCP Local] ${tool} — MCP server unreachable (${mcpUrl}), using local handler`);
        try {
            deps.emit({
                phase: 'local_tool_start',
                path: 'remote_fallback'
            });
            // Use oauthId (PingOne sub/UUID) — accounts are keyed by UUID (same as authenticateToken / REST routes).
            const effectiveUserId = sessionUser.oauthId || sessionUser.id;
            const result = await deps.callToolLocal(tool, params || {}, effectiveUserId, req);
            deps.emit({
                phase: 'local_tool_done',
                path: 'remote_fallback'
            });
            const _rfDuration = Date.now() - startTime;
            const _authEval = splitAuthorizeEvaluationForSse(mcpAuthorizeEvaluationThisRequest);
            deps.publishMcpResultToSse(flowTraceId, {
                tool, result, durationMs: _rfDuration, isDelegated: false, requestJson,
                mcpAuthorizeEvaluation: _authEval?.singular || null,
                mcpAuthorizeEvaluations: _authEval?.plural || null,
            });
            deps.recordMcpToolCall({ userId: effectiveUserId || 'unknown', toolName: tool, success: !result?.error, duration: _rfDuration, requestJson, resultJson: result ?? null, summary: result?.error ? `${tool} failed` : `${tool} completed` });
            return { kind: 'result', httpStatus: 200, tokenEvents, body: {
                result,
                tokenEvents,
                _localFallback: true,
                // #67 — reachable with useGateway only via the opt-in flag; the
                // gateway (sole PDP) was down, so this ran without any policy
                // decision. Contract C2: mark degraded so the caller can tell.
                ...(useGateway ? { _degraded: true, policy_source: 'local-fallback' } : {}),
            } };
        } catch (localErr) {
            deps.emit({
                phase: 'local_tool_error',
                path: 'remote_fallback'
            });
            logger.error(_CAT, `[MCP Local] Error calling ${tool}: ${localErr.message}`);
            return { kind: 'error', httpStatus: 502, body: {
                error: 'mcp_error',
                message: localErr.message,
                tokenEvents
            } };
        }
    }
}

module.exports = { runMcpToolPipeline };
