/**
 * Banking Agent service — MCP edition.
 *
 * Calls the banking_api_server's `/api/mcp/tool` proxy, which forwards requests
 * to the banking_mcp_server via WebSocket (JSON-RPC).
 *
 * Returns { result, tokenEvents } so callers can push events to TokenChainContext.
 * tokenEvents is an array of token lifecycle objects from the Backend-for-Frontend (BFF):
 *   - User access token decoded claims + may_act status (+ jwtFullDecode JSON)
 *   - Token Exchange (RFC 8693) request + result
 *   - MCP access token (delegated) decoded claims + act status (+ jwtFullDecode JSON)
 */
import { appendTokenEvents, setCurrentTurn, clearCurrentTurn } from "./apiTrafficStore";
import { appendMcpCall } from "./mcpCallStore";
import { agentFlowDiagram } from "./agentFlowDiagramService";
import { tokenChainTraceStore } from "./tokenChainTrace/tokenChainTraceStore";
import { openMcpFlowSse } from "./mcpFlowSseClient";
import { addMilestone, updateMilestoneStatus } from "./milestonesStore";
import { createLogger } from "./logger";
import { anySignal } from "../components/demoAgentSafety";
import { adminCustomerContext } from "./adminCustomerContext";
import {
  isAuthRequiredApiError,
  normalizeAuthFailure,
  notifySessionExpiredIfNeeded,
} from "../utils/authUi";
import llmTimeouts from "../../../llm-timeouts.json";

const log = createLogger("callMcpTool");

// Must stay >= the BFF's own reason-loop timeout (same source file) or the
// client aborts — and silently drops the reply, see the catch in AIAgent.js —
// before the server's honest answer/error message has a chance to arrive.
export const AGENT_INVOKE_TIMEOUT_MS = llmTimeouts.REASON_LOOP_TIMEOUT_MS + 5000;
const streamLog = createLogger("parseStreamingResponse");

/**
 * Debug aid: when a transaction/MCP response indicates the live PingOne Authorize
 * call genuinely failed and the failover policy kicked in, broadcast a window
 * event so the global <AuthorizeFallbackModal> can tell the user. Only fires on a
 * TRUE error-fallback (backend sets authorizeFallback.occurred); a normal
 * simulated/PingOne decision carries no such field, so this is silent then.
 *
 * Accepts any response/error body and looks in the known shapes:
 *   body.authorizeFallback                       (block/error bodies)
 *   body.authorizeEvaluation.authorizeFallback   (transaction success)
 *   body.mcpAuthorizeEvaluation.authorizeFallback (MCP tool success)
 */
export function emitAuthorizeFallback(body) {
  if (!body || typeof body !== "object") return;
  const fb =
    body.authorizeFallback ||
    body.authorizeEvaluation?.authorizeFallback ||
    body.mcpAuthorizeEvaluation?.authorizeFallback ||
    null;
  if (!fb || !fb.occurred) return;
  try {
    window.dispatchEvent(new CustomEvent("authorize:fallback", { detail: fb }));
  } catch (_) {
    /* non-browser (test) env — ignore */
  }
}

function throwIfNetworkError(err, context) {
  if (
    err.name === "AbortError" ||
    err.message === "Failed to fetch" ||
    err.message.includes("ERR_CONNECTION")
  ) {
    log.error(`Connection timeout or network error in ${context}:`, {
      errorName: err.name,
      errorMessage: err.message,
    });
    throw Object.assign(
      new Error("Connection timeout - server may be restarting"),
      {
        statusCode: 504,
        code: "connection_timeout",
        isNetworkError: true,
      },
    );
  }
}

// ─── Session refresh (RFC 6749 §6) — same endpoints as Backend-for-Frontend (BFF) auto-refresh ───────

/**
 * Tries end-user refresh, then admin refresh. Does not log the user out.
 * @returns {Promise<{ ok: boolean, expiresAt?: number }>}
 */
export async function refreshOAuthSession() {
  const endpoints = ["/api/auth/oauth/user/refresh", "/api/auth/oauth/refresh"];
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, expiresAt: data.expiresAt };
    }
  }
  return { ok: false };
}

/**
 * Fetch the Authorize-filtered tool list for the active vertical + scope.
 * Drives the dynamic, greyable agent chips. Called on login, on vertical switch,
 * and on scope-picker (write-toggle) change. Returns availableTools where each
 * entry has { name, permitted, deniedReason?, ... }; scope-denied tools are
 * included (permitted:false) so the UI can grey them, vertical-foreign tools are
 * absent (the gateway dropped them).
 *
 * @param {{ vertical?: string, allowWrite?: boolean }} [opts]
 * @returns {Promise<{ availableTools: Array, vertical: string, allowWrite: boolean }>}
 */
export async function fetchAgentTools({ vertical, allowWrite = true } = {}) {
  const res = await fetch("/api/demo-agent/tools", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vertical, allowWrite }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { availableTools: [], vertical, allowWrite, error: data.error || res.statusText };
  }
  const data = await res.json().catch(() => ({}));
  return {
    availableTools: Array.isArray(data.availableTools) ? data.availableTools : [],
    vertical: data.vertical ?? vertical,
    allowWrite: data.allowWrite ?? allowWrite,
    degraded: !!data.degraded,
    degradedReason: data.degradedReason || null,
  };
}

/**
 * Fire-and-forget cold-start warmup of the PingOne Authorize connection. Called
 * on agent-panel mount so the first tool discovery / tool call doesn't blip into
 * the "Demo Authorize" degraded fallback. Server-side throttled + best-effort;
 * any error (including a transient 401 mid-reauth) is ignored.
 */
