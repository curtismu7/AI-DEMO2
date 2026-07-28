// demo_api_server/services/bffMcpToolExecutor.js
/**
 * BFF-side MCP tool execution for agent paths (banking LangChain tools +
 * vertical plugin tools). Vertical tools are registered on the MCP server
 * (verticalHandlers.ts) and executed via BFF /api/path/vertical-tool — they are
 * NOT in createMcpToolRegistry()'s LangChain list.
 */
'use strict';

const { callMcpToolInternal } = require('../utils/mcpToolRegistry');
const { resolveMcpAccessTokenWithEvents } = require('./agentMcpTokenService');
const { runMcpToolPipeline } = require('./mcpToolPipeline');
const verticalDispatch = require('./verticalDispatch');
const { isAdminClientToken, isCustomerBankingTool, ADMIN_TOKEN_ON_CUSTOMER } = require('./customerTokenGuard');
const { deriveUseCaseId, isValidUseCaseId } = require('../config/useCases');
const { stampUseCaseId, stampVertical } = require('./useCaseTagging');

// Server-level pipeline deps injected at startup via setPipelineDeps().
// When set, executeBffTool routes all banking tool calls through runMcpToolPipeline
// for full token exchange, HITL gate, PingOne Authorize, and SSE publishing.
let _pipelineDeps = null;

function setPipelineDeps(deps) {
  _pipelineDeps = deps;
}

/**
 * Resolve the flowTraceId for this request and bind a trace-aware pipeline `emit`
 * so phase milestones reach the flow SSE hub — the same live compliance steps the
 * chip/direct path (POST /api/mcp/tool) shows. Without this the shared deps.emit
 * is a no-op and the agent path only lights up the client-marked steps (1, 1a).
 * @returns {{ flowTraceId: string|null, deps: object }}
 */
function bindTraceEmit(req, toolName) {
  const flowTraceId = req?.body?.flowTraceId || null;
  const deps = (flowTraceId && typeof _pipelineDeps.publishPhaseToSse === 'function')
    ? { ..._pipelineDeps, emit: (payload) => _pipelineDeps.publishPhaseToSse(flowTraceId, { ...(payload || {}), tool: payload?.tool || toolName }) }
    : _pipelineDeps;
  return { flowTraceId, deps };
}

/**
 * Resolve agent MCP token and call the MCP server (gateway or WS).
 */
async function callMcpToolAsAgent({ name, args, userId, userToken, sessionId, tokenEvents }) {
  const mockReq = {
    session: { oauthTokens: { accessToken: userToken }, id: sessionId },
    sessionID: sessionId,
  };
  const { token: agentToken, tokenEvents: exchangeEvents } =
    await resolveMcpAccessTokenWithEvents(mockReq, name);
  if (exchangeEvents && exchangeEvents.length > 0) {
    tokenEvents.push(...exchangeEvents);
  }
  return callMcpToolInternal(name, args || {}, agentToken, userId, tokenEvents);
}

/**
 * Unwrap an MCP tool RESULT to the inner tool JSON the agent paths expect.
 *
 * runMcpToolPipeline keeps the raw MCP content envelope
 * `{ content: [{ type:'text', text:'<inner JSON>' }], isError }` as body.result
 * (it needs `.content`/`.isError` for SSE, audit, and HITL detection). The gateway
 * api_key dispatch path (e.g. the manufacturing work-order tool) returns exactly
 * that envelope. Without unwrapping, the vertical render layer (parseMcpToolPayload)
 * sees no `.render`/`.data` and dumps the whole frame to the chat as plain text.
 * This mirrors callMcpToolInternal, which already returns `content[0].text`.
 *
 * Scope notes: only the first `type:'text'` part is unwrapped (all vertical/
 * banking tools emit their inner JSON there). A result that carries ONLY
 * `structuredContent` and no text part is returned unchanged — that shape is not
 * produced by this demo's tools, so handling it is intentionally out of scope.
 *
 * Error envelopes (`isError:true`) whose text is a bare, non-JSON sentence are
 * re-wrapped as `{"error":"<sentence>"}` so the message survives the consumer's
 * `JSON.parse` instead of being silently dropped to `{}` / `render:'text'`. Text
 * that is already JSON (the demo's tools, which emit `{"error":…}` on failure) is
 * passed through untouched so any embedded `.error` is preserved.
 *
 * Returns the inner text string when the value is an MCP content envelope, else
 * the value unchanged.
 * @param {*} result
 * @returns {string|*}
 */
