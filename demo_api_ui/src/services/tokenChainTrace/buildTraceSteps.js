// Pure derivation: merged trace evidence -> ordered step model for the
// TokenChainTraceRail. No I/O, no store access — unit-testable in isolation.

export const LANES = {
  signin: "PINGONE", prompt: "CHAT", agent: "AGENT", llm: "LLM",
  "agent-token": "BFF", exchange: "BFF", authorize: "AUTHZ", stepup: "AUTHZ",
  "intent-binding": "AUTHZ",
  gateway: "GATEWAY", "api-key-swap": "GATEWAY", mcp: "MCP", api: "API", reply: "LLM",
};

// The delegation-to-MCP portion of the pipeline, in order. Not derivable from
// LANES (exchange shares the BFF lane with agent-token), so declared explicitly
// here alongside the rest of the step-model vocabulary — the MCP tab and the
// rail's MCP-step badge both consume it, so a step-id rename stays a one-file fix.
export const MCP_STEP_IDS = ["exchange", "gateway", "api-key-swap", "mcp", "api"];

const TITLES = {
  signin: "Sign-in — User Token acquired",
  prompt: "Chatbot — prompt sent",
  agent: "Agent service receives request",
  llm: "LLM — reasoning & tool choice",
  "agent-token": "Agent identity token",
  exchange: "Token exchange — delegation",
  authorize: "PingOne Authorize — policy decision",
  stepup: "Step-up required — HITL / MFA",
  "intent-binding": "Intent Binding Check",
  gateway: "Agent Gateway — token validated",
  "api-key-swap": "API-key path — credential swap",
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
  "intent-binding": "Verifies the requested transfer against the declared RFC 9396 authorization_details cap.",
  gateway: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: introspection, audience binding, scope, delegation chain.",
  "api-key-swap": "Path A (api_key): the gateway drops the OAuth bearer and attaches a service API key (X-API-Key + X-User-Sub). The user's bearer never reaches the downstream service.",
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
  const { prompt, routingMode, routingDetail, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize, outcome } = trace;
  const isHeuristic = routingMode === "heuristic";
  // Once the trace has a terminal outcome, any step that's still evidence-free
  // is no longer "still coming" — it was genuinely never part of this run's
  // path (mTLS off, gateway not in route, OAuth-bearer path with no API-key
  // swap, no step-up demanded). Mirrors TokenChainDisplay's notinpath bucket.
  const traceComplete = outcome === "ok" || outcome === "error";
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

  // 4. llm — heuristic runs skip the model; label/lane become HEURISTICS and mark done
  if (isHeuristic) {
    const llmStep = makeStep("llm", "done", {
      narrative: "Heuristics matched the prompt to a known intent and chose the tool — the LLM was not invoked.",
      kv: [["routing", "Heuristic match — LLM not invoked"]],
      response: {
        title: "Heuristic routing",
        text: routingDetail?.action
          ? `Matched "${routingDetail.action}" from the prompt without calling the LLM.`
          : "The BFF matched this prompt to a known intent and called the tool directly without LLM reasoning.",
      },
    });
    llmStep.title = "Heuristics — intent match & tool choice";
    llmStep.lane = "HEURISTICS";
    steps.push(llmStep);
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

  // 7a. step-up (conditional) — omitted mid-flight so it doesn't sit "pending"
  // for runs that will never need it; once the trace completes without a
  // challenge, show it as notinpath rather than silently disappearing.
  const stepUpStarted = hasPhase(phases, "mfa_challenge_initiated");
  const stepUpDone = hasPhase(phases, "mfa_challenge_completed");
  const stepUpFailed = hasPhase(phases, "mfa_challenge_failed");
  if (stepUpStarted || stepUpDone || stepUpFailed) {
    steps.push(makeStep("stepup",
      stepUpFailed ? "error" : stepUpDone ? "done" : "active", {
        kv: phases.filter((p) => p.phase && p.phase.startsWith("mfa_challenge"))
          .map((p) => [p.phase, p.label || ""]),
      }));
  } else if (traceComplete) {
    steps.push(makeStep("stepup", "notinpath", {
      narrative: "PingOne Authorize did not demand step-up for this action — no HITL/CIBA/MFA challenge was required.",
    }));
  }

  // 7b. intent-binding — RAR (RFC 9396) intent verification. Same gating as
  // step-up: omit mid-flight (not part of the default BFF→gateway chain;
  // only the Intent Binding learning demo / UC14 emit evidence). Once the
  // trace completes without evidence, mark notinpath rather than pending.
  const intentVerifiedEvent = (tokenEvents || []).find((e) => e.id === "intent-binding-verified");
  const intentDeniedEvent = (tokenEvents || []).find(
    (e) => e.id === "sim-gateway-deny" && (e.error === "rar_amount_exceeded" || e.error === "rar_unexpected_deny"),
  );
  if (intentVerifiedEvent || intentDeniedEvent) {
    steps.push(makeStep("intent-binding", intentVerifiedEvent ? "done" : "error", {
      tokenEvent: intentVerifiedEvent || intentDeniedEvent || null,
    }));
  } else if (traceComplete) {
    steps.push(makeStep("intent-binding", "notinpath", {
      narrative: "RFC 9396 RAR intent binding was not armed for this run (ff_rar off / no authorization_details attest) — not required on the default token path.",
    }));
  }

  // 8. gateway — gw-introspection/gw-mtls can arrive with status "skipped"
  // (the BFF's own signal that this leg was never part of the run: mTLS off,
  // introspection not enabled). That alone must not count as "seen" — only
  // real activity does.
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  const gwIntroRaw = findEvent(tokenEvents, "gw-introspection");
  const gwIntro = gwIntroRaw && gwIntroRaw.status !== "skipped" ? gwIntroRaw : null;
  const gwMtls = findEvent(tokenEvents, "gw-mtls");
  const gwInbound = findEvent(tokenEvents, "evt-inbound");
  const gwScope = findEvent(tokenEvents, "evt-scope");
  const gwDeniedPhase = findPhase(phases, "gateway_policy_denied");
  const gwDenied = !!gwDeniedPhase;
  const gwSeen = !!(gwAz || gwIntro || gwInbound || gwScope);
  const gwSkipEvidence = [gwIntroRaw, gwMtls].filter((e) => e && e.status === "skipped");
  steps.push(makeStep("gateway",
    gwDenied ? "error" : gwSeen ? "done" : traceComplete ? "notinpath" : "pending",
    (gwSeen || gwDenied) ? {
      decision: gwDenied
        ? { outcome: "DENY",
            // serverEvents rows use "—" as the empty-detail placeholder
            label: `DENY — ${(gwDeniedPhase.detail && gwDeniedPhase.detail !== "—" ? gwDeniedPhase.detail : gwDeniedPhase.label) || "gateway policy"}` }
        : undefined,
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", asJson(gwAz.statements)] : null,
        gwInbound ? ["inbound", gwInbound.label || "user bearer received"] : null,
        gwScope ? ["scope gate", gwScope.label || "scope checked before swap"] : null,
      ].filter(Boolean),
      response: gwAz && gwAz.rawResponse
        ? { title: "Gateway authorize response", text: asJson(gwAz.rawResponse) }
        : gwIntro && gwIntro.rawResponse
          ? { title: "Introspection response (RFC 7662)", text: asJson(gwIntro.rawResponse) } : undefined,
    } : !gwSeen && !gwDenied && gwSkipEvidence.length ? {
      narrative: gwSkipEvidence.map((e) => e.explanation).filter(Boolean).join(" ") ||
        "The Agent Gateway was not in this run's path.",
    } : {}));

  // 8b. api-key-swap — Path A credential swap (evt-swap / evt-backend from gateway _meta)
  const evtSwap = findEvent(tokenEvents, "evt-swap");
  const evtBackend = findEvent(tokenEvents, "evt-backend");
  const apiMetaEarly = (mcpResult && mcpResult._meta) || {};
  const apiKeyPath =
    apiMetaEarly.credentialPath === "api_key" ||
    !!(evtSwap || evtBackend) ||
    tokenEvents.some((e) => e && e.credentialPath === "api_key");
  const apiKeySwapDone = apiKeyPath && (evtSwap || evtBackend || apiMetaEarly.credentialPath === "api_key");
  steps.push(makeStep("api-key-swap",
    apiKeySwapDone ? "done" : traceComplete ? "notinpath" : "pending",
    apiKeyPath ? {
      kv: [
        evtSwap ? ["swap", evtSwap.label || "OAuth bearer → service API key"] : null,
        evtSwap && evtSwap.maskedValue ? ["service key", evtSwap.maskedValue] : null,
        evtBackend ? ["outbound", evtBackend.label || "backend call with X-API-Key"] : null,
        apiMetaEarly.apiCall ? ["api call", apiMetaEarly.apiCall] : null,
        apiMetaEarly.apiKeyMaskedLast4 ? ["key last4", `••••${apiMetaEarly.apiKeyMaskedLast4}`] : null,
      ].filter(Boolean),
      response: evtSwap || evtBackend
        ? { title: "API-key path events", text: asJson([evtSwap, evtBackend].filter(Boolean)) }
        : undefined,
    } : !apiKeySwapDone && traceComplete ? {
      narrative: "This run used the delegated OAuth bearer path — no API-key credential swap occurred.",
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
  const apiMeta = apiMetaEarly;
  const apiKeyCall = apiMeta.credentialPath === "api_key" || apiKeyPath;
  steps.push(makeStep("api", (mcpDone && mcpResult) || apiKeyCall ? "done" : "pending",
    mcpResult && (mcpResult.result || apiKeyCall) ? {
      narrative: apiKeyCall
        ? "Backend call after credential swap — X-API-Key + X-User-Sub (no OAuth bearer on the wire)."
        : "The actual resource-server call made with the delegated bearer token.",
      response: mcpResult.result ? { title: "API result", text: asJson(mcpResult.result) } : undefined,
      kv: [
        apiKeyCall && apiMeta.apiCall ? ["api call", apiMeta.apiCall] : null,
        apiKeyCall && apiMeta.apiKeyMaskedLast4 ? ["service key", `••••${apiMeta.apiKeyMaskedLast4}`] : null,
        evtBackend ? ["backend", evtBackend.label] : null,
      ].filter(Boolean),
    } : {}));

  // 11. reply — heuristics compose from the tool result (no LLM); chip paths
  // often have mcpResult but no llmReply, so either evidence marks the step done.
  const replyDone = Boolean(llmReply) || (isHeuristic && mcpDone);
  const replyStep = makeStep("reply", replyDone ? "done" : "pending",
    llmReply ? {
      response: { title: "Streamed reply", text: String(llmReply) },
    } : isHeuristic && mcpDone ? {
      narrative: "Heuristics formatted the tool result into the chat reply — no LLM composition.",
      response: mcpResult && mcpResult.result
        ? { title: "Composed reply (from tool result)", text: asJson(mcpResult.result) }
        : undefined,
    } : {});
  if (isHeuristic) {
    replyStep.title = "Heuristics composes reply → chat";
    replyStep.lane = "HEURISTICS";
  }
  steps.push(replyStep);

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}