export async function warmupAuthz() {
  try {
    await fetch("/api/authorize/warmup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  } catch (_) {
    /* best-effort warm — never surfaces to the user */
  }
}

// ─── Low-level MCP tool call ──────────────────────────────────────────────────

/**
 * Execute a single MCP tool via the server-side proxy.
 * Returns { result, tokenEvents } — tokenEvents may be empty if the server
 * does not support the field (backwards compat).
 *
 * @param {string} tool   - MCP tool name (e.g. 'get_my_accounts')
 * @param {object} params - Tool parameters
 * @returns {Promise<{ result: any, tokenEvents: Array }>}
 */
export async function callMcpTool(tool, params = {}, { signal, useCaseId, vertical, onTokenEvent } = {}) {
  log.debug("=== MCP TOOL CALL START ===");
  log.debug("tool:", tool);
  log.debug("params:", JSON.stringify(params));
  log.debug("tool type:", typeof tool);

  // Client-side validation to prevent 400 errors and improve debugging
  if (!tool || typeof tool !== "string") {
    log.error("ERROR: Invalid tool parameter:", {
      tool,
      toolType: typeof tool,
      params,
    });
    throw new Error(
      `Invalid tool name: ${tool} (type: ${typeof tool}). Expected non-empty string.`,
    );
  }

  log.debug("Tool validation passed");

  // ── Phase 194: OIDC flow timeline milestones ───────────────────────────────
  const _oidcId = addMilestone("OIDC Authentication", "oidc_login", {});
  updateMilestoneStatus(_oidcId, "done");
  const _exchangeId = addMilestone("Token Exchange", "exchange_start", {});
  updateMilestoneStatus(_exchangeId, "active");
  // ────────────────────────────────────────────────────────────────────────────
  try {
    agentFlowDiagram.startMcpToolCall(tool);
    log.debug("Flow diagram started");
  } catch (err) {
    throwIfNetworkError(err, "agentFlowDiagram.startMcpToolCall");
    log.warn("Flow diagram initialization failed:", err);
  }
  // Start a fresh trace for each chip-fired tool call.
  // Chips are deterministic (no LLM) — mark the rail as heuristic so steps 4/11
  // show HEURISTICS labels and checkmarks instead of pending LLM hops.
  try {
    tokenChainTraceStore.beginTrace({ prompt: tool });
    tokenChainTraceStore.ingestRoutingMode("heuristic", { action: tool });
  } catch { /* display-only */ }

  const flowTraceId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  log.debug("flowTraceId:", flowTraceId);

  // ── Phase 194: exchange done, tool call begins ──────────────────────────────
  updateMilestoneStatus(_exchangeId, "done");
  const _toolId = addMilestone("MCP Tool Call", "mcp_tool_call", {
    toolName: tool,
  });
  updateMilestoneStatus(_toolId, "active");
  // ────────────────────────────────────────────────────────────────────────────

  // Collect token events from SSE stream for real-time Token Chain updates
  const tokenEventsFromSse = [];

  const closeSse = openMcpFlowSse(flowTraceId, (data) => {
    // Collect token events from SSE for streaming token chain display
    if (data && data.type === "token-event") {
      const tokenEvent = { ...data };
      delete tokenEvent.type; // Remove our wrapper type field
      tokenEventsFromSse.push(tokenEvent);
      // Immediately append so Token Chain UI updates in real time
      appendTokenEvents(tool, [tokenEvent]);
      onTokenEvent?.(tokenEvent);
    }

    // MCP tool result arrived via SSE — update MCP Results tab immediately.
    // The server event may not echo the request args, so fall back to the
    // params this call was invoked with so the live card shows request+response.
    if (data && data.type === "mcp-result") {
      window.dispatchEvent(
        new CustomEvent("mcp-tool-result-sse", {
          detail: { ...data, requestJson: data.requestJson ?? params },
        }),
      );
    }

    // MCP elicitation event — server is requesting additional user input/authorization
    if (data && data.phase === "elicitation_requested") {
      window.dispatchEvent(
        new CustomEvent("mcp-elicitation-requested", {
          detail: data,
        }),
      );
    }

    try {
      agentFlowDiagram.applyServerEvent(data);
    } catch (err) {
      throwIfNetworkError(err, "applyServerEvent (SSE)");
      log.warn("Failed to apply server event:", err);
    }
  });

  // Defensive body construction with validation
  let body;
  try {
    const requestBody = { tool, params: params || {}, flowTraceId, ...(useCaseId ? { useCaseId } : {}), ...(vertical ? { vertical } : {}) };
    body = JSON.stringify(requestBody);

    // Validate the body was created successfully
    if (!body || typeof body !== "string") {
      throw new Error("Failed to serialize request body");
    }
  } catch (err) {
    throwIfNetworkError(err, "JSON.stringify");
    log.error("Failed to construct request body:", { tool, params, err });
    throw new Error(`Request body construction failed: ${err.message}`);
  }

  const fetchOpts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "include",
    _silent: true, // suppress full-screen overlay — agent typing dots show progress instead
  };

  const t0 = Date.now();
  try {
    fetchOpts.signal = signal;
    let response = await fetch("/api/mcp/tool", fetchOpts);

    // 504 Server Unavailable — server is restarting
    if (response.status === 504) {
      log.warn("504 Server Unavailable - server may be restarting");
      appendMcpCall(
        tool,
        504,
        Date.now() - t0,
        null,
        "Server Unavailable (504)",
      );
      throw Object.assign(new Error("Server is restarting (504)"), {
        statusCode: 504,
        code: "server_unavailable",
        isServerError: true,
      });
    }

    // Enhanced 400 error handling
    if (response.status === 400) {
      const err400 = await response
        .clone()
        .json()
        .catch(() => ({
          error: "unknown_400",
          message: "Bad request - invalid tool parameters",
          debug: {
            status: 400,
            body: body ? body.substring(0, 200) : "undefined",
          },
        }));

      log.error("400 error from server:", {
        error: err400,
        requestBody: { tool, params, flowTraceId },
        bodyLength: body?.length || 0,
      });

      const responseTokenEvents = err400.tokenEvents || [];
      const allTokenEvents = [...tokenEventsFromSse, ...responseTokenEvents];
      appendMcpCall(tool, 400, Date.now() - t0, null, err400.message);
      appendTokenEvents(tool, allTokenEvents);

      try {
        agentFlowDiagram.completeMcpToolCall({
          toolName: tool,
          tokenEvents: allTokenEvents,
          ok: false,
          errorMessage: `400 Error: ${err400.message}`,
        });
      } catch (flowErr) {
        log.warn("Failed to complete flow diagram:", flowErr);
      }

      throw Object.assign(new Error(`MCP 400 Error: ${err400.message}`), {
        tokenEvents: allTokenEvents,
        statusCode: 400,
        code: err400.error,
        isClientError: true,
      });
    }

    if (response.status === 401) {
      const err401 = await response
        .clone()
        .json()
        .catch(() => ({}));
      // token_inactive / need_auth: token is dead at PingOne — refresh cannot help, signal re-auth immediately
      if (err401.need_auth || err401.error === "token_inactive") {
        const normalized = normalizeAuthFailure(401, err401);
        notifySessionExpiredIfNeeded({ status: 401, body: err401 });
        throw Object.assign(new Error(normalized.message), {
          statusCode: 401,
          need_auth: true,
          requiresLogin: true,
          code: normalized.code,
        });
      }
      const isStubToken = [
        "session_not_hydrated",
        "session_restore_required",
        "oauth_session_required",
      ].includes(err401.error);
      if (!isStubToken) {
        const refreshed = await refreshOAuthSession();
        if (refreshed.ok) {
          fetchOpts.signal = signal;
          response = await fetch("/api/mcp/tool", fetchOpts);
        }
      }
    }

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      // Genuine PingOne error-fallback on the MCP path (debug modal).
      emitAuthorizeFallback(err);
      const responseTokenEvents = err.tokenEvents || [];

      // Merge SSE-collected token events with response body events
      const allTokenEvents = [...tokenEventsFromSse, ...responseTokenEvents];

      // Proof-of-enforcement + TraceRail: block outcomes (step-up / HITL / deny)
      // carry mcpAuthorizeEvaluation on the 4xx body. Success-path ingest below
      // never ran, so UC7/UC8 428 left authorize missing / ProofStrip Incomplete.
      if (err.mcpAuthorizeEvaluation) {
        try {
          const ae = err.mcpAuthorizeEvaluation;
          const decision = ae.decision || "INDETERMINATE";
          const engine = ae.engine || "simulated";
          const decisionStatus =
            decision === "PERMIT"
              ? "active"
              : decision === "DENY"
                ? "failed"
                : "waiting";
          if (!allTokenEvents.some((e) => e && e.id === "authorize-decision")) {
            allTokenEvents.push({
              id: "authorize-decision",
              label: "PingOne Authorize — Policy Decision",
              status: decisionStatus,
              timestamp: Date.now(),
              rfc: "RFC 8705",
              authorizeDecision: decision,
              authorizeEngine: engine,
              authorizePath: ae.path || null,
              authorizeDecisionId: ae.decisionId || null,
              authorizeRef: ae.authorizeRef || ae.decisionEndpointId || null,
              authorizeRequest: ae.request || null,
              authorizeResponse: ae.response || null,
              explanation: `${engine === "pingone" ? "PingOne Authorize" : "Simulated policy engine"} evaluated the agent tool call and returned ${decision}.`,
              ...(ae.useCaseId ? { useCaseId: ae.useCaseId } : {}),
              ...(ae.vertical ? { vertical: ae.vertical } : {}),
            });
          }
          tokenChainTraceStore.ingestAuthorize(ae);
          tokenChainTraceStore.ingestTokenEvents(allTokenEvents);
          if (err.mcpAuthorizeEvaluations) {
            tokenChainTraceStore.ingestAuthorizeEvaluations(err.mcpAuthorizeEvaluations);
          }
        } catch { /* display-only */ }
      }

      // Special case: 428 Precondition Required with HITL consent required
      // This is not an error condition — it's a valid response that needs HITL handling
      // (Authorize gate uses mcp_hitl_required; local/transactions path uses hitl_required).
      if (
        response.status === 428 &&
        (err.error === "hitl_required" || err.error === "mcp_hitl_required")
      ) {
        appendMcpCall(
          tool,
          response.status,
          Date.now() - t0,
          err,
          "HITL consent required",
        );
        appendTokenEvents(tool, allTokenEvents);
        agentFlowDiagram.completeMcpToolCall({
          toolName: tool,
          tokenEvents: allTokenEvents,
          ok: true,
          errorMessage: null,
        });
        // Return the HITL response as a result, not an error
        return {
          result: err,
          tokenEvents: allTokenEvents,
        };
      }

      appendMcpCall(
        tool,
        response.status,
        Date.now() - t0,
        null,
        err.message || `HTTP ${response.status}`,
      );
      appendTokenEvents(tool, allTokenEvents);
      agentFlowDiagram.completeMcpToolCall({
        toolName: tool,
        tokenEvents: allTokenEvents,
        ok: false,
        errorMessage: err.message || `HTTP ${response.status}`,
      });
      // Structured scope-error: surface all metadata so the UI can render an actionable modal
      if (err.error === "missing_exchange_scopes") {
        throw Object.assign(
          new Error(
            err.message || "Token exchange blocked: missing required scopes",
          ),
          {
            code: "missing_exchange_scopes",
            statusCode: 403,
            missingScopes: err.missingScopes || [],
            userScopes: err.userScopes || "",
            requiredScopes: err.requiredScopes || "",
            tokenEvents: allTokenEvents,
          },
        );
      }
      // MCP scope denial: valid token but wrong scope — surface scope details for the UI modal
      if (err.error === "mcp_scope_denied") {
        throw Object.assign(
          new Error(
            err.message || "MCP tool access denied: insufficient scope",
          ),
          {
            code: "mcp_scope_denied",
            statusCode: 403,
            tool: err.tool || "",
            requiredScopes: err.requiredScopes || [],
            missingScopes: err.missingScopes || [],
            availableScopes: err.availableScopes || [],
            tokenEvents: allTokenEvents,
          },
        );
      }
      // Missing/unmatched P1AZ policy (code/policy drift) — distinct from a deny.
      if (err.error === "policy_not_found") {
        throw Object.assign(
          new Error(err.error_description || "Policy not found, please contact administrator."),
          {
            code: "policy_not_found",
            statusCode: response.status,
            tool: tool,
            tokenEvents: allTokenEvents,
          },
        );
      }
      // MCP authorization denied — surface deny_reason + deny_parameters for diagnostic display.
      if (err.error === "mcp_authorization_denied") {
        throw Object.assign(
          new Error(err.error_description || "MCP tool access was denied by authorization policy"),
          {
            code: "mcp_authorization_denied",
            statusCode: 403,
            tool: tool,
            authorizeEngine: err.authorize_engine || "unknown",
            denyReason: err.deny_reason || null,
            denyParameters: err.deny_parameters || null,
            decisionId: err.decisionId || null,
            tokenEvents: allTokenEvents,
          },
        );
      }
      // Gateway policy denial — surface structured fields for the educational side panel card.
      if (err.error === "gateway_policy_denied") {
        // Record the denial phase locally too: the SSE stream can close before
        // the server-published phase arrives, and the trace rail derives the
        // gateway step's DENY state from this phase.
        try {
          agentFlowDiagram.applyServerEvent({
            phase: "gateway_policy_denied",
            code: err.gatewayErrorCode || "forbidden",
            tool: err.tool || tool,
          });
        } catch (_) { /* display-only */ }
        // Phase D: teach the attempted MCP call even when the gateway blocks it.
        try {
          tokenChainTraceStore.ingestMcpResult({
            tool: err.tool || tool,
            denied: true,
            gatewayErrorCode: err.gatewayErrorCode || err.code || "forbidden",
            requestJson: err.requestJson || { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: err.tool || tool, arguments: params || {} } },
            result: {
              error: "gateway_policy_denied",
              gatewayErrorCode: err.gatewayErrorCode || err.code,
              message: err.message,
            },
          });
          if (Array.isArray(allTokenEvents) && allTokenEvents.length) {
            tokenChainTraceStore.ingestTokenEvents(allTokenEvents);
          }
        } catch (_) { /* display-only */ }
        throw Object.assign(
          new Error(err.message || "Gateway policy denied the tool call"),
          {
            code: "gateway_policy_denied",
            statusCode: 403,
            tool: err.tool || tool,
            gatewayErrorCode: err.gatewayErrorCode || "forbidden",
            requestJson: err.requestJson || null,
            tokenEvents: allTokenEvents,
          },
        );
      }
      // Agent restrictions HITL: agentRestrictionsGate uses `code` (not `error`) field
      if (response.status === 428 && err.code === 'agent_restrictions_hitl') {
        throw Object.assign(
          new Error(err.reason || 'Agent capability restricted — approval required'),
          {
            code: 'agent_restrictions_hitl',
            statusCode: 428,
            taskId: err.taskId || null,
            tool: err.tool || null,
            reason: err.reason || null,
            tokenEvents: allTokenEvents,
          }
        );
      }
      // Auth-required 401: normalize so the agent never shows raw "Unauthorized" / "HTTP 401"
      if (isAuthRequiredApiError(response.status, err)) {
        const normalized = normalizeAuthFailure(401, err);
        notifySessionExpiredIfNeeded({ status: 401, body: err });
        throw Object.assign(new Error(normalized.message), {
          tokenEvents: allTokenEvents,
          statusCode: 401,
          code: normalized.code,
          need_auth: true,
          requiresLogin: true,
          taskId: err.taskId || null,
          tool: err.tool || null,
        });
      }
      // Normalize stub-token error codes so BankingAgent shows the session-fix bubble
      const errCode = [
        "session_restore_required",
        "oauth_session_required",
      ].includes(err.error)
        ? "session_not_hydrated"
        : err.error;
      const e = Object.assign(
        new Error(err.message || `MCP error: ${response.status}`),
        {
          tokenEvents: allTokenEvents,
          statusCode: response.status,
          code: errCode,
          need_auth: !!err.need_auth,
          taskId: err.taskId || null,
          tool: err.tool || null,
          requiresLogin: !!err.requiresLogin,
          // Preserve the step-up method (and the fields the CIBA initiate call
          // needs) on the thrown Error. Dropping step_up_method made every
          // mcp_step_up_required — including UC22, which declares 'ciba' — open
          // the MFA modal on the chip/runAction path. MFA sets
          // session.stepUpVerified, so the retry then PERMITs with no
          // out-of-band approval: a CIBA bypass.
          ...(err.step_up_method ? { step_up_method: err.step_up_method } : {}),
          ...(err.step_up_acr ? { step_up_acr: err.step_up_acr } : {}),
          ...(err.transaction_amount != null
            ? { transaction_amount: err.transaction_amount }
            : {}),
          ...(err.fromAccountId || err.from_account_id
            ? { fromAccountId: err.fromAccountId || err.from_account_id }
            : {}),
          ...(err.toAccountId || err.to_account_id
            ? { toAccountId: err.toAccountId || err.to_account_id }
            : {}),
        },
      );
      throw e;
    }

    // Detect streaming response (HTTP/2 bridge sends application/stream+json)
    let data;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("stream+json") && response.body) {
      data = await parseStreamingResponse(response.body, tool);
    } else {
      data = await response.json();
    }
    appendMcpCall(tool, response.status, Date.now() - t0, data.result);
    const responseTokenEvents = data.tokenEvents || [];

    // Merge SSE-collected token events with response body events (backward compat)
    // SSE events arrive first (streaming), response body is fallback
    const allTokenEvents = [...tokenEventsFromSse];
    for (const evt of responseTokenEvents) {
      // Avoid duplicates by checking if event already collected from SSE
      if (
        !allTokenEvents.some(
          (e) => e.id === evt.id && e.timestamp === evt.timestamp,
        )
      ) {
        allTokenEvents.push(evt);
      }
    }

    // Genuine PingOne error-fallback on a permitted MCP tool call (debug modal).
    emitAuthorizeFallback(data);

    // Synthesize authorize-decision event from MCP-level PingOne Authorize evaluation
    if (data.mcpAuthorizeEvaluation) {
      const ae = data.mcpAuthorizeEvaluation;
      const decision = ae.decision || "PERMIT";
      const engine = ae.engine || "simulated";
      const decisionStatus =
        decision === "PERMIT"
          ? "active"
          : decision === "DENY"
            ? "failed"
            : "waiting";
      allTokenEvents.push({
        id: "authorize-decision",
        label: "PingOne Authorize — Policy Decision",
        status: decisionStatus,
        timestamp: Date.now(),
        rfc: "RFC 8705",
        authorizeDecision: decision,
        authorizeEngine: engine,
        authorizePath: ae.path || null,
        authorizeDecisionId: ae.decisionId || null,
        authorizeRef: ae.authorizeRef || ae.decisionEndpointId || null,
        authorizeRequest: ae.request || null,
        authorizeResponse: ae.response || null,
        explanation: `${engine === "pingone" ? "PingOne Authorize" : "Simulated policy engine"} evaluated the agent tool call and returned ${decision}.`,
      });
      tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation);
      if (data.mcpAuthorizeEvaluations) {
        tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations);
      }
    }

    // Phase 266 — credentialPath stamping and gateway-synthesized event merge.
    // The gateway labels each response with result._meta.credentialPath
    // ('oauth_bearer' | 'api_key' | 'dual_token') and synthesizes tokenEvents
    // that describe the gateway-side disposition (e.g. the dual_token 4-segment
    // narrative: inbound + idtoken-fetch + bearer-validated + idtoken-decoded).
    const credentialPath = data.result?._meta?.credentialPath || 'oauth_bearer';
    const gatewayTokenEvents = Array.isArray(data.result?._meta?.tokenEvents)
      ? data.result._meta.tokenEvents
      : [];
    // Merge gateway-synthesized events (not duplicates — they describe gateway
    // disposition, separate from the local exchange chain already in allTokenEvents).
    for (const gEvt of gatewayTokenEvents) {
      if (!allTokenEvents.some((e) => e.id === gEvt.id)) {
        allTokenEvents.push(gEvt);
      }
    }
    // Stamp every event with the credentialPath so TokenChainDisplay can render
    // per-segment colour/badge (blue/amber/teal for oauth_bearer/api_key/dual_token).
    const pathTaggedEvents = allTokenEvents.map((evt) => ({
      ...evt,
      credentialPath: evt.credentialPath || credentialPath,
    }));

    appendTokenEvents(tool, pathTaggedEvents);
    try {
      tokenChainTraceStore.ingestTokenEvents(pathTaggedEvents);
      tokenChainTraceStore.ingestMcpResult({
        tool,
        result: data.result,
        _meta: data.result?._meta || null,
        requestJson: { name: tool, arguments: params || {} },
      });
    } catch { /* display-only */ }
    // Phase 194: mark tool milestone done
    updateMilestoneStatus(_toolId, "done");
    addMilestone("Flow Complete", "flow_complete", {});
    agentFlowDiagram.completeMcpToolCall({
      toolName: tool,
      tokenEvents: pathTaggedEvents,
      ok: true,
      errorMessage: null,
    });
    return {
      result: data.result,
      tokenEvents: pathTaggedEvents,
    };
  } catch (e) {
    // Phase 194: mark milestone error
    updateMilestoneStatus(_toolId, "error", {
      errorMsg: e.message || "Tool call failed",
    });
    // HTTP error path already completed the diagram before throw
    if (e.statusCode == null) {
      agentFlowDiagram.completeMcpToolCall({
        toolName: tool,
        tokenEvents: e.tokenEvents || [],
        ok: false,
        errorMessage: e.message || "Network error",
      });
    }
    throw e;
  } finally {
    closeSse();
  }
}