function unwrapMcpResultEnvelope(result) {
  if (result && Array.isArray(result.content)) {
    const textPart = result.content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
    if (textPart) {
      const txt = textPart.text;
      // A failed call whose text is not JSON would JSON.parse → null downstream,
      // losing the message. Wrap it so the consumer's error path keeps it.
      if (result.isError && txt.trim()[0] !== '{' && txt.trim()[0] !== '[') {
        return JSON.stringify({ error: txt });
      }
      return txt;
    }
  }
  return result;
}

/**
 * Execute a tool via the full runMcpToolPipeline (RFC 8693, HITL, Authorize, SSE)
 * when pipeline deps are wired (normal runtime). Falls back to direct tool.invoke
 * only in test/isolated contexts where deps were never injected.
 */
async function executeBffTool({ name, args, userId, userToken, req = null, tokenEvents = [], sessionId = '' }) {
  // Defense-in-depth: never run a customer banking tool with an admin-client
  // token. The agent entry (processAgentMessage) fails fast before reaching
  // here, but the chip/direct path funnels through this chokepoint too. Returns
  // a TERMINAL envelope so the reason loop stops (no retry) and the SPA can
  // offer "Log in as customer". See customerTokenGuard.js.
  if (isCustomerBankingTool(name) && isAdminClientToken(userToken)) {
    return JSON.stringify({ ...ADMIN_TOKEN_ON_CUSTOMER });
  }

  // Teaching/education tools (oauth-teaching explain_concept, show_flow_diagram, …)
  // are pure-local: text + optional education-panel directive. They must not enter
  // the MCP gateway (Unknown tool) or trigger RFC 8693. Same contract as
  // dispatchVerticalIntent's isLocalTool bypass.
  const localPlugin = verticalDispatch.findLocalToolPlugin(name);
  if (localPlugin) {
    try {
      const local = await localPlugin.executeTool(name, args || {}, {
        userId, userToken, req, tokenEvents, sessionId,
      });
      const payload = local?.result !== undefined ? local.result : local;
      return typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    } catch (e) {
      return JSON.stringify({ error: e.message || 'local teaching tool failed' });
    }
  }

  if (!_pipelineDeps) {
    // Test/isolated context — full pipeline not wired. Plugin (vertical) tools are
    // not in getBankingToolDefinitions(), so route them via the gateway directly.
    // This is the ONLY remaining plugin-tool shortcut: in normal runtime (deps
    // wired) plugin tools fall through to runMcpToolPipeline, the same single path
    // banking tools take (heuristic and LLM alike).
    if (verticalDispatch.isPluginToolName(name)) {
      return callMcpToolAsAgent({ name, args, userId, userToken, sessionId, tokenEvents });
    }
    // Fall back to direct execution without full pipeline.
    const { getBankingToolDefinitions } = require('./agentBuilder');
    const { recordToolCall: recordMcpToolCall } = require('./mcpToolAuditStore');
    const tools = getBankingToolDefinitions();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      // Not a known LangChain tool schema either. This can still be a real
      // MCP-server tool invoked directly rather than via LLM function-calling —
      // e.g. oauth-teaching's demonstrate_token_exchange/demonstrate_scope_denial
      // simulate a nested call to get_my_accounts/get_investment_balance, neither
      // of which is a plugin action tool or a LangChain registry entry. The
      // gateway is the source of truth for tool existence, so route there instead
      // of guessing it doesn't exist.
      return callMcpToolAsAgent({ name, args, userId, userToken, sessionId, tokenEvents });
    }

    const mockReq = {
      session: { oauthTokens: { accessToken: userToken }, id: sessionId },
      sessionID: sessionId,
    };
    const { token: agentToken, tokenEvents: exchangeEvents } =
      await resolveMcpAccessTokenWithEvents(mockReq, name);
    if (exchangeEvents && exchangeEvents.length > 0) {
      tokenEvents.push(...exchangeEvents);
    }
    const _toolStart = Date.now();
    const result = await tool.invoke(args, { configurable: { agentContext: { agentToken, userId, tokenEvents } } });
    const _duration = Date.now() - _toolStart;
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    try {
      const parsed = typeof result === 'object' && result !== null ? result : JSON.parse(resultStr);
      const success = !parsed?.error && !parsed?.isError;
      recordMcpToolCall({ userId: userId || 'agent', toolName: name, success, duration: _duration,
        summary: success ? `${name} completed` : `${name} failed`,
        requestJson: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args ?? {} } },
        resultJson: parsed ?? null, isDelegated: !!agentToken });
    } catch (_) {}
    return resultStr;
  }

  // Full pipeline path — req must be the real Express request so session/auth context is available.
  // If the caller passed a mockReq (sessionId-only), build a minimal one with the userToken.
  const effectiveReq = req && req.session?.user
    ? req
    : {
        session: { oauthTokens: { accessToken: userToken }, id: sessionId, user: req?.session?.user || null },
        sessionID: sessionId,
        correlationId: req?.correlationId,
        intentToken: req?.intentToken || null,
      };

  const { flowTraceId, deps: callDeps } = bindTraceEmit(req, name);

  // Resolve useCaseId before the pipeline runs so ctx.useCaseId is available for
  // authorize tagging: launcher-supplied wins (if it is a known catalog slug —
  // arbitrary client strings are rejected), else derive organically from (tool, args).
  const clientId = req?.body?.useCaseId;
  const useCaseId = (clientId && isValidUseCaseId(clientId))
    ? clientId
    : deriveUseCaseId(name, args);

  // useCaseId slugs are shared across verticals by design (same narrative can play
  // out in banking, healthcare, retail, etc.), so vertical is a parallel tag needed
  // to disambiguate which vertical produced a given tagged event.
  const vertical = req?.body?.vertical;

  const ctx = {
    tool: name,
    params: args || {},
    flowTraceId,
    startTime: Date.now(),
    req: effectiveReq,
    deps: callDeps,
    useCaseId,
    vertical,
  };

  const outcome = await runMcpToolPipeline(ctx);

  // Surface the PingOne Authorize evaluation to the caller. On the agent path the
  // tool result flows back as a plain string (the LLM tool message), so the
  // evaluation would otherwise be lost — the agent route reads it off req and
  // merges it into the response envelope so the Proof trace's authorize-decision
  // step matches on the SUCCESS path too (not only on block/deny). Best-effort;
  // never present on a mockReq (chip/direct path already carries it on the body).
  const _authEval = outcome.mcpAuthorizeEvaluation
    || (outcome.body && outcome.body.mcpAuthorizeEvaluation)
    || null;
  if (_authEval && req && typeof req === 'object') {
    req._mcpAuthorizeEvaluation = _authEval;
  }

  // Merge any token events the pipeline produced into the caller's tokenEvents array.
  // stampUseCaseId never overwrites an existing tag.
  if (Array.isArray(outcome.tokenEvents)) {
    stampUseCaseId(outcome.tokenEvents, useCaseId);
    stampVertical(outcome.tokenEvents, vertical);
    for (const ev of outcome.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  } else if (outcome.body && Array.isArray(outcome.body.tokenEvents)) {
    stampUseCaseId(outcome.body.tokenEvents, useCaseId);
    stampVertical(outcome.body.tokenEvents, vertical);
    for (const ev of outcome.body.tokenEvents) {
      if (!tokenEvents.includes(ev)) tokenEvents.push(ev);
    }
  }

  if (outcome.kind === 'result') {
    const result = unwrapMcpResultEnvelope(outcome.body?.result);
    return typeof result === 'string' ? result : JSON.stringify(result ?? outcome.body);
  }

  if (outcome.kind === 'block') {
    // HITL / step-up / scope denial — surface the error so the agent loop can handle it.
    return JSON.stringify({ error: outcome.body?.error || 'mcp_blocked', ...outcome.body });
  }

  // kind === 'error' — keep body fields (pingone / exchange detail) so the agent
  // reply and Token Chain can surface why the hop failed, not just a bare code.
  return JSON.stringify({
    error: outcome.body?.error || 'mcp_error',
    message: outcome.body?.message || outcome.body?.error_description || null,
    ...(outcome.body && typeof outcome.body === 'object' ? outcome.body : {}),
  });
}

