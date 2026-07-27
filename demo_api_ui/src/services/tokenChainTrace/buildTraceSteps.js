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

/**
 * L0 run story for the TraceRail header — plain English, no JSON.
 * @param {object} trace
 * @param {Array} steps from buildTraceSteps
 * @returns {{ headline: string, outcome: string, bits: string[] } | null}
 */
export function buildRunStory(trace, steps) {
  if (!trace) return null;
  const hasActivity = Boolean(
    trace.startedAt || trace.prompt || (trace.tokenEvents && trace.tokenEvents.length) ||
    (trace.phases && trace.phases.length) || trace.mcpResult || trace.authorize ||
    trace.llmDetail || trace.llmReply || trace.outcome || trace.routingMode,
  );
  if (!hasActivity) return null;

  const list = Array.isArray(steps) ? steps : [];
  const errStep = list.find((s) => s && s.status === "error");
  const az = list.find((s) => s && s.id === "authorize");
  const decision = az?.detail?.decision?.outcome;
  const prompt = trace.prompt?.message;
  // An expected DENY (an expectedOutcome:'DENY' use case whose gateway block fired)
  // is the control working — present it as a successful run, not an error.
  const expectedDeny = Boolean(trace.mcpResult?.denied && trace.mcpResult?.expected);
  let outcome = trace.outcome || (errStep ? "error" : "active");
  let headline;
  if (expectedDeny) {
    outcome = "ok";
    headline = "Expected DENY — the control worked: the gateway blocked the out-of-scope call, exactly as this use case is meant to demonstrate.";
  } else if (outcome === "error" || errStep) {
    outcome = "error";
    headline = errStep
      ? `This run stopped with an error at “${errStep.title}”.`
      : "This run ended with an error.";
  } else if (outcome === "ok") {
    headline = decision
      ? `This run completed successfully — Authorize returned ${decision}.`
      : "This run completed successfully.";
  } else if (prompt) {
    headline = `In progress: “${String(prompt).slice(0, 80)}${String(prompt).length > 80 ? "…" : ""}”`;
  } else {
    headline = "Trace started — waiting for pipeline evidence.";
  }

  const bits = list
    .filter((s) => s && (s.status === "done" || s.status === "error") && s.detail?.why)
    .slice(0, 3)
    .map((s) => s.detail.why);

  return { headline, outcome, bits };
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
  steps.push(makeStep("agent", agentSeen ? "done" : traceComplete ? "notinpath" : "pending", isHeuristic ? {
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
    steps.push(makeStep("llm", llmDetail ? "done" : traceComplete ? "notinpath" : "pending", llmDetail ? {
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
  steps.push(makeStep("agent-token", agentTok ? "done" : traceComplete ? "notinpath" : "pending", agentTok ? {
    kv: Object.entries(agentTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    response: claimsBlock("Agent actor token claims (full)", agentTok.claims),
    inspectToken: "agent",
    tokenEvent: agentTok,
  } : {}));

  // 6. exchange — "exchanged-token" (1-exchange) or "two-ex-final-token"
  // (2-exchange: the final delegated MCP token with the nested act chain).
  // Attack sims (attackSimulatorService) emit their own exchange vocabulary:
  // "sim-exchange-ok" carries the deliberately-deficient delegated token.
  const exTok = findEvent(tokenEvents, "exchanged-token", "two-ex-final-token", "sim-exchange-ok");
  const exFailed = findEvent(tokenEvents, "exchange-failed", "sim-exchange-error");
  const exDone = exTok && exTok.status !== "waiting";
  const ex1Tok = findEvent(tokenEvents, "two-ex-exchange1");
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  const exchangeWhy = exDone
    ? (afterScopes.length
      ? `This run issued a delegated token with scope “${afterScopes.join(" ")}”`
        + (exTok.audActual != null ? ` and audience ${asJson(exTok.audActual)}` : "")
        + (exTok.claims?.act ? "; the act claim proves the agent acts for this user." : ".")
      : `This run completed token exchange (${exTok.exchangeMethod || "RFC 8693"}).`)
    : exFailed
      ? `Token exchange failed — without a delegated token the MCP hop cannot run.`
      : undefined;
  const exchangeBeforeAfter = exDone && userTok && exTok ? {
    before: { title: "Before exchange", text: asJson(userTok.claims || {}) },
    after: { title: "After exchange", text: asJson(exTok.claims || {}) },
  } : undefined;
  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : (exTok || ex1Tok) ? "active" : "pending",
    exDone || exFailed ? {
      why: exchangeWhy,
      request: exTok?.exchangeRequest
        ? { title: "Exchange request (actual)", text: asJson(exTok.exchangeRequest) }
        : undefined,
      response: exTok
        ? { title: "Delegated token claims", text: asJson(exTok.claims || {}) }
        : undefined,
      beforeAfter: exchangeBeforeAfter,
      scopeDiff: exDone && (beforeScopes.length || afterScopes.length)
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: exTok ? [
        exTok.claims && exTok.claims.act ? ["act chain", asJson(exTok.claims.act)] : null,
        exTok.exchangeMethod ? ["exchange method", String(exTok.exchangeMethod)] : null,
        exTok.audExpected != null
          ? ["audience", `expected ${exTok.audExpected} · actual ${exTok.audActual}${exTok.audMatches === false ? " (MISMATCH)" : ""}`]
          : null,
        ex1Tok && ex1Tok.claims && ex1Tok.claims.scope
          ? ["exchange #1 scope", String(ex1Tok.claims.scope)] : null,
      ].filter(Boolean) : [],
      inspectToken: exTok ? "mcp" : undefined,
      tokenEvent: exTok || undefined,
    } : {}));

  // 7. authorize — prefer live ingestAuthorize evaluation; fall back to the
  // synthesize authorize-decision token event; finally gw-authorize (gateway
  // often holds the only P1AZ request/response on the agent/invoke path).
  //
  // Pipeline always emits phase "authorize_denied" on a gate *block*, including
  // HTTP 428 step-up / HITL. That is a challenge, not a hard DENY — paint
  // "active" (or done after PERMIT) so TraceRail does not show a false ✗.
  const azDeniedPhase = findPhase(phases, "authorize_denied");
  const azDenied = !!azDeniedPhase;
  const azBegun = hasPhase(phases, "authorize_gate_begin");
  const azUnavailable = hasPhase(phases, "authorize_unavailable");
  const azEvent = findEvent(tokenEvents, "authorize-decision");
  const gwAzForAuthorize = findEvent(tokenEvents, "gw-authorize");
  const azPermitted = hasPhase(phases, "authorize_permitted")
    || (authorize && authorize.decision === "PERMIT")
    || String(gwAzForAuthorize?.decision || gwAzForAuthorize?.authorizeDecision || "").toUpperCase() === "PERMIT";
  const azEval = authorize || (azEvent ? {
    engine: azEvent.authorizeEngine,
    decision: azEvent.authorizeDecision || azEvent.decision,
    decisionId: azEvent.authorizeDecisionId || azEvent.decisionId,
    decisionContext: azEvent.decisionContext,
    path: azEvent.authorizePath || azEvent.path,
    request: azEvent.authorizeRequest || azEvent.request,
    response: azEvent.authorizeResponse || azEvent.response || azEvent.rawResponse,
  } : null) || (gwAzForAuthorize ? {
    engine: gwAzForAuthorize.authorizeEngine || gwAzForAuthorize.backend || "pingone",
    decision: gwAzForAuthorize.decision || gwAzForAuthorize.authorizeDecision,
    decisionId: gwAzForAuthorize.decisionId || null,
    decisionContext: gwAzForAuthorize.tool ? `tool:${gwAzForAuthorize.tool}` : null,
    path: gwAzForAuthorize.url || null,
    request: gwAzForAuthorize.authorizeRequest
      || (gwAzForAuthorize.parameters
        ? { method: "POST", url: gwAzForAuthorize.url || "", parameters: gwAzForAuthorize.parameters }
        : null),
    response: gwAzForAuthorize.authorizeResponse || gwAzForAuthorize.rawResponse || null,
    source: "gw-authorize",
  } : null);
  const azDecision = azEval && azEval.decision != null
    ? String(azEval.decision).toUpperCase()
    : "";
  const azIsPermit = azPermitted || azDecision === "PERMIT";
  const azIsDeny = azDecision === "DENY";
  // 428 block or INDETERMINATE evaluation = step-up / HITL challenge path.
  // status may arrive as a number on the phase, or only in detail ("HTTP 428")
  // from older SSE rows that did not preserve payload.status.
  let azDeniedHttp = azDeniedPhase ? Number(azDeniedPhase.status) || 0 : 0;
  if (!azDeniedHttp && azDeniedPhase && typeof azDeniedPhase.detail === "string") {
    const m = /HTTP\s+(\d+)/i.exec(azDeniedPhase.detail);
    if (m) azDeniedHttp = Number(m[1]) || 0;
  }
  const azIsChallenge = azDecision === "INDETERMINATE" || azDeniedHttp === 428;
  const azStatus = azIsPermit ? "done"
    : azIsDeny || azUnavailable || (azDenied && !azIsChallenge) ? "error"
    : azIsChallenge || azBegun || azEval ? "active"
    // Gateway-level denies (UC5/UC11/UC12 sims) block BEFORE Authorize is
    // consulted — once the trace completes with no evaluation, it was never
    // in this run's path.
    : traceComplete ? "notinpath"
    : "pending";
  const authorizeFailed = azStatus === "error";
  const azRequestPayload = azEval && azEval.request
    ? ((azEval.request.body && azEval.request.body.parameters)
        || azEval.request.parameters
        || azEval.request.body
        || azEval.request)
    : null;
  const authorizeWhy = azEval
    ? (azIsChallenge
      ? `Authorize returned ${azEval.decision || "INDETERMINATE"} — the human must approve before the tool proceeds.`
      : azIsDeny
        ? `Authorize denied this action (${azEval.engine || "policy"}) — the tool call is blocked.`
        : `Authorize returned ${azEval.decision || "PERMIT"}`
          + (azEval.decisionContext ? ` for ${azEval.decisionContext}` : "")
          + (azEval.source === "gw-authorize" ? " at the Agent Gateway hop." : " before the tool ran."))
    : undefined;
  steps.push(makeStep("authorize", azStatus,
    azEval ? {
      why: authorizeWhy,
      request: azRequestPayload || azEval.request
        ? { title: "Decision request (actual)",
            text: `${(azEval.request && azEval.request.method) || "POST"} ${(azEval.request && azEval.request.url) || ""}\n${asJson(azRequestPayload || azEval.request)}` }
        : undefined,
      response: azEval.response
        ? { title: "Decision response (raw)", text: asJson(azEval.response) } : undefined,
      decision: { outcome: azEval.decision || "INDETERMINATE",
        label: `${azEval.decision || "INDETERMINATE"} — ${azEval.engine || "?"}${azEval.decisionContext ? ` (${azEval.decisionContext})` : ""}` },
      kv: [
        ["engine", String(azEval.engine || "")],
        ["decision id", String(azEval.decisionId || "")],
        azEval.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
      ].filter((row) => row && row[1]),
      moreDetail: { href: "/pingone-authorize", label: "More Education" },
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
  // Attack sims emit "sim-gateway-deny" instead of a phase. RAR denies
  // (rar_amount_exceeded / rar_unexpected_deny) already feed the
  // intent-binding step above and must not double-report here.
  const simGwDeny = (tokenEvents || []).find(
    (e) => e && e.id === "sim-gateway-deny"
      && e.error !== "rar_amount_exceeded" && e.error !== "rar_unexpected_deny",
  );
  const gwDenied = !!gwDeniedPhase || !!simGwDeny;
  const gwSeen = !!(gwAz || gwIntro || gwInbound || gwScope);
  const gwSkipEvidence = [gwIntroRaw, gwMtls].filter((e) => e && e.status === "skipped");
  steps.push(makeStep("gateway",
    authorizeFailed ? "notinpath" : gwDenied ? "error" : gwSeen ? "done" : traceComplete ? "notinpath" : "pending",
    (gwSeen || gwDenied) ? {
      why: gwDenied
        ? "The Agent Gateway blocked this call before it reached the MCP server."
        : (gwAz
          ? `Gateway validated the delegated token`
            + (gwAz.tool ? ` and authorized tool “${gwAz.tool}”` : "")
            + (gwAz.decision ? ` (${gwAz.decision}).` : ".")
          : "Gateway processed the inbound delegated bearer on this hop."),
      decision: gwDenied
        ? { outcome: "DENY",
            // serverEvents rows use "—" as the empty-detail placeholder
            label: `DENY — ${(gwDeniedPhase
              ? (gwDeniedPhase.detail && gwDeniedPhase.detail !== "—" ? gwDeniedPhase.detail : gwDeniedPhase.label)
              : (simGwDeny.label || simGwDeny.explanation)) || "gateway policy"}` }
        : undefined,
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", asJson(gwAz.statements)] : null,
        gwInbound ? ["inbound", gwInbound.label || "user bearer received"] : null,
        gwScope ? ["scope gate", gwScope.label || "scope checked before swap"] : null,
        // invalid_aud teaching: show both sides of the mismatch (token vs gateway).
        (() => {
          const tokenAud = simGwDeny?.triedAudience || simGwDeny?.tokenAud
            || gwDeniedPhase?.triedAudience || gwDeniedPhase?.tokenAud
            || null;
          const expectedAud = simGwDeny?.allowedAudience || simGwDeny?.expectedAud
            || gwDeniedPhase?.allowedAudience || gwDeniedPhase?.expectedAud
            || null;
          if (tokenAud == null && expectedAud == null) return null;
          const actual = tokenAud != null
            ? (Array.isArray(tokenAud) ? tokenAud.join(", ") : String(tokenAud))
            : "(unknown)";
          const expected = expectedAud != null
            ? (Array.isArray(expectedAud) ? expectedAud.join(", ") : String(expectedAud))
            : "(unknown)";
          return ["audience", `token ${actual} · gateway expects ${expected} (MISMATCH)`];
        })(),
        simGwDeny ? ["attack sim", simGwDeny.explanation || simGwDeny.label] : null,
      ].filter(Boolean),
      request: (() => {
        if (!gwAz) return undefined;
        const params = gwAz.parameters
          || gwAz.authorizeRequest?.parameters
          || gwAz.authorizeRequest?.body?.parameters
          || gwAz.authorizeRequest
          || null;
        if (!params) return undefined;
        return {
          title: "Gateway → P1AZ request (actual)",
          text: `${gwAz.url ? `POST ${gwAz.url}\n` : ""}${asJson(params)}`,
        };
      })(),
      response: (() => {
        if (!gwAz) {
          return gwIntro && gwIntro.rawResponse
            ? { title: "Introspection response (RFC 7662)", text: asJson(gwIntro.rawResponse) }
            : undefined;
        }
        const body = gwAz.rawResponse || gwAz.authorizeResponse || null;
        return body
          ? { title: "Gateway authorize response", text: asJson(body) }
          : undefined;
      })(),
      moreDetail: { href: "/pingone-authorize", label: "More Education" },
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
    authorizeFailed ? "notinpath" : apiKeySwapDone ? "done" : traceComplete ? "notinpath" : "pending",
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
  // A failed MCP tool call still carries a `result` (e.g. { error, message }
  // for TraceRail), so `mcpResult.result` alone can't distinguish success from
  // failure — check mcpResult.status explicitly.
  const mcpErrored = !!(mcpResult && mcpResult.status === "error");
  const mcpDone = !mcpErrored && (hasPhase(phases, "mcp_remote_done") || !!(mcpResult && mcpResult.result));
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  steps.push(makeStep("mcp",
    authorizeFailed ? "notinpath" : mcpDone ? "done" : (gwDenied || mcpErrored) ? "error" : mcpBegun ? "active" : traceComplete ? "notinpath" : "pending",
    mcpResult ? {
      why: mcpErrored
        ? `MCP call failed for “${mcpResult.tool || mcpResult.toolName || "tool"}”${mcpResult.error ? ` (${mcpResult.error})` : ""}.`
        : `MCP executed “${mcpResult.tool || mcpResult.toolName || "tool"}”`
          + (mcpResult.durationMs != null ? ` in ${mcpResult.durationMs} ms` : "")
          + " under the delegated identity.",
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      kv: mcpResult.durationMs != null ? [["duration", `${mcpResult.durationMs} ms`]] : [],
    } : gwDenied ? {
      why: "MCP never ran — the gateway denied the call upstream.",
    } : {}));
  const apiMeta = apiMetaEarly;
  const apiKeyCall = apiMeta.credentialPath === "api_key" || apiKeyPath;
  steps.push(makeStep("api", authorizeFailed ? "notinpath" : (mcpDone && mcpResult) || apiKeyCall ? "done" : traceComplete ? "notinpath" : "pending",
    mcpResult && (mcpResult.result || apiKeyCall) ? {
      narrative: apiKeyCall
        ? "Backend call after credential swap — X-API-Key + X-User-Sub (no OAuth bearer on the wire)."
        : (mcpResult.denied && mcpResult.expected)
          ? "Expected DENY — the gateway blocked this out-of-scope call before the resource server ran. That block is the control working as designed, not a failure."
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
  const replyStep = makeStep("reply", replyDone ? "done" : traceComplete ? "notinpath" : "pending",
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