// ─── HTTP/2 streaming response parser ─────────────────────────────────────────

/**
 * Parse a newline-delimited JSON stream from the BFF (application/stream+json).
 * Extracts flow events in real time and returns the final result + tokenEvents.
 *
 * Stream format:
 *   {"type":"flow_event", ...}\n
 *   {"type":"result", "data": {...}}\n
 *   {"type":"stream_close", "status": "success"}\n
 *
 * @param {ReadableStream} readableStream
 * @param {string} tool — tool name for logging
 * @returns {Promise<{result: any, tokenEvents: Array}>}
 */
async function parseStreamingResponse(readableStream, tool) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  let tokenEvents = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines — each line is a complete JSON object
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete last chunk in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed);
          if (obj.type === "flow_event") {
            agentFlowDiagram.applyServerEvent(obj);
          } else if (obj.type === "result") {
            finalResult = obj.data;
            if (obj.tokenEvents) tokenEvents = obj.tokenEvents;
          } else if (obj.type === "error") {
            throw Object.assign(new Error(obj.message || "Stream error"), {
              statusCode: obj.statusCode || 502,
              code: obj.code || "stream_error",
            });
          }
          // stream_close handled by loop termination
        } catch (parseErr) {
          if (parseErr.statusCode) throw parseErr; // Re-throw structured errors
          streamLog.warn("Skipping malformed chunk:", trimmed.slice(0, 100));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalResult) {
    streamLog.warn("No result object received for", tool);
  }

  return { result: finalResult, tokenEvents };
}