/**
 * Run a tool call through the FULL production pipeline (RFC 8693 exchange,
 * BFF-preflight PingOne Authorize gate, real Agent Gateway call — with its own
 * downstream PingOne Authorize — HITL, SSE/audit) and return the RAW pipeline
 * Outcome (`{kind, httpStatus, body, tokenEvents}`), not the string-unwrapped
 * shape `executeBffTool` returns for LLM tool messages.
 *
 * Used by the Security Showcase attack sims (UC10/UC13) so a sim exercises the
 * SAME code path a real chip/agent call does — full flow, not a hand-rolled
 * direct token-exchange + gateway call. `req` must be the real, authenticated
 * Express request (the attack-sim route already has one); callers may stamp a
 * demo-only override onto `req.body` (e.g. `_testActClientId`, read at
 * mcpToolPipeline.js's gateway-call site) before invoking this.
 * @param {{tool: string, params?: object, req: object, useCaseId?: string, vertical?: string}} args
 * @returns {Promise<object>} pipeline Outcome
 */
async function runPipelineForSim({ tool, params, req, useCaseId, vertical }) {
  if (!_pipelineDeps) {
    throw Object.assign(new Error('Full MCP pipeline is not wired (pipeline deps unset)'), { code: 'pipeline_unavailable' });
  }
  const { flowTraceId, deps: callDeps } = bindTraceEmit(req, tool);
  const ctx = {
    tool,
    params: params || {},
    flowTraceId,
    startTime: Date.now(),
    req,
    deps: callDeps,
    useCaseId,
    vertical,
  };
  return runMcpToolPipeline(ctx);
}

