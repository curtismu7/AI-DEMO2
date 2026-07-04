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

export const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const splitScopes = (s) =>
  Array.isArray(s) ? s : typeof s === "string" ? s.split(" ").filter(Boolean) : [];
const findEvent = (events, id) => events.find((e) => e && e.id === id) || null;
const hasPhase = (phases, name) => phases.some((p) => p && p.phase === name);

function makeStep(id, status, detail) {
  return { id, title: TITLES[id], lane: LANES[id], status, detail: detail || {} };
}

export function buildTraceSteps(trace) {
  const { prompt, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize } = trace;
  const steps = [];

  // 1. signin — evidence: user-token / session-token-introspection events
  const userTok = findEvent(tokenEvents, "user-token") ||
    findEvent(tokenEvents, "session-token-introspection");
  steps.push(makeStep("signin", userTok ? "done" : "pending", userTok ? {
    narrative: "User authenticated via OIDC Authorization Code + PKCE. The BFF holds the User Token server-side — it never reaches the browser.",
    kv: Object.entries(userTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    rfcs: ["RFC 6749", "RFC 7636"],
    inspectToken: "user",
    tokenEvent: userTok,
  } : {}));

  // 2. prompt
  steps.push(makeStep("prompt", prompt ? "done" : "pending", prompt ? {
    narrative: "The browser sends only the message — no tokens; the session cookie identifies the user to the BFF.",
    request: { title: "Request (actual)",
      text: `POST /api/agent/run\n${asJson({ message: prompt.message })}` },
  } : {}));

  // 3. agent — evidence: request_accepted phase or any activity at all
  const agentSeen = hasPhase(phases, "request_accepted") || !!llmDetail;
  steps.push(makeStep("agent", agentSeen ? "done" : "pending", agentSeen ? {
    narrative: "BFF forwards to the agent. The agent loads conversation history and the gateway tool catalog (with required scopes), then prepares the LLM call.",
  } : {}));

  // 4. llm
  steps.push(makeStep("llm", llmDetail ? "done" : "pending", llmDetail ? {
    narrative: "The agent sends the conversation to the LLM. The model returns a tool call — it never sees or holds any OAuth token.",
    request: { title: "LLM request (actual)",
      text: `model: ${llmDetail.model || "?"}\n${asJson(llmDetail.request || {})}` },
    response: { title: "LLM response — tool call", text: asJson(llmDetail.toolCalls || []) },
    kv: llmDetail.usage
      ? [["tokens used", `prompt ${llmDetail.usage.inputTokens} · completion ${llmDetail.usage.outputTokens}`]]
      : [],
  } : {}));

  // 5. agent-token
  const agentTok = findEvent(tokenEvents, "agent-actor-token");
  steps.push(makeStep("agent-token", agentTok ? "done" : "pending", agentTok ? {
    narrative: "BFF obtains a client-credentials token — the agent's own identity, separate from the user's.",
    kv: Object.entries(agentTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    inspectToken: "agent",
    tokenEvent: agentTok,
  } : {}));

  // 6. exchange
  const exTok = findEvent(tokenEvents, "exchanged-token");
  const exFailed = findEvent(tokenEvents, "exchange-failed");
  const exDone = exTok && exTok.status !== "waiting";
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : exTok ? "active" : "pending",
    exDone ? {
      narrative: "BFF exchanges subject (user) + actor (agent) for one delegated token: proof the agent acts FOR this user. Scope narrows to what the tool needs; audience binds to the gateway.",
      request: exTok.exchangeRequest
        ? { title: "Exchange request (actual)", text: asJson(exTok.exchangeRequest) }
        : undefined,
      response: { title: "Delegated token claims", text: asJson(exTok.claims || {}) },
      scopeDiff: beforeScopes.length || afterScopes.length
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: exTok.claims && exTok.claims.act
        ? [["act chain", asJson(exTok.claims.act)]] : [],
      rfcs: ["RFC 8693", "RFC 8707"],
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
      narrative: "Before any tool runs, the BFF asks PingOne Authorize whether THIS user + agent may perform THIS action.",
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
        narrative: "The policy demanded step-up: the human must approve (HITL/CIBA/MFA) before the tool call proceeds.",
        kv: phases.filter((p) => p.phase && p.phase.startsWith("mfa_challenge"))
          .map((p) => [p.phase, p.label || ""]),
      }));
  }

  // 8. gateway
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  const gwIntro = findEvent(tokenEvents, "gw-introspection");
  const gwDenied = hasPhase(phases, "gateway_policy_denied");
  steps.push(makeStep("gateway",
    gwDenied ? "error" : (gwAz || gwIntro) ? "done" : "pending",
    (gwAz || gwIntro) ? {
      narrative: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: introspection, audience binding, scope, delegation chain.",
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", asJson(gwAz.statements)] : null,
      ].filter(Boolean),
      response: gwAz && gwAz.rawResponse
        ? { title: "Gateway authorize response", text: asJson(gwAz.rawResponse) } : undefined,
    } : {}));

  // 9. mcp + 10. api
  const mcpDone = hasPhase(phases, "mcp_remote_done") || !!(mcpResult && mcpResult.result);
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  steps.push(makeStep("mcp", mcpDone ? "done" : mcpBegun ? "active" : "pending",
    mcpResult ? {
      narrative: "Gateway forwards the JSON-RPC call; the MCP server re-validates the token, resolves the user from sub, and invokes the banking API with the delegated identity.",
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      kv: mcpResult.durationMs != null ? [["duration", `${mcpResult.durationMs} ms`]] : [],
    } : {}));
  steps.push(makeStep("api", mcpDone && mcpResult ? "done" : "pending",
    mcpResult && mcpResult.result ? {
      narrative: "The actual resource-server call made with the delegated bearer token.",
      response: { title: "API result", text: asJson(mcpResult.result) },
    } : {}));

  // 11. reply
  steps.push(makeStep("reply", llmReply ? "done" : "pending", llmReply ? {
    narrative: "The tool result goes back to the LLM, which writes the reply the user sees in the chat.",
    response: { title: "Streamed reply", text: String(llmReply) },
  } : {}));

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}