// ─── Named tool helpers ───────────────────────────────────────────────────────
// Each helper returns { result, tokenEvents } for the caller to consume.

export function getMyAccounts({ useCaseId, vertical } = {}) {
  return callMcpTool("get_my_accounts", {}, { useCaseId, vertical });
}

export function getAccountBalance(accountId, { useCaseId, vertical } = {}) {
  return callMcpTool(
    "get_account_balance",
    { account_id: accountId },
    { useCaseId, vertical },
  );
}

export function getMyTransactions(limit = 10, { useCaseId, vertical } = {}) {
  return callMcpTool("get_my_transactions", { limit }, { useCaseId, vertical });
}

export function createTransfer(
  fromAccountId,
  toAccountId,
  amount,
  description,
  hitlChallengeId,
  { useCaseId, vertical } = {},
) {
  return callMcpTool(
    "create_transfer",
    {
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      amount,
      description: description || "Agent transfer",
      ...(hitlChallengeId ? { _hitl_challenge_id: hitlChallengeId } : {}),
    },
    { useCaseId, vertical },
  );
}

export function createDeposit(
  accountId,
  amount,
  description,
  hitlChallengeId,
  { useCaseId, vertical } = {},
) {
  return callMcpTool(
    "create_deposit",
    {
      to_account_id: accountId,
      amount,
      description: description || "Agent deposit",
      ...(hitlChallengeId ? { _hitl_challenge_id: hitlChallengeId } : {}),
    },
    { useCaseId, vertical },
  );
}