/**
 * Execute a tool with a PRE-MINTED bearer token (A2A specialist path). Skips the
 * user→agent RFC 8693 exchange in the pipeline (the chained-exchange token was
 * minted upstream by a2aDelegationService) and runs the rest of the pipeline —
 * Authorize (which sees the nested act chain → depth 2 → PERMIT), the gateway
 * call, HITL, and SSE publishing.
 */
async function executeBffToolWithToken({ name, args, req = null, tokenEvents = [], sessionId = '', suppliedToken, suppliedUserSub = null }) {
  if (!suppliedToken) return JSON.stringify({ error: 'a2a_no_token' });
  if (!_pipelineDeps) {
    // Test/isolated context — full pipeline not wired.
    return JSON.stringify({ error: 'pipeline_unavailable', tool: name });
  }
  const effectiveReq = req && req.session?.user
    ? req
    : {
        session: { id: sessionId, user: req?.session?.user || null },
        sessionID: sessionId,
        correlationId: req?.correlationId,
      };
  const { flowTraceId, deps: callDeps } = bindTraceEmit(req, name);

  // Same useCaseId/vertical resolution as executeBffTool. Without this, no
  // event in the whole A2A delegation flow ever carries useCaseId, so the
  // UI's ProofStrip (firstUseCaseId) can never find UC2's catalog entry and
  // the Intent/Result/Used box never renders for a delegated specialist call.
  const clientId = req?.body?.useCaseId;
  const useCaseId = (clientId && isValidUseCaseId(clientId)) ? clientId : deriveUseCaseId(name, args);
  const vertical = req?.body?.vertical;

  const ctx = {
    tool: name,
    params: args || {},
    flowTraceId,
    startTime: Date.now(),
    req: effectiveReq,
    deps: callDeps,
    suppliedToken,
    suppliedUserSub,
    useCaseId,
    vertical,
    // A2A specialist calls carry a pre-minted nested-act token. The gateway
    // runs its own PingOne Authorize evaluation on that token — the BFF-side
    // evaluateMcpFirstToolGate is redundant and may DENY because the policy
    // doesn't have rules for specialist tools at the BFF decision endpoint.
    skipBffAuthorize: true,
  };
  const outcome = await runMcpToolPipeline(ctx);

  if (Array.isArray(outcome.tokenEvents)) {
    stampUseCaseId(outcome.tokenEvents, useCaseId);
    stampVertical(outcome.tokenEvents, vertical);
    for (const ev of outcome.tokenEvents) { if (!tokenEvents.includes(ev)) tokenEvents.push(ev); }
  } else if (outcome.body && Array.isArray(outcome.body.tokenEvents)) {
    stampUseCaseId(outcome.body.tokenEvents, useCaseId);
    stampVertical(outcome.body.tokenEvents, vertical);
    for (const ev of outcome.body.tokenEvents) { if (!tokenEvents.includes(ev)) tokenEvents.push(ev); }
  }
  if (outcome.kind === 'result') {
    const result = unwrapMcpResultEnvelope(outcome.body?.result);
    return typeof result === 'string' ? result : JSON.stringify(result ?? outcome.body);
  }
  if (outcome.kind === 'block') {
    return JSON.stringify({ error: outcome.body?.error || 'mcp_blocked', ...outcome.body });
  }
  return JSON.stringify({ error: outcome.body?.error || 'mcp_error', message: outcome.body?.message });
}

module.exports = { executeBffTool, executeBffToolWithToken, callMcpToolAsAgent, setPipelineDeps, unwrapMcpResultEnvelope, runPipelineForSim };
