// Pure derivation: merged trace evidence -> ordered step model for the
// TokenChainTraceRail. No I/O, no store access — unit-testable in isolation.

export const LANES = {
  signin: "PINGONE", prompt: "CHAT", agent: "AGENT", llm: "LLM",
  "agent-token": "BFF", exchange: "BFF", authorize: "AUTHZ", stepup: "AUTHZ",
  gateway: "GATEWAY", mcp: "MCP", api: "API", reply: "LLM",
};

// The delegation-to-MCP portion of the pipeline, in order. Not derivable from
// LANES (exchange shares the BFF lane with agent-token), so declared explicitly
// here alongside the rest of the step-model vocabulary — the MCP tab and the
// rail's MCP-step badge both consume it, so a step-id rename stays a one-file fix.
export const MCP_STEP_IDS = ["exchange", "gateway", "mcp", "api"];

const TITLES = {
  signin: "Sign-in — User Token acquired",
  prompt: "Chatbot — prompt sent",
  agent: "Agent service receives request",
  llm: "LLM — reasoning & tool choice",
  "agent-token": "Agent identity token",
  exchange: "Token exchange — delegation",
  authorize: "PingOne Authorize — policy decision",
  stepup: "Step-up required — HITL / MFA",
  gateway: "Agent Gateway — token validated",
  mcp: "MCP server — tool executes",
  api: "Resource server — API call",
  reply: "LLM composes reply → chat",
};

// What each hop does — always shown when a step is expanded, even before its
// live evidence arrives, so no step ever opens to a blank body. The live
// request / response / claims are layered on top by buildTraceSteps whenever
// the matching trace evidence exists.
const NARRATIVES = {
  signin: "User authenticated via OIDC Authorization Code + PKCE. The BFF holds the User Token server-side — it never reaches the browser.",
  prompt: "The browser sends only the message — no tokens; the session cookie identifies the user to the BFF.",
  agent: "BFF forwards to the agent. The agent loads conversation history and the gateway tool catalog (with required scopes), then prepares the LLM call.",
  llm: "The agent sends the conversation to the LLM. The model returns a tool call — it never sees or holds any OAuth token.",
  "agent-token": "BFF obtains a client-credentials token — the agent's own identity, separate from the user's.",
  exchange: "BFF exchanges subject (user) + actor (agent) for one delegated token: proof the agent acts FOR this user. Scope narrows to what the tool needs; audience binds to the gateway.",
  authorize: "Before any tool runs, the BFF asks PingOne Authorize whether THIS user + agent may perform THIS action.",
  stepup: "The policy demanded step-up: the human must approve (HITL/CIBA/MFA) before the tool call proceeds.",
  gateway: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: introspection, audience binding, scope, delegation chain.",
  mcp: "Gateway forwards the JSON-RPC call; the MCP server re-validates the token, resolves the user from sub, and invokes the banking API with the delegated identity.",
  api: "The actual resource-server call made with the delegated bearer token.",
  reply: "The tool result goes back to the LLM, which writes the reply the user sees in the chat.",
};

// Static RFC references per hop — teaching content, shown regardless of evidence.
const STEP_RFCS = {
  signin: ["RFC 6749", "RFC 7636"],
  exchange: ["RFC 8693", "RFC 8707"],
};

export const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const splitScopes = (s) =>
  Array.isArray(s) ? s : typeof s === "string" ? s.split(" ").filter(Boolean) : [];
// Accepts multiple ids: the BFF emits a different event vocabulary per exchange
// mode — 1-exchange ("agent-actor-token", "exchanged-token") vs 2-exchange
// ("two-ex-agent-actor", "two-ex-final-token"). Both must light up the rail.
const findEvent = (events, ...ids) => events.find((e) => e && ids.includes(e.id)) || null;
const hasPhase = (phases, name) => phases.some((p) => p && p.phase === name);
const findPhase = (phases, name) => phases.find((p) => p && p.phase === name) || null;
const claimsBlock = (title, claims) =>
  claims && Object.keys(claims).length ? { title, text: asJson(claims) } : undefined;

function makeStep(id, status, detail) {
  const base = { narrative: NARRATIVES[id] };
  if (STEP_RFCS[id]) base.rfcs = STEP_RFCS[id];
  // base first so live evidence in `detail` overrides/extends it; base narrative
  // guarantees the expanded body is never blank even for not-yet-run steps.
  return { id, title: TITLES[id], lane: LANES[id], status, detail: { ...base, ...(detail || {}) } };
}