export function createWithdrawal(
  accountId,
  amount,
  description,
  hitlChallengeId,
  { useCaseId, vertical } = {},
) {
  return callMcpTool(
    "create_withdrawal",
    {
      from_account_id: accountId,
      amount,
      description: description || "Agent withdrawal",
      ...(hitlChallengeId ? { _hitl_challenge_id: hitlChallengeId } : {}),
    },
    { useCaseId, vertical },
  );
}

// ─── Consent-challenge retry helpers (used by BankingAgent after HITL modal confirms) ───────────────
// These call the REST endpoint directly with a consentChallengeId so the
// server's HITL gate is satisfied. They return { result, tokenEvents } to
// match the shape returned by callMcpTool().

async function callRestTransaction(body) {
  const res = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // Surface a genuine PingOne error-fallback (debug modal) on both outcomes.
  emitAuthorizeFallback(data);
  if (!res.ok) {
    const e = Object.assign(
      new Error(
        data.message || data.error || `Transaction failed: ${res.status}`,
      ),
      { statusCode: res.status, code: data.error, data },
    );
    throw e;
  }
  return { result: data, tokenEvents: [] };
}

export function createTransferWithConsent(
  fromAccountId,
  toAccountId,
  amount,
  description,
  consentChallengeId,
) {
  return callRestTransaction({
    fromAccountId,
    toAccountId,
    amount,
    type: "transfer",
    description: description || "Agent transfer",
    consentChallengeId,
  });
}

export function createDepositWithConsent(
  accountId,
  amount,
  description,
  consentChallengeId,
) {
  return callRestTransaction({
    toAccountId: accountId,
    fromAccountId: null,
    amount,
    type: "deposit",
    description: description || "Agent deposit",
    consentChallengeId,
  });
}

export function createWithdrawalWithConsent(
  accountId,
  amount,
  description,
  consentChallengeId,
) {
  return callRestTransaction({
    fromAccountId: accountId,
    toAccountId: null,
    amount,
    type: "withdrawal",
    description: description || "Agent withdrawal",
    consentChallengeId,
  });
}

/**
 * Send a natural language message to the LangChain agent endpoint.
 * Handles 401 session-refresh retry (same pattern as callMcpTool).
 *
 * @param {string} message - User's message text
 * @param {string|null} [consentId] - Optional consent ID for HITL resume flow
 * @returns {Promise<{
 *   success?: boolean,
 *   reply?: string,
 *   tokenEvents?: Array,
 *   hitl?: boolean,
 *   consentId?: string,
 *   reason?: string,
 *   operation?: object,
 *   message?: string,
 *   error?: string,
 *   _status?: number
 * }>}
 */

/**
 * Trace-rail ingestion for the legacy (non-AG-UI) agent response. Display-only,
 * never throws. Exported for tests.
 *
 * LLM-routed runs synthesize the llmDetail that buildTraceSteps' step 4 needs —
 * the AG-UI path gets it from the streamed CUSTOM llm_detail event, but this
 * JSON path has no such event, so chip runs / non-streaming typed prompts left
 * the agent + LLM steps permanently pending.
 */