export function buildTraceSteps(trace) {
  const { prompt, routingMode, routingDetail, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize } = trace;
  const isHeuristic = routingMode === "heuristic";
  const steps = [];

  // 1. signin — evidence: user-token / session-token-introspection events
  const userTok = findEvent(tokenEvents, "user-token") ||
    findEvent(tokenEvents, "session-token-introspection");
  steps.push(makeStep("signin", userTok ? "done" : "pending", userTok ? {
    kv: Object.entries(userTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    response: claimsBlock("User token claims (full)", userTok.claims),
    inspectToken: "user",
    tokenEvent: userTok,
  } : {}));

  // 2. prompt
  steps.push(makeStep("prompt", prompt ? "done" : "pending", prompt ? {
    request: { title: "Request (actual)",
      text: `POST /api/agent/run\n${asJson({ message: prompt.message })}` },
  } : {}));

  // 3. agent — evidence: request_accepted phase, LLM activity, or heuristic routing
  const agentSeen = isHeuristic || hasPhase(phases, "request_accepted") || !!llmDetail;
  steps.push(makeStep("agent", agentSeen ? "done" : "pending", isHeuristic ? {
    kv: [
      ["routing", "Heuristic intent match"],
      routingDetail?.action ? ["matched action", String(routingDetail.action)] : null,
    ].filter(Boolean),
  } : {}));

  // 4. llm — heuristic runs skip the model but the step still lights up as bypassed
  if (isHeuristic) {
    steps.push(makeStep("llm", "done", {
      kv: [["routing", "Heuristic match — LLM not invoked"]],
      response: {
        title: "Heuristic routing",
        text: routingDetail?.action
          ? `Matched "${routingDetail.action}" from the prompt without calling the LLM.`
          : "The BFF matched this prompt to a known intent and called the tool directly without LLM reasoning.",
      },
    }));
  } else {
    steps.push(makeStep("llm", llmDetail ? "done" : "pending", llmDetail ? {
      request: { title: "LLM request (actual)",
        text: `model: ${llmDetail.model || "?"}\n${asJson(llmDetail.request || {})}` },
      response: { title: "LLM response — tool call", text: asJson(llmDetail.toolCalls || []) },
      kv: llmDetail.usage
        ? [["tokens used", `prompt ${llmDetail.usage.inputTokens} · completion ${llmDetail.usage.outputTokens}`]]
        : [],
    } : {}));
  }

  // 5. agent-token
  const agentTok = findEvent(tokenEvents, "agent-actor-token", "two-ex-agent-actor");
  steps.push(makeStep("agent-token", agentTok ? "done" : "pending", agentTok ? {
    kv: Object.entries(agentTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    response: claimsBlock("Agent actor token claims (full)", agentTok.claims),
    inspectToken: "agent",
    tokenEvent: agentTok,
  } : {}));

  // 6. exchange — "exchanged-token" (1-exchange) or "two-ex-final-token"
  // (2-exchange: the final delegated MCP token with the nested act chain).
  const exTok = findEvent(tokenEvents, "exchanged-token", "two-ex-final-token");
  const exFailed = findEvent(tokenEvents, "exchange-failed");
  const exDone = exTok && exTok.status !== "waiting";
  const ex1Tok = findEvent(tokenEvents, "two-ex-exchange1");
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : (exTok || ex1Tok) ? "active" : "pending",
    exDone ? {
      request: exTok.exchangeRequest
        ? { title: "Exchange request (actual)", text: asJson(exTok.exchangeRequest) }
        : undefined,
      response: { title: "Delegated token claims", text: asJson(exTok.claims || {}) },
      scopeDiff: beforeScopes.length || afterScopes.length
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: [
        exTok.claims && exTok.claims.act ? ["act chain", asJson(exTok.claims.act)] : null,
        exTok.exchangeMethod ? ["exchange method", String(exTok.exchangeMethod)] : null,
        exTok.audExpected != null
          ? ["audience", `expected ${exTok.audExpected} · actual ${exTok.audActual}${exTok.audMatches === false ? " (MISMATCH)" : ""}`]
          : null,
        ex1Tok && ex1Tok.claims && ex1Tok.claims.scope
          ? ["exchange #1 scope", String(ex1Tok.claims.scope)] : null,
      ].filter(Boolean),
      inspectToken: "mcp",
      tokenEvent: exTok,
    } : {}));

  // 7. authorize
  const azDenied = hasPhase(phases, "authorize_denied");
  const azPermitted = hasPhase(phases, "authorize_permitted") || (authorize && authorize.decision === "PERMIT");
  const azBegun = hasPhase(phases, "authorize_gate_begin");
  steps.push(makeStep("authorize",
    azDenied ? "error" : azPermitted ? "done" : azBegun ? "active" : "pending",
    authorize ? {
      request: authorize.request ? { title: "Decision request (actual)",
        text: `${authorize.request.method || "POST"} ${authorize.request.url || ""}\n${asJson((authorize.request.body && authorize.request.body.parameters) || authorize.request.parameters || authorize.request.body || {})}` } : undefined,
      response: authorize.response
        ? { title: "Decision response (raw)", text: asJson(authorize.response) } : undefined,
      decision: { outcome: authorize.decision || "INDETERMINATE",
        label: `${authorize.decision || "INDETERMINATE"} — ${authorize.engine || "?"}${authorize.decisionContext ? ` (${authorize.decisionContext})` : ""}` },
      kv: [
        ["engine", String(authorize.engine || "")],
        ["decision id", String(authorize.decisionId || "")],
      ].filter(([, v]) => v),
    } : {}));

  // 7a. step-up (conditional)
  const stepUpStarted = hasPhase(phases, "mfa_challenge_initiated");
  const stepUpDone = hasPhase(phases, "mfa_challenge_completed");
  const stepUpFailed = hasPhase(phases, "mfa_challenge_failed");
  if (stepUpStarted || stepUpDone || stepUpFailed) {
    steps.push(makeStep("stepup",
      stepUpFailed ? "error" : stepUpDone ? "done" : "active", {
        kv: phases.filter((p) => p.phase && p.phase.startsWith("mfa_challenge"))
          .map((p) => [p.phase, p.label || ""]),
      }));
  }

  // 8. gateway
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  const gwIntro = findEvent(tokenEvents, "gw-introspection");
  const gwDeniedPhase = findPhase(phases, "gateway_policy_denied");
  const gwDenied = !!gwDeniedPhase;
  steps.push(makeStep("gateway",
    gwDenied ? "error" : (gwAz || gwIntro) ? "done" : "pending",
    (gwAz || gwIntro || gwDenied) ? {
      decision: gwDenied
        ? { outcome: "DENY",
            // serverEvents rows use "—" as the empty-detail placeholder
            label: `DENY — ${(gwDeniedPhase.detail && gwDeniedPhase.detail !== "—" ? gwDeniedPhase.detail : gwDeniedPhase.label) || "gateway policy"}` }
        : undefined,
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", asJson(gwAz.statements)] : null,
      ].filter(Boolean),
      response: gwAz && gwAz.rawResponse
        ? { title: "Gateway authorize response", text: asJson(gwAz.rawResponse) }
        : gwIntro && gwIntro.rawResponse
          ? { title: "Introspection response (RFC 7662)", text: asJson(gwIntro.rawResponse) } : undefined,
    } : {}));

  // 9. mcp + 10. api — a gateway denial means the call never reached the MCP
  // server; surface that as an error instead of leaving the step stuck "active".
  const mcpDone = hasPhase(phases, "mcp_remote_done") || !!(mcpResult && mcpResult.result);
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  steps.push(makeStep("mcp",
    mcpDone ? "done" : gwDenied ? "error" : mcpBegun ? "active" : "pending",
    mcpResult ? {
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      kv: mcpResult.durationMs != null ? [["duration", `${mcpResult.durationMs} ms`]] : [],
    } : {}));
  const apiMeta = (mcpResult && mcpResult._meta) || {};
  const apiKeyCall = apiMeta.credentialPath === "api_key";
  steps.push(makeStep("api", (mcpDone && mcpResult) || apiKeyCall ? "done" : "pending",
    mcpResult && (mcpResult.result || apiKeyCall) ? {
      narrative: "The actual resource-server call made with the delegated bearer token.",
      response: mcpResult.result ? { title: "API result", text: asJson(mcpResult.result) } : undefined,
      kv: [
        apiKeyCall && apiMeta.apiCall ? ["api call", apiMeta.apiCall] : null,
        apiKeyCall && apiMeta.apiKeyMaskedLast4 ? ["service key", `••••${apiMeta.apiKeyMaskedLast4}`] : null,
      ].filter(Boolean),
    } : {}));

  // 11. reply
  steps.push(makeStep("reply", llmReply ? "done" : "pending", llmReply ? {
    response: { title: "Streamed reply", text: String(llmReply) },
  } : {}));

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}