export function ingestLegacyRunTrace(data, { forceHeuristic = false } = {}) {
  try {
    const heuristicRun = forceHeuristic || data.agentPath === "heuristic";
    if (heuristicRun) {
      tokenChainTraceStore.ingestRoutingMode("heuristic", {
        action: data.toolsCalled?.[0] || data.action || null,
      });
    } else {
      tokenChainTraceStore.ingestRoutingMode("llm", {
        action: data.toolsCalled?.[0] || data.action || null,
      });
      tokenChainTraceStore.ingestLlmDetail({
        model: data.model || "session default",
        toolCalls: Array.isArray(data.toolsCalled)
          ? data.toolsCalled.map((tool) => ({ tool }))
          : [],
        usage: data.inputTokens || data.outputTokens
          ? { inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0 }
          : null,
      });
    }
    if (data.mcpAuthorizeEvaluation) {
      tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation);
    }
    if (data.mcpAuthorizeEvaluations) {
      tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations);
    }
    // Token-chain events from the response body. The agent path has no callMcpTool
    // ingest, so without this the Proof trace only sees whatever the SSE stream
    // delivered and UC1's token-exchange evidence never matched. Merge (not
    // replace) so any live SSE events already in the trace survive.
    if (Array.isArray(data.tokenEvents) && data.tokenEvents.length) {
      const existing = tokenChainTraceStore.getState().trace.tokenEvents || [];
      const merged = existing.slice();
      for (const ev of data.tokenEvents) {
        if (ev && !merged.some((e) => e.id === ev.id && e.timestamp === ev.timestamp)) {
          merged.push(ev);
        }
      }
      tokenChainTraceStore.ingestTokenEvents(merged);
    }
    // The agent envelope returns `reply` prose, not a structured `result`, so
    // synthesize a minimal mcpResult from toolsCalled — success AND failure.
    // Without the failure branch, UC30 (weather mcp_error) left TraceRail with
    // outcome=error but no mcp step error (only successful exchange/DPoP whys).
    if (Array.isArray(data.toolsCalled) && data.toolsCalled.length) {
      const failedTool = data.success === false || Boolean(data.error);
      if (failedTool) {
        const errCode = data.error
          || (typeof data.reply === "string" && /mcp_error/i.test(data.reply) ? "mcp_error" : null)
          || "tool_failed";
        // A gateway policy denial carries a specific code (e.g. weather_scope_denied)
        // and a human reason — surface those instead of the generic errCode, mark it
        // a deny (not a crash), and honour the BFF's `expected` flag so the rail can
        // frame an expectedOutcome:'DENY' use case as the control working.
        const isGatewayDeny = Boolean(data.gatewayErrorCode) || data.error === "gateway_policy_denied";
        const specificCode = data.gatewayErrorCode || errCode;
        tokenChainTraceStore.ingestMcpResult({
          tool: data.toolsCalled[0],
          toolsCalled: data.toolsCalled,
          status: "error",
          error: specificCode,
          denied: isGatewayDeny,
          expected: Boolean(data.expected),
          result: {
            error: specificCode,
            ...(data.gatewayErrorCode ? { gatewayErrorCode: data.gatewayErrorCode } : {}),
            message: data.message || data.reply || errCode,
          },
        });
      } else {
        tokenChainTraceStore.ingestMcpResult({
          tool: data.toolsCalled[0],
          toolsCalled: data.toolsCalled,
          status: "success",
        });
      }
    }
    if (typeof data.reply === "string" && data.reply) {
      tokenChainTraceStore.ingestLlmReply(data.reply);
    }
    const failed = data.success === false || Boolean(data.error);
    tokenChainTraceStore.completeTrace(!failed);
  } catch { /* display-only */ }
}

/**
 * Routes a pingone-admin-vertical message to the dedicated admin agent
 * backend (live PingOne Management API tools via adminAgentService.js) —
 * the customer/banking /api/agent/invoke path can't serve this vertical,
 * it always bounces with requiresCustomerLogin for an admin token.
 */
async function sendToAdminAgent(message, { signal, onTokenEvent } = {}) {
  try {
    tokenChainTraceStore.beginTrace({ prompt: message });
    tokenChainTraceStore.ingestRoutingMode("llm", { action: "admin-agent" });
  } catch { /* display-only */ }
  const res = await fetch("/api/admin-agent/message", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      customer: adminCustomerContext.get(),
    }),
    signal: signal || AbortSignal.timeout(30000),
  });
  const data = await res
    .json()
    .catch(() => ({ reply: "Admin agent request failed.", success: false }));
  const tokenEvents = Array.isArray(data.tokenEvents) ? data.tokenEvents : [];
  for (const ev of tokenEvents) {
    onTokenEvent?.(ev);
  }
  try {
    if (tokenEvents.length) tokenChainTraceStore.ingestTokenEvents(tokenEvents);
    tokenChainTraceStore.completeTrace(data.success !== false && !data.error);
  } catch { /* display-only */ }
  return {
    reply: data.reply,
    success: data.success,
    requiresConsent: false,
    agentConfigured: data.agentConfigured,
    agentHeader: data.agentHeader,
    error: data.error,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    tokenEvents,
    _status: res.status,
  };
}

export async function sendAgentMessage(message, consentId = null, { signal, forceHeuristic = false, vertical = null, consentGiven = false, hitlChallengeId = null, useCaseId = null, onTokenEvent } = {}) {
  if (vertical === 'pingone-admin') {
    return sendToAdminAgent(message, { signal, onTokenEvent });
  }
  const body = { prompt: message };
  if (consentId) body.consentId = consentId;
  if (useCaseId) body.useCaseId = useCaseId;
  // forceHeuristic: the caller already resolved this prompt to a vertical/banking
  // intent via /nl, so /agent/invoke must run the deterministic vertical service
  // (which holds the canned response) regardless of the session's agent_mode.
  if (forceHeuristic) body.forceHeuristic = true;
  if (vertical) body.vertical = vertical;
  if (consentGiven) body.consentGiven = true;
  // Admin dashboard's Customer Admin picker selection, if any — only used
  // server-side when the active vertical is 'admin'; a no-op otherwise.
  const _adminCustomer = adminCustomerContext.get();
  if (_adminCustomer) body.customer = _adminCustomer;
  // HITL approval retry: the BFF threads this to the pre-flight (receipt verify)
  // and the gateway (as _hitl_challenge_id) so an approved challenge PERMITs.
  if (hitlChallengeId) body.hitlChallengeId = hitlChallengeId;

  // flowTraceId binds this agent run to the live MCP flow SSE stream so the
  // compliance checklist lights up the full pipeline (token exchange, gateway,
  // execution) — not just the client-marked steps. The BFF threads it through
  // executeBffTool → runMcpToolPipeline, which publishes phase milestones and
  // token events to the hub keyed by this id.
  const flowTraceId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  body.flowTraceId = flowTraceId;

  // Fresh trace per agent turn — clears prior run checkmarks/details.
  // When forceHeuristic is set (vertical chips after /nl), mark HEURISTICS
  // immediately so Token Chain steps 4/11 check before /agent/invoke returns.
  try {
    tokenChainTraceStore.beginTrace({ prompt: message });
    if (forceHeuristic) {
      tokenChainTraceStore.ingestRoutingMode("heuristic", { action: null });
    }
  } catch { /* display-only */ }

  // Tag all API traffic entries captured during this agent turn so the panel
  // can group them. turnLabel is the first 80 chars of the prompt for display.
  const turnLabel = typeof message === "string" ? message.slice(0, 80) : String(message).slice(0, 80);
  setCurrentTurn(flowTraceId, turnLabel);

  const closeSse = openMcpFlowSse(flowTraceId, (data) => {
    if (data && data.type === "token-event") {
      const tokenEvent = { ...data };
      delete tokenEvent.type;
      onTokenEvent?.(tokenEvent);
    }
    try {
      agentFlowDiagram.applyServerEvent(data);
    } catch (_) {
      /* never let a flow-diagram update break the agent call */
    }
  });

  try {
    const opts = {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
    opts.signal = signal
      ? anySignal([AbortSignal.timeout(AGENT_INVOKE_TIMEOUT_MS), signal])
      : AbortSignal.timeout(AGENT_INVOKE_TIMEOUT_MS);

    let res = await fetch("/api/agent/invoke", opts);

    // 401: try session refresh once, then retry — skip for stub-token / dead-token
    // errors (refresh cannot help) and for need_auth (PingOne already rejected).
    if (res.status === 401) {
      const err401 = await res
        .clone()
        .json()
        .catch(() => ({}));
      const isStubToken = [
        "session_not_hydrated",
        "session_restore_required",
        "oauth_session_required",
      ].includes(err401.error);
      const skipRefresh =
        isStubToken ||
        err401.need_auth ||
        err401.error === "token_inactive";
      if (!skipRefresh) {
        const refreshed = await refreshOAuthSession();
        if (refreshed.ok) {
          res = await fetch("/api/agent/invoke", { ...opts, body: JSON.stringify(body) });
        } else {
          // After server restart the session store is empty; background polls
          // (status, token-chain) may rebuild it within a couple of seconds.
          // Give them a moment and retry once before giving up.
          await new Promise((r) => setTimeout(r, 1500));
          res = await fetch("/api/agent/invoke", { ...opts, body: JSON.stringify(body) });
        }
      }
    }

    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

    // Normalize stub-token error codes so BankingAgent shows session-fix bubble
    if (
      ["session_restore_required", "oauth_session_required"].includes(data.error)
    ) {
      data.error = "session_not_hydrated";
    }

    // Overnight / expired session: never return raw "Unauthorized" or "HTTP 401"
    if (isAuthRequiredApiError(res.status, data)) {
      const normalized = normalizeAuthFailure(401, data);
      notifySessionExpiredIfNeeded({ status: 401, body: data });
      ingestLegacyRunTrace(normalized, { forceHeuristic });
      return normalized;
    }

    // Dispatch event for latest report sidebar item
    if (res.ok && data.runId) {
      window.dispatchEvent(
        new CustomEvent("agent-run-completed", {
          detail: { runId: data.runId },
        })
      );
    }

    ingestLegacyRunTrace(data, { forceHeuristic });

    // Attach HTTP status for caller to inspect (428 = HITL required)
    return { ...data, _status: res.status };
  } finally {
    closeSse();
    clearCurrentTurn();
  }
}
