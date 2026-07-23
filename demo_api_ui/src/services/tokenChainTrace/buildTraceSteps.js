// Pure derivation: merged trace evidence -> ordered step model for the
// TokenChainTraceRail. No I/O, no store access — unit-testable in isolation.

export const LANES = {
  signin: "PINGONE", refresh: "PINGONE", prompt: "CHAT", agent: "AGENT", llm: "LLM",
  "agent-token": "BFF", exchange: "BFF", dpop: "PINGONE", rar: "AUTHZ", jwks: "PINGONE",
  authorize: "AUTHZ", stepup: "AUTHZ",
  "intent-binding": "AUTHZ",
  introspection: "PINGONE", mtls: "GATEWAY",
  gateway: "GATEWAY", "api-key-swap": "GATEWAY", "dual-token": "GATEWAY",
  mcp: "MCP", api: "API", reply: "LLM",
};

export const MCP_STEP_IDS = [
  "exchange", "dpop", "rar", "jwks", "introspection", "mtls",
  "gateway", "api-key-swap", "dual-token", "mcp", "api",
];

/** Event ids that carry RFC 7515/7517 JWKS (or introspection-fallback) verify results. */
export const JWKS_VERIFIED_IDS = [
  "exchanged-token-verified",
  "agent-actor-token-verified",
  "two-ex-agent-actor-verified",
  "two-ex-exchange1-verified",
  "two-ex-mcp-actor-verified",
  "two-ex-final-token-verified",
];

/** Per-use-case L1 why tips (keyed by stampUseCaseId / attack sim slug). */
export const UC_WHY = {
  "insufficient-scope": "Expect gateway DENY for missing delegated scopes.",
  "confused-deputy-actor-injection": "Expect DENY — forged act / wrong actor must not pass.",
  "authz-denied": "Expect PingOne Authorize DENY for this tool/user pairing.",
  "step-up-required": "Expect INDETERMINATE / step-up before the tool proceeds.",
  "hitl-consent": "Expect human consent (HITL) before the money movement.",
  "ciba-out-of-band-approval": "Expect CIBA out-of-band approval before proceeding.",
  "rar-intent-violation": "Expect DENY — requested amount exceeds RAR authorization_details.",
  "rar-intent-verified": "Expect PERMIT — amount within attested RAR cap.",
  "intent-token-tampering": "Expect DENY — tampered intent token signature.",
  "token-theft-replay": "Expect DENY / fail — stolen bearer without DPoP key is useless.",
  "bad-client-gateway": "Expect gateway reject for wrong audience / client.",
  "overscoped-agent": "Teaching: agent token scopes are narrowed at exchange.",
  "a2a-delegation": "Teaching: agent-to-agent nested act chain (two-exchange).",
  "delegated-access-with-proof": "Happy-path teaching: full delegated MCP call with proof.",
};

const TITLES = {
  signin: "Sign-in — User Token acquired",
  refresh: "Silent token refresh — RFC 6749 §6",
  prompt: "Chatbot — prompt sent",
  agent: "Agent service receives request",
  llm: "LLM — reasoning & tool choice",
  "agent-token": "Agent identity token",
  exchange: "Token exchange — delegation",
  dpop: "DPoP — sender-constrained token",
  rar: "RAR — rich authorization details",
  jwks: "JWKS — signature verification",
  authorize: "PingOne Authorize — policy decision",
  stepup: "Step-up required — HITL / MFA",
  "intent-binding": "Intent Binding Check",
  introspection: "Token introspection — RFC 7662",
  mtls: "mTLS — gateway ↔ MCP",
  gateway: "Agent Gateway — token validated",
  "api-key-swap": "API-key path — credential swap",
  "dual-token": "Dual-token path — access + ID token",
  mcp: "MCP server — tool executes",
  api: "Resource server — API call",
  reply: "LLM composes reply → chat",
};

const NARRATIVES = {
  signin: "User authenticated via OIDC Authorization Code + PKCE. The BFF holds the User Token server-side — it never reaches the browser.",
  refresh: "When the access token nears expiry, the BFF silently uses the refresh token (RFC 6749 §6) so the demo continues without a re-login. Tokens still never reach the browser.",
  prompt: "The browser sends only the message — no tokens; the session cookie identifies the user to the BFF.",
  agent: "BFF forwards to the agent. The agent loads conversation history and the gateway tool catalog (with required scopes), then prepares the LLM call.",
  llm: "The agent sends the conversation to the LLM. The model returns a tool call — it never sees or holds any OAuth token.",
  "agent-token": "BFF obtains a client-credentials token — the agent's own identity, separate from the user's.",
  exchange: "BFF exchanges subject (user) + actor (agent) for one delegated token: proof the agent acts FOR this user. Scope narrows to what the tool needs; audience binds to the gateway. Two-exchange mode nests act claims across two hops.",
  dpop: "RFC 9449: the delegated token is bound to a per-session key (cnf.jkt). Each hop carries a signed DPoP proof — a stolen bearer alone cannot call the API.",
  rar: "RFC 9396: authorization_details bind the agent to THIS action (amount, payee, tool) — not a broad standing scope.",
  jwks: "After tokens are issued, the BFF verifies JWT signatures against PingOne's published JWKS (/.well-known/jwks.json). Introspection is used only when JWKS is unavailable.",
  authorize: "Before any tool runs, the BFF asks PingOne Authorize whether THIS user + agent may perform THIS action.",
  stepup: "The policy demanded step-up: the human must approve (HITL/CIBA/MFA) before the tool call proceeds.",
  "intent-binding": "Verifies the requested transfer against the declared RFC 9396 authorization_details cap.",
  introspection: "PingOne (or the gateway) answers whether the token is still active — revocation and expiry that JWKS alone cannot see. Covers BFF session checks and gateway RFC 7662 introspection.",
  mtls: "Optional mutual TLS between the Agent Gateway and the MCP server — client certificate identity on the wire, independent of the OAuth bearer.",
  gateway: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: audience binding, scope, and the delegation chain (after introspection).",
  "api-key-swap": "Path A (api_key): the gateway drops the OAuth bearer and attaches a service API key (X-API-Key + X-User-Sub). The user's bearer never reaches the downstream service.",
  "dual-token": "Path B (dual_token): gateway validates the access token and also presents/fetches an ID token segment for identity teaching (profile card / access+id path).",
  mcp: "Gateway forwards the JSON-RPC call; the MCP server re-validates the token, resolves the user from sub, and invokes the banking API with the delegated identity.",
  api: "The actual resource-server call made with the delegated bearer token.",
  reply: "The tool result goes back to the LLM, which writes the reply the user sees in the chat.",
};

const STEP_RFCS = {
  signin: ["RFC 6749", "RFC 7636"],
  refresh: ["RFC 6749 §6"],
  exchange: ["RFC 8693", "RFC 8707"],
  dpop: ["RFC 9449"],
  rar: ["RFC 9396"],
  jwks: ["RFC 7515", "RFC 7517"],
  introspection: ["RFC 7662"],
};

/**
 * Live TraceRail → education deep-link (drawer panel id + tab, or full page href).
 * Panel ids match `EDU.*` string values in educationIds.js — keep this module UI-free.
 */
export const STEP_EDU = {
  signin: { edu: "login-flow", tab: "what", label: "Learn: sign-in (OIDC + PKCE)" },
  refresh: { edu: "token-exchange", tab: "why", label: "Learn: token lifecycle" },
  prompt: { edu: "web-mcp", tab: "overview", label: "Learn: WebMCP / BFF" },
  agent: { edu: "agent-frameworks", tab: "what", label: "Learn: agent frameworks" },
  llm: { edu: "llm-landscape", tab: "overview", label: "Learn: LLM landscape" },
  "agent-token": { edu: "may-act", tab: "what", label: "Learn: act / may_act" },
  exchange: { edu: "token-exchange", tab: "why", label: "Learn: Token Exchange (RFC 8693)" },
  dpop: { edu: "dpop", tab: "what", label: "Learn: DPoP (RFC 9449)" },
  rar: { edu: "rar", tab: "what", label: "Learn: RAR (RFC 9396)" },
  "intent-binding": { edu: "intent-delegation", tab: "what", label: "Learn: intent-bound delegation" },
  jwks: { edu: "introspection", tab: "why", label: "Learn: token validation" },
  introspection: { edu: "introspection", tab: "why", label: "Learn: introspection (RFC 7662)" },
  authorize: { href: "/pingone-authorize", label: "Open PingOne Authorize" },
  stepup: { edu: "step-up", tab: "what", label: "Learn: step-up authentication" },
  mtls: { edu: "pinggateway-mcp", tab: "overview", label: "Learn: PingGateway + MCP" },
  gateway: { edu: "agent-gateway", tab: "overview", label: "Learn: Agent Gateway" },
  "api-key-swap": { edu: "agent-gateway", tab: "overview", label: "Learn: gateway credential paths" },
  "dual-token": { edu: "token-flow", tab: "diagram", label: "Learn: end-to-end token flow" },
  mcp: { edu: "mcp-protocol", tab: "what", label: "Learn: MCP protocol" },
  api: { edu: "token-flow", tab: "diagram", label: "Learn: end-to-end token flow" },
  reply: { edu: "mcp-protocol", tab: "what", label: "Learn: MCP protocol" },
};

/** Attach STEP_EDU moreDetail when the step has none yet. */
function withEduLink(detail, stepId) {
  const link = STEP_EDU[stepId];
  if (!link) return detail;
  if (detail?.moreDetail) return detail;
  return { ...(detail || {}), moreDetail: { ...link } };
}

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

/** First stamped use-case id on the run (attack sims / demo chips). */
function firstUseCaseId(tokenEvents) {
  const hit = (tokenEvents || []).find((e) => e && e.useCaseId);
  return hit?.useCaseId || null;
}

/** Append UC-specific teaching tip onto detail.why when known. */
function withUcWhy(detail, ucId) {
  if (!detail || !ucId || !UC_WHY[ucId]) return detail;
  const tip = UC_WHY[ucId];
  const prefix = `[${ucId}] ${tip}`;
  return {
    ...detail,
    why: detail.why ? `${detail.why} ${prefix}` : prefix,
  };
}

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
  let outcome = trace.outcome || (errStep ? "error" : "active");
  let headline;
  if (outcome === "error" || errStep) {
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

  // Prefer the failing step's why first so the story doesn't look like a
  // successful exchange when MCP failed after the token hops.
  const withWhy = list.filter((s) => s && (s.status === "done" || s.status === "error") && s.detail?.why);
  const errBits = withWhy.filter((s) => s.status === "error");
  const okBits = withWhy.filter((s) => s.status === "done");
  const bits = [...errBits, ...okBits].slice(0, 3).map((s) => s.detail.why);

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

  // 1. signin — OIDC user token + optional login-time PingOne introspection
  const userTok = findEvent(tokenEvents, "user-token");
  const loginIntro = findEvent(tokenEvents, "user-token-introspection");
  const sessionIntroForSignin = !userTok && !loginIntro
    ? findEvent(tokenEvents, "session-token-introspection")
    : null;
  const signinEv = userTok || loginIntro || sessionIntroForSignin;
  const signinClaims = userTok?.claims
    || loginIntro?.claims
    || loginIntro?.introspectionResult
    || sessionIntroForSignin?.claims
    || null;
  const signinIntroBody = loginIntro?.introspectionResult
    || (loginIntro?.claims ? { active: loginIntro.status === "active" || loginIntro.status === "valid", ...loginIntro.claims } : null)
    || sessionIntroForSignin?.introspectionResult
    || null;
  steps.push(makeStep("signin", signinEv ? "done" : "pending", signinEv ? {
    why: loginIntro
      ? (loginIntro.status === "failed" || loginIntro.status === "revoked"
        ? "PingOne introspection reported the user token inactive at login."
        : loginIntro.status === "skipped"
          ? "Sign-in acquired a user token; login-time introspection was skipped."
          : "OIDC login completed; PingOne confirmed the user token active (RFC 7662).")
      : "OIDC Authorization Code + PKCE completed; the BFF holds the user access token.",
    kv: [
      ...(Object.entries(signinClaims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)])),
      loginIntro ? ["login introspection", String(loginIntro.status)] : null,
      loginIntro?.rfc ? ["rfc", loginIntro.rfc] : null,
    ].filter(Boolean),
    request: loginIntro ? {
      title: "BFF → PingOne introspect (login)",
      text: asJson({
        endpoint: "POST /as/introspect",
        token_type_hint: "access_token",
        note: "Called once per login; result may be cached on the session.",
      }),
    } : undefined,
    response: signinIntroBody
      ? { title: "Introspection / user claims", text: asJson(signinIntroBody) }
      : claimsBlock("User token claims (full)", signinClaims),
    inspectToken: "user",
    tokenEvent: userTok || loginIntro || sessionIntroForSignin,
  } : {}));

  // 1b. refresh — silent RFC 6749 §6 access-token refresh (optional hop)
  const refreshEv = findEvent(tokenEvents, "token-refresh");
  steps.push(makeStep("refresh",
    refreshEv ? "done" : traceComplete ? "notinpath" : "pending",
    refreshEv ? {
      why: "Access token was silently refreshed this request — session continued without re-login.",
      kv: [
        refreshEv.rfc ? ["rfc", String(refreshEv.rfc)] : ["rfc", "RFC 6749 §6"],
        refreshEv.refreshedAt ? ["refreshed at", String(refreshEv.refreshedAt)] : null,
      ].filter(Boolean),
      response: claimsBlock("Refreshed access token claims", refreshEv.claims),
      tokenEvent: refreshEv,
    } : traceComplete ? {
      narrative: "No silent refresh on this run — the existing access token was still valid.",
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
  // Failures arrive as "exchange-failed" / "sim-exchange-error", OR as a final
  // token event with status "failed"/"error" (must not render as a blank done).
  const exTok = findEvent(tokenEvents, "exchanged-token", "two-ex-final-token", "sim-exchange-ok");
  const exFailedNamed = findEvent(tokenEvents, "exchange-failed", "sim-exchange-error");
  const exTokIsFailed = !!(exTok && (exTok.status === "failed" || exTok.status === "error"));
  const exFailed = exFailedNamed || (exTokIsFailed ? exTok : null);
  const exDone = !!(exTok && !exFailed && exTok.status !== "waiting");
  const ex1Tok = findEvent(tokenEvents, "two-ex-exchange1");
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  const exchangeReq = exTok?.exchangeRequest || exFailed?.exchangeRequest || exFailed?.requestContext || null;
  const exchangeWhy = exFailed
    ? (exFailed.explanation
      || (exFailed.pingoneErrorDescription
        ? `Token exchange failed — ${exFailed.pingoneError || "error"}: ${exFailed.pingoneErrorDescription}`
        : null)
      || (exFailed.error ? `Token exchange failed — ${exFailed.error}` : null)
      || "Token exchange failed — without a delegated token the MCP hop cannot run.")
    : exDone
      ? (ex1Tok
        ? `Two-exchange path: hop #1 issued an intermediate token`
          + (ex1Tok.claims?.scope ? ` (scope “${ex1Tok.claims.scope}”)` : "")
          + `; final hop issued the MCP token`
          + (afterScopes.length ? ` with scope “${afterScopes.join(" ")}”` : "")
          + (exTok.claims?.act ? "; nested act proves the delegation chain." : ".")
        : (afterScopes.length
          ? `This run issued a delegated token with scope “${afterScopes.join(" ")}”`
            + (exTok.audActual != null ? ` and audience ${asJson(exTok.audActual)}` : "")
            + (exTok.claims?.act ? "; the act claim proves the agent acts for this user." : ".")
          : `This run completed token exchange (${exTok.exchangeMethod || "RFC 8693"}).`))
      : undefined;
  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : (exTok || ex1Tok) ? "active" : "pending",
    exDone || exFailed ? {
      why: exchangeWhy,
      request: exchangeReq
        ? { title: ex1Tok ? "Exchange #2 request (final)" : "Exchange request (actual)", text: asJson(exchangeReq) }
        : undefined,
      response: exFailed
        ? {
          title: "Exchange error",
          text: asJson({
            error: exFailed.error || exFailed.pingoneError || null,
            pingoneError: exFailed.pingoneError || null,
            pingoneErrorDescription: exFailed.pingoneErrorDescription || null,
            pingoneErrorDetail: exFailed.pingoneErrorDetail || null,
            httpStatus: exFailed.httpStatus || null,
            explanation: exFailed.explanation || null,
            requestContext: exFailed.requestContext || null,
          }),
        }
        : exTok
          ? { title: ex1Tok ? "Final delegated token claims (nested act)" : "Delegated token claims", text: asJson(exTok.claims || {}) }
          : undefined,
      altRequest: ex1Tok?.exchangeRequest
        ? { title: "Exchange #1 request (intermediate)", text: asJson(ex1Tok.exchangeRequest) }
        : undefined,
      altResponse: ex1Tok?.claims
        ? { title: "Exchange #1 intermediate claims", text: asJson(ex1Tok.claims) }
        : undefined,
      scopeDiff: exDone && (beforeScopes.length || afterScopes.length)
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: [
        ...(exFailed ? [
          exFailed.httpStatus != null ? ["http status", String(exFailed.httpStatus)] : null,
          (exFailed.pingoneError || exFailed.error)
            ? ["error", String(exFailed.pingoneError || exFailed.error)] : null,
          exFailed.pingoneErrorDescription
            ? ["description", String(exFailed.pingoneErrorDescription)] : null,
          exFailed.rfc ? ["rfc", String(exFailed.rfc)] : ["rfc", "RFC 8693"],
        ] : []),
        ...(exTok && !exFailed ? [
          ex1Tok ? ["mode", "2-exchange"] : ["mode", "1-exchange"],
          exTok.claims && exTok.claims.act ? ["act chain", asJson(exTok.claims.act)] : null,
          exTok.exchangeMethod ? ["exchange method", String(exTok.exchangeMethod)] : null,
          exTok.audExpected != null
            ? ["audience", `expected ${exTok.audExpected} · actual ${exTok.audActual}${exTok.audMatches === false ? " (MISMATCH)" : ""}`]
            : null,
          ex1Tok && ex1Tok.claims && ex1Tok.claims.scope
            ? ["exchange #1 scope", String(ex1Tok.claims.scope)] : null,
        ] : []),
      ].filter(Boolean),
      inspectToken: exDone && exTok ? "mcp" : undefined,
      tokenEvent: exFailed || exTok || undefined,
    } : {}));

  // 6a. dpop — RFC 9449 sender-constrained binding
  const dpopEv = findEvent(tokenEvents, "dpop-binding");
  steps.push(makeStep("dpop",
    dpopEv ? (dpopEv.status === "failed" ? "error" : "done") : traceComplete ? "notinpath" : "pending",
    dpopEv ? {
      why: dpopEv.explanation || "Delegated token bound to session DPoP key (cnf.jkt).",
      kv: [
        dpopEv.cnf?.jkt || dpopEv.claims?.cnf?.jkt
          ? ["cnf.jkt", String(dpopEv.cnf?.jkt || dpopEv.claims?.cnf?.jkt)]
          : null,
        dpopEv.rfc ? ["rfc", String(dpopEv.rfc)] : ["rfc", "RFC 9449"],
      ].filter(Boolean),
      response: { title: "DPoP binding", text: asJson({ cnf: dpopEv.cnf || dpopEv.claims?.cnf, rfc: dpopEv.rfc }) },
      tokenEvent: dpopEv,
    } : {}));

  // 6b. rar — RFC 9396 authorization_details (attest before intent-binding check).
  // Prefer the grant event (has authorization_details); attack sims use sim-rar-*.
  const rarEv = findEvent(tokenEvents, "rar-authorization", "sim-rar-grant")
    || findEvent(tokenEvents, "sim-rar-armed");
  steps.push(makeStep("rar",
    rarEv ? (rarEv.status === "failed" || rarEv.status === "error" ? "error" : "done")
      : traceComplete ? "notinpath" : "pending",
    rarEv ? {
      why: rarEv.explanation || "authorization_details bound this tool call to a specific intent.",
      kv: [["rfc", String(rarEv.rfc || "RFC 9396")]],
      request: {
        title: "authorization_details (attested)",
        text: asJson(rarEv.authorization_details || rarEv.claims?.authorization_details || rarEv),
      },
      tokenEvent: rarEv,
    } : {}));

  // 6c. jwks — signature verification events emitted after agent/exchanged tokens
  const jwksEvents = (tokenEvents || []).filter((e) => e && JWKS_VERIFIED_IDS.includes(e.id));
  const jwksFailed = jwksEvents.some((e) => e.verified === false || e.status === "failed");
  const jwksDone = jwksEvents.length > 0 && jwksEvents.every((e) => e.status !== "waiting");
  const primaryJwks = jwksEvents.find((e) => e.id === "exchanged-token-verified" || e.id === "two-ex-final-token-verified")
    || jwksEvents[0]
    || null;
  steps.push(makeStep("jwks",
    jwksFailed ? "error" : jwksDone ? "done" : traceComplete ? "notinpath" : "pending",
    jwksDone || jwksFailed ? {
      why: primaryJwks?.fallbackMethod === "introspection"
        ? "JWKS was unavailable — liveness confirmed via RFC 7662 introspection fallback."
        : primaryJwks?.verified
          ? `Signature verified via JWKS`
            + (primaryJwks.alg ? ` (alg ${primaryJwks.alg}` : "")
            + (primaryJwks.kid ? `${primaryJwks.alg ? ", " : " ("}kid ${primaryJwks.kid}` : "")
            + (primaryJwks.alg || primaryJwks.kid ? ")" : "")
            + "."
          : "JWT signature verification failed — the token cannot be trusted.",
      kv: jwksEvents.map((e) => [
        e.id.replace(/-verified$/, ""),
        e.verified
          ? `✓ ${e.fallbackMethod || "jwks"}${e.alg ? ` · ${e.alg}` : ""}${e.kid ? ` · kid ${e.kid}` : ""}`
          : `✗ ${e.error || e.warning || e.status || "failed"}`,
      ]),
      request: {
        title: "JWKS lookup",
        text: asJson({
          method: "GET",
          path: "/.well-known/jwks.json",
          note: "Public keys cached by the BFF; matched by JWT kid header.",
        }),
      },
      response: {
        title: "Verification results",
        text: asJson(jwksEvents.map((e) => ({
          id: e.id,
          verified: e.verified,
          fallbackMethod: e.fallbackMethod,
          alg: e.alg,
          kid: e.kid,
          warning: e.warning,
          error: e.error,
          claims: e.claims || undefined,
        }))),
      },
      tokenEvent: primaryJwks,
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
  const azStatements = (() => {
    const fromEval = azEval?.response?.statements
      || azEval?.response?.details?.statements
      || azEval?.statements
      || null;
    const fromGw = gwAzForAuthorize?.statements
      || gwAzForAuthorize?.rawResponse?.statements
      || gwAzForAuthorize?.authorizeResponse?.statements
      || null;
    return fromEval || fromGw || null;
  })();
  const azStatementCodes = Array.isArray(azStatements)
    ? azStatements.map((s) => (s && (s.code || s.id || s.name || s.effect)) || null).filter(Boolean)
    : [];
  const azReason = azEval?.response?.reason
    || azEval?.reason
    || gwAzForAuthorize?.reason
    || null;
  const azAdvice = azEval?.response?.advice
    || azEval?.response?.obligations
    || azEval?.advice
    || null;
  const azRef = azEval?.authorizeRef
    || azEval?.path
    || gwAzForAuthorize?.authorizeRef
    || null;
  const bffHasAzEvidence = Boolean(
    authorize || azEvent,
  );
  const gwHasAzEvidence = Boolean(
    gwAzForAuthorize && (gwAzForAuthorize.authorizeRequest || gwAzForAuthorize.parameters
      || gwAzForAuthorize.rawResponse || gwAzForAuthorize.authorizeResponse),
  );
  const statementWhySuffix = (azIsDeny || azIsChallenge) && azStatementCodes.length
    ? ` Rule/statement: ${azStatementCodes.join(", ")}.`
    : "";
  const authorizeWhy = azEval
    ? (azIsChallenge
      ? `Authorize returned ${azEval.decision || "INDETERMINATE"} — the human must approve before the tool proceeds.`
        + statementWhySuffix
      : azIsDeny
        ? `Authorize denied this action (${azEval.engine || "policy"}) — the tool call is blocked.`
          + statementWhySuffix
        : `Authorize returned ${azEval.decision || "PERMIT"}`
          + (azEval.decisionContext ? ` for ${azEval.decisionContext}` : "")
          + (azEval.source === "gw-authorize" ? " at the Agent Gateway hop." : " before the tool ran.")
          + (bffHasAzEvidence && gwHasAzEvidence ? " Gateway Authorize evidence is also present for this run." : ""))
    : undefined;
  const azResponseBody = azEval?.response
    ? {
      ...((typeof azEval.response === "object" && azEval.response) || { value: azEval.response }),
      ...(azStatements && !(azEval.response && azEval.response.statements) ? { statements: azStatements } : {}),
      ...(azReason && !(azEval.response && azEval.response.reason) ? { reason: azReason } : {}),
    }
    : (azStatements || azReason ? { statements: azStatements, reason: azReason } : null);
  steps.push(makeStep("authorize", azStatus,
    azEval ? {
      why: authorizeWhy,
      request: azRequestPayload || azEval.request
        ? { title: "Decision request (actual)",
            text: `${(azEval.request && azEval.request.method) || "POST"} ${(azEval.request && azEval.request.url) || ""}\n${asJson(azRequestPayload || azEval.request)}` }
        : undefined,
      response: azResponseBody
        ? { title: "Decision response (raw)", text: asJson(azResponseBody) } : undefined,
      // Dual hop: BFF primary above; gateway copy when both present (TraceStepCard L2).
      altRequest: bffHasAzEvidence && gwHasAzEvidence
        ? {
          title: "Gateway Authorize (same run)",
          text: `${gwAzForAuthorize.url ? `POST ${gwAzForAuthorize.url}\n` : ""}${asJson(
            gwAzForAuthorize.parameters
              || gwAzForAuthorize.authorizeRequest?.parameters
              || gwAzForAuthorize.authorizeRequest
              || null,
          )}`,
        }
        : undefined,
      altResponse: bffHasAzEvidence && gwHasAzEvidence
        ? {
          title: "Gateway Authorize response (same run)",
          text: asJson(gwAzForAuthorize.rawResponse || gwAzForAuthorize.authorizeResponse || {
            decision: gwAzForAuthorize.decision,
            statements: gwAzForAuthorize.statements,
          }),
        }
        : undefined,
      decision: { outcome: azEval.decision || "INDETERMINATE",
        label: `${azEval.decision || "INDETERMINATE"} — ${azEval.engine || "?"}${azEval.decisionContext ? ` (${azEval.decisionContext})` : ""}` },
      kv: [
        ["engine", String(azEval.engine || "")],
        ["decision id", String(azEval.decisionId || "")],
        azEval.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
        bffHasAzEvidence && gwHasAzEvidence ? ["gateway authorize", "also present"] : null,
        azStatementCodes.length ? ["statements", azStatementCodes.join(", ")] : null,
        azReason ? ["reason", String(azReason)] : null,
        azAdvice ? ["advice", asJson(azAdvice)] : null,
        azRef ? ["policy path", String(azRef)] : null,
      ].filter((row) => row && row[1]),
    } : {}));

  // 7a. step-up / HITL / CIBA (conditional) — omitted mid-flight so it doesn't
  // sit "pending" for runs that will never need it; once the trace completes
  // without a challenge, show it as notinpath rather than silently disappearing.
  const hitlPhases = (phases || []).filter((p) => p && p.phase && (
    String(p.phase).startsWith("mfa_challenge")
    || p.phase === "authorize_denied_hitl"
    || p.phase === "gateway_hitl_required"
    || p.phase === "mcp_result_hitl_required"
  ));
  const stepUpStarted = hasPhase(phases, "mfa_challenge_initiated") || hitlPhases.length > 0;
  const stepUpDone = hasPhase(phases, "mfa_challenge_completed");
  const stepUpFailed = hasPhase(phases, "mfa_challenge_failed");
  const hitlBody = mcpResult?.result?.error === "hitl_required" || mcpResult?.result?.error === "step_up_required"
    || mcpResult?.error === "hitl_required" || mcpResult?.error === "step_up_required"
    || mcpResult?.result?.hitl
    ? (mcpResult.result || mcpResult)
    : null;
  const challengeType = hitlBody?.challenge_type
    || hitlBody?.hitl?.type
    || hitlBody?.step_up_method
    || findPhase(phases, "authorize_denied_hitl")?.challenge_type
    || null;
  if (stepUpStarted || stepUpDone || stepUpFailed || hitlBody) {
    const stepupWhy = stepUpFailed
      ? "Step-up / HITL challenge failed — the tool call did not resume."
      : stepUpDone
        ? "Human approved the step-up / HITL challenge; the tool call may resume with the challenge id."
        : challengeType === "ciba" || challengeType === "step_up"
          ? `Out-of-band / step-up required (${challengeType}) — waiting for human approval before the tool proceeds.`
          : "Human-in-the-loop consent required — approve in the dashboard, then retry with `_hitl_challenge_id`.";
    steps.push(makeStep("stepup",
      stepUpFailed ? "error" : stepUpDone ? "done" : "active", {
        why: stepupWhy,
        kv: [
          ...hitlPhases.map((p) => [p.phase, p.label || p.challenge_type || ""]),
          challengeType ? ["challenge type", String(challengeType)] : null,
          (hitlBody?.challengeId || hitlBody?.challenge_id)
            ? ["challenge id", String(hitlBody.challengeId || hitlBody.challenge_id)]
            : null,
          hitlBody?.auth_req_id ? ["CIBA auth_req_id", String(hitlBody.auth_req_id)] : null,
          hitlBody?.step_up_acr ? ["ACR", String(hitlBody.step_up_acr)] : null,
          hitlBody?.step_up_method ? ["method", String(hitlBody.step_up_method)] : null,
          hitlBody?.hitl_threshold_usd != null
            ? ["HITL threshold", `$${hitlBody.hitl_threshold_usd}`]
            : null,
        ].filter(Boolean),
        request: hitlBody
          ? { title: "HITL / step-up challenge", text: asJson(hitlBody) }
          : undefined,
        response: stepUpDone
          ? { title: "Challenge completed", text: asJson({ status: "approved", note: "Retry carries _hitl_challenge_id" }) }
          : undefined,
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

  // 8. introspection — BFF session + gateway RFC 7662 (first-class; not folded into gateway)
  const sessionIntro = findEvent(tokenEvents, "session-token-introspection");
  const gwIntroRaw = findEvent(tokenEvents, "gw-introspection");
  const gwIntro = gwIntroRaw && gwIntroRaw.status !== "skipped" ? gwIntroRaw : null;
  const introSkipOnly = !!(gwIntroRaw && gwIntroRaw.status === "skipped" && !sessionIntro && !gwIntro);
  const introFailed = !!(
    (sessionIntro && (sessionIntro.status === "failed" || sessionIntro.status === "revoked"))
    || (gwIntro && (gwIntro.status === "revoked" || gwIntro.status === "failed" || gwIntro.active === false))
  );
  const introSeen = !!(sessionIntro || gwIntro);
  const introStatus = introFailed ? "error"
    : introSeen ? "done"
    : introSkipOnly ? (traceComplete ? "notinpath" : "pending")
    : traceComplete ? "notinpath"
    : "pending";
  const introResponseBody = gwIntro?.rawResponse
    || sessionIntro?.introspectionResult
    || (sessionIntro?.claims ? { ...sessionIntro.claims, status: sessionIntro.status } : null)
    || (gwIntro ? {
      active: gwIntro.active, sub: gwIntro.sub, scope: gwIntro.scope,
      exp: gwIntro.exp, iss: gwIntro.iss, client_id: gwIntro.client_id,
    } : null);
  steps.push(makeStep("introspection", introStatus,
    introSeen || introFailed ? {
      why: gwIntro
        ? (gwIntro.active === false || gwIntro.status === "revoked"
          ? "Gateway introspection reported the delegated token inactive or revoked."
          : `Gateway confirmed the delegated token active via RFC 7662`
            + (gwIntro.sub ? ` (sub ${gwIntro.sub})` : "")
            + ".")
        : sessionIntro
          ? (sessionIntro.status === "failed"
            ? "BFF session-token introspection failed — PingOne returned active=false."
            : sessionIntro.status === "degraded"
              ? "Session introspection errored; the pipeline continued in degraded mode."
              : sessionIntro.status === "skipped"
                ? "Session introspection was skipped (endpoint not configured)."
                : "BFF confirmed the session user token is still active at PingOne before the tool call.")
          : undefined,
      kv: [
        sessionIntro ? ["BFF session", String(sessionIntro.status)] : null,
        gwIntro ? ["gateway", gwIntro.status === "active" || gwIntro.status === "valid" || gwIntro.active
          ? "✓ active" : String(gwIntro.status)] : null,
        gwIntro?.scope ? ["scope", String(gwIntro.scope)] : null,
        gwIntro?.sub ? ["sub", String(gwIntro.sub)] : null,
        (sessionIntro?.rfc || gwIntro?.rfc) ? ["rfc", sessionIntro?.rfc || gwIntro?.rfc] : null,
      ].filter(Boolean),
      request: {
        title: "Introspect request",
        text: asJson({
          endpoint: "POST /as/introspect",
          token_type_hint: "access_token",
          hops: [
            sessionIntro ? "BFF → PingOne (session user token)" : null,
            gwIntro ? "PingGateway → PingOne (delegated bearer)" : null,
          ].filter(Boolean),
        }),
      },
      response: introResponseBody
        ? { title: "Introspection response (RFC 7662)", text: asJson(introResponseBody) }
        : undefined,
      tokenEvent: gwIntro || sessionIntro || null,
    } : introSkipOnly ? {
      narrative: gwIntroRaw.explanation
        || "Gateway introspection was skipped (endpoint not configured) — not required on this run.",
    } : {}));

  // 8c. mtls — first-class hop (out of gateway kv)
  const gwMtls = findEvent(tokenEvents, "gw-mtls");
  steps.push(makeStep("mtls",
    gwMtls && gwMtls.status !== "skipped"
      ? (gwMtls.status === "failed" || gwMtls.status === "deny" ? "error" : "done")
      : gwMtls && gwMtls.status === "skipped"
        ? (traceComplete ? "notinpath" : "pending")
        : traceComplete ? "notinpath" : "pending",
    gwMtls && gwMtls.status !== "skipped" ? {
      why: gwMtls.explanation
        || `mTLS verified between gateway and MCP`
          + (gwMtls.subject || gwMtls.mtlsSubject ? ` (subject ${gwMtls.subject || gwMtls.mtlsSubject})` : ".")
          + (gwMtls.subject || gwMtls.mtlsSubject ? "." : ""),
      kv: [
        ["mTLS", gwMtls.label || String(gwMtls.status)],
        (gwMtls.subject || gwMtls.mtlsSubject)
          ? ["cert subject", String(gwMtls.subject || gwMtls.mtlsSubject)]
          : null,
        gwMtls.mtlsEnabled != null ? ["enabled", String(gwMtls.mtlsEnabled)] : null,
      ].filter(Boolean),
      response: { title: "mTLS evidence", text: asJson(gwMtls) },
      tokenEvent: gwMtls,
    } : gwMtls && gwMtls.status === "skipped" ? {
      narrative: gwMtls.explanation
        || "mTLS not enforced between gateway and MCP (MCP_MTLS_ENABLED=false).",
    } : {}));

  // 9. gateway — audience / scope / authorize at the edge (introspection + mTLS are own steps)
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  const gwInbound = findEvent(tokenEvents, "evt-inbound");
  const gwScope = findEvent(tokenEvents, "evt-scope");
  const gwMcpAudit = findEvent(tokenEvents, "gw-mcp-audit");
  const gwFilterChainEv = findEvent(tokenEvents, "gw-filter-chain");
  const gwIntroEv = findEvent(tokenEvents, "gw-introspection");
  const gwRouteEv = findEvent(tokenEvents, "gw-route");
  const gwDeniedPhase = findPhase(phases, "gateway_policy_denied");
  // Attack sims emit "sim-gateway-deny" instead of a phase. RAR denies
  // (rar_amount_exceeded / rar_unexpected_deny) already feed the
  // intent-binding step above and must not double-report here.
  const simGwDeny = (tokenEvents || []).find(
    (e) => e && e.id === "sim-gateway-deny"
      && e.error !== "rar_amount_exceeded" && e.error !== "rar_unexpected_deny",
  );
  const gwHowEarly = gwMcpAudit?.how || gwMcpAudit?.mcpAudit?.how || null;
  const gwFilterDenied = !!(gwFilterChainEv && (
    gwFilterChainEv.status === "deny"
    || gwFilterChainEv.status === "failed"
    || gwFilterChainEv.status === "error"
  ));
  const gwAuditBlocked = !!(gwMcpAudit && (
    gwMcpAudit.status === "deny"
    || gwHowEarly?.result === "blocked"
    || gwHowEarly?.decision === "DENY"
  ));
  const gwDenied = !!gwDeniedPhase || !!simGwDeny || gwFilterDenied || gwAuditBlocked;
  // Include filter-chain / route / active introspection — weather showcase often
  // has no PingOne Authorize card, only TxWeatherScope + McpAuditFilter evidence.
  // Skipped-only introspection must not light gateway (kept on the introspection step).
  const gwIntroCounts = !!(gwIntroEv && gwIntroEv.status !== "skipped");
  const gwSeen = !!(gwAz || gwInbound || gwScope || gwMcpAudit || gwFilterChainEv || gwIntroCounts || gwRouteEv);
  const gwSkipEvidence = [];
  const gwStatementCodes = Array.isArray(gwAz?.statements)
    ? gwAz.statements.map((s) => (s && (s.code || s.id || s.name || s.effect)) || null).filter(Boolean)
    : [];
  const gwHow = gwHowEarly;
  const denyingFilter = gwAz?.denyingFilter
    || gwFilterChainEv?.denyingFilter
    || gwMcpAudit?.denyingFilter
    || gwMcpAudit?.where?.filter
    || null;
  const lastFilter = gwAz?.lastFilter || gwFilterChainEv?.lastFilter || null;
  const filterHop = gwDenied ? denyingFilter : (lastFilter || denyingFilter);
  const filterChain = gwAz?.filterChain || gwFilterChainEv?.filterChain || null;
  const gwPolicy = gwAz?.policy || gwFilterChainEv?.policy || null;
  const gatewayWhy = (() => {
    if (gwDenied) {
      const ruleBit = gwStatementCodes.length ? ` — rule/statement: ${gwStatementCodes.join(", ")}` : "";
      if (denyingFilter) {
        return `Blocked by ${denyingFilter}`
          + (gwAz?.decision ? ` (${gwAz.decision})` : "")
          + ruleBit
          + (gwFilterChainEv?.explanation ? `: ${gwFilterChainEv.explanation}` : ".");
      }
      return "The Agent Gateway blocked this call before it reached the MCP server." + ruleBit
        + (gwAz?.reason ? ` Reason: ${gwAz.reason}.` : "")
        + (gwFilterChainEv?.explanation ? ` ${gwFilterChainEv.explanation}` : "");
    }
    if (filterHop) {
      return `Passed filter chain; last hop ${filterHop} → forwarded`
        + (gwAz?.tool ? ` for tool “${gwAz.tool}”` : "")
        + ".";
    }
    if (gwHow && (gwHow.decision || gwHow.result)) {
      return `McpAuditFilter: ${gwHow.decision || "—"}${gwHow.result ? ` → ${gwHow.result}` : ""}`
        + (gwHow.backend ? ` (${gwHow.backend})` : "")
        + ".";
    }
    if (gwAz) {
      return `Gateway validated the delegated token`
        + (gwAz.tool ? ` and authorized tool “${gwAz.tool}”` : "")
        + (gwAz.decision ? ` (${gwAz.decision})` : "")
        + (gwStatementCodes.length ? `; statements: ${gwStatementCodes.join(", ")}` : "")
        + ".";
    }
    return "Gateway processed the inbound delegated bearer on this hop.";
  })();
  const mcpAuditBody = gwMcpAudit
    ? (gwMcpAudit.mcpAudit || {
      who: gwMcpAudit.who, what: gwMcpAudit.what, when: gwMcpAudit.when,
      where: gwMcpAudit.where, how: gwMcpAudit.how, eventName: gwMcpAudit.eventName,
    })
    : null;
  steps.push(makeStep("gateway",
    // If the gateway itself denied, keep this step visible even when authorize
    // also mirrors the same gw-authorize DENY (authorizeFailed would otherwise
    // collapse gateway to notinpath).
    authorizeFailed && !gwDenied ? "notinpath" : gwDenied ? "error" : gwSeen ? "done" : traceComplete ? "notinpath" : "pending",
    (gwSeen || gwDenied) ? {
      why: gatewayWhy,
      decision: gwDenied
        ? { outcome: "DENY",
            label: `DENY — ${(gwDeniedPhase
              ? (gwDeniedPhase.detail && gwDeniedPhase.detail !== "—" ? gwDeniedPhase.detail : gwDeniedPhase.label)
              : (gwFilterChainEv?.explanation || simGwDeny?.label || simGwDeny?.explanation)) || "gateway policy"}` }
        : undefined,
      kv: [
        denyingFilter || lastFilter ? ["filter / stage", String(filterHop || denyingFilter || lastFilter)] : null,
        gwFilterChainEv?.route ? ["route", String(gwFilterChainEv.route)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwStatementCodes.length ? ["rule / statement", gwStatementCodes.join(", ")] : null,
        gwAz?.reason ? ["reason", String(gwAz.reason)] : null,
        (gwAz?.backend || gwAz?.policySource) ? ["backend", String(gwAz.backend || gwAz.policySource)] : null,
        gwHow ? ["McpAuditFilter how", `${gwHow.decision || "—"}${gwHow.result ? ` → ${gwHow.result}` : ""}`] : null,
        (gwDeniedPhase?.gatewayErrorCode || gwFilterChainEv?.gatewayErrorCode || simGwDeny?.error)
          ? ["error code", String(gwDeniedPhase?.gatewayErrorCode || gwFilterChainEv?.gatewayErrorCode || simGwDeny?.error)]
          : null,
        gwPolicy != null ? ["policy", gwPolicy.passed === false ? "failed" : (gwPolicy.passed ? "passed" : asJson(gwPolicy))] : null,
        filterChain ? ["filter chain hops",
          Array.isArray(filterChain) && filterChain.every((x) => typeof x === "string")
            ? filterChain.join(" → ")
            : String(filterChain.length)] : null,
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
        if (mcpAuditBody && !gwAz) {
          return { title: "McpAuditFilter — who/what/when/where/how", text: asJson(mcpAuditBody) };
        }
        if (!gwAz) return undefined;
        const body = gwAz.rawResponse || gwAz.authorizeResponse || null;
        return body
          ? { title: "Gateway authorize response", text: asJson(body) }
          : undefined;
      })(),
      altResponse: mcpAuditBody && gwAz
        ? { title: "McpAuditFilter — who/what/when/where/how", text: asJson(mcpAuditBody) }
        : (filterChain
          ? { title: "Filter chain", text: asJson(filterChain) }
          : undefined),
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

  // 8d. dual-token — Path B (access + id_token teaching)
  const evtIdToken = findEvent(tokenEvents, "evt-idtoken-fetch");
  const evtPassthrough = findEvent(tokenEvents, "gw-passthrough");
  const dualPath =
    apiMetaEarly.credentialPath === "dual_token"
    || !!(evtIdToken || evtPassthrough)
    || tokenEvents.some((e) => e && e.credentialPath === "dual_token");
  const dualDone = dualPath && (
    apiMetaEarly.credentialPath === "dual_token" || evtIdToken || evtPassthrough
  );
  steps.push(makeStep("dual-token",
    authorizeFailed ? "notinpath" : dualDone ? "done" : traceComplete ? "notinpath" : "pending",
    dualPath ? {
      why: "Dual-token path: gateway forwarded the access bearer and attached the OIDC id_token for identity teaching.",
      kv: [
        evtIdToken ? ["id_token", evtIdToken.label || "fetched from BFF"] : null,
        evtPassthrough ? ["passthrough", evtPassthrough.label || "TX bearer unchanged"] : null,
        apiMetaEarly.backendRoute ? ["backend", String(apiMetaEarly.backendRoute)] : null,
        apiMetaEarly.idTokenAttached != null ? ["id_token attached", String(apiMetaEarly.idTokenAttached)] : null,
        apiMetaEarly.accessTokenAttached != null ? ["access attached", String(apiMetaEarly.accessTokenAttached)] : null,
      ].filter(Boolean),
      response: {
        title: "Dual-token disposition",
        text: asJson({
          credentialPath: "dual_token",
          events: [findEvent(tokenEvents, "evt-inbound"), evtIdToken, evtPassthrough].filter(Boolean),
          meta: {
            backendRoute: apiMetaEarly.backendRoute,
            note: apiMetaEarly.note,
          },
        }),
      },
    } : !dualDone && traceComplete ? {
      narrative: "This run did not use the dual-token (access + id_token) credential path.",
    } : {}));

  // 10. mcp + 11. api — a gateway denial means the call never reached the MCP
  // server; surface that as an error instead of leaving the step stuck "active".
  // Tool failures (mcp_error after a successful exchange) must also light error —
  // not leave outcome=error with only successful exchange/DPoP whys in the story.
  const mcpToolError = !!(mcpResult && (
    mcpResult.status === "error"
    || mcpResult.error
    || (mcpResult.result && (mcpResult.result.error || mcpResult.result.isError))
  ));
  const mcpDone = !mcpToolError && !mcpResult?.denied && (
    hasPhase(phases, "mcp_remote_done")
    || !!(mcpResult && mcpResult.result)
  );
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  const mcpDenyPayload = mcpResult && (mcpResult.denied || mcpToolError)
    ? mcpResult
    : null;
  const mcpFailed = !!(gwDenied || mcpResult?.denied || mcpToolError);
  const mcpAttemptRequest = (mcpResult && mcpResult.requestJson)
    || (mcpDenyPayload && mcpDenyPayload.requestJson)
    || null;
  const mcpErrorBody = (mcpDenyPayload && (mcpDenyPayload.result || {
    error: mcpDenyPayload.error,
    message: mcpDenyPayload.message || mcpDenyPayload.error,
    tool: mcpDenyPayload.tool || mcpDenyPayload.toolName,
  }))
    || (gwDenied ? {
      error: "gateway_policy_denied",
      message: gwDeniedPhase?.detail || simGwDeny?.explanation || "Gateway policy denied the tool call",
      gatewayErrorCode: gwDeniedPhase?.gatewayErrorCode || simGwDeny?.error || null,
      tool: gwDeniedPhase?.tool || mcpResult?.tool || null,
    } : null);
  const mcpFailWhy = gwDenied || mcpResult?.denied
    ? "MCP never ran — the gateway denied the call upstream."
    : `MCP tool “${mcpResult?.tool || mcpResult?.toolName || "tool"}” failed`
      + (mcpResult?.error || mcpResult?.result?.error
        ? ` — ${mcpResult.error || mcpResult.result.error}`
        : ".")
      + (mcpResult?.result?.message && mcpResult.result.message !== (mcpResult.error || mcpResult.result.error)
        ? `: ${mcpResult.result.message}`
        : "");
  steps.push(makeStep("mcp",
    authorizeFailed ? "notinpath" : mcpDone ? "done" : mcpFailed ? "error" : mcpBegun ? "active" : "pending",
    mcpDone && mcpResult && !mcpFailed ? {
      why: `MCP executed “${mcpResult.tool || mcpResult.toolName || "tool"}”`
        + (mcpResult.durationMs != null ? ` in ${mcpResult.durationMs} ms` : "")
        + " under the delegated identity.",
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      response: mcpResult.result != null
        ? { title: "MCP tool result", text: asJson(mcpResult.result) }
        : undefined,
      kv: [
        mcpResult.durationMs != null ? ["duration", `${mcpResult.durationMs} ms`] : null,
        findEvent(tokenEvents, "gw-mcp-audit")
          ? ["gateway audit", "see Gateway step (McpAuditFilter 5W1H)"]
          : null,
      ].filter(Boolean),
    } : mcpFailed ? {
      why: mcpFailWhy,
      request: mcpAttemptRequest
        ? { title: "Attempted JSON-RPC call", text: asJson(mcpAttemptRequest) }
        : (mcpResult?.tool || mcpResult?.toolName || gwDeniedPhase?.tool)
          ? { title: "Attempted tool", text: asJson({ name: mcpResult?.tool || mcpResult?.toolName || gwDeniedPhase?.tool }) }
          : undefined,
      response: mcpErrorBody
        ? { title: "Deny / error body", text: asJson(mcpErrorBody) }
        : undefined,
      kv: [
        (mcpResult?.tool || mcpResult?.toolName || gwDeniedPhase?.tool)
          ? ["tool", String(mcpResult?.tool || mcpResult?.toolName || gwDeniedPhase?.tool)] : null,
        (mcpResult?.error || mcpResult?.result?.error)
          ? ["error", String(mcpResult.error || mcpResult.result.error)] : null,
        (gwDeniedPhase?.gatewayErrorCode || mcpResult?.gatewayErrorCode)
          ? ["gateway code", String(gwDeniedPhase?.gatewayErrorCode || mcpResult?.gatewayErrorCode)]
          : null,
      ].filter(Boolean),
    } : {}));
  const apiMeta = apiMetaEarly;
  const apiKeyCall = apiMeta.credentialPath === "api_key" || apiKeyPath;
  const rsReply = findEvent(tokenEvents, "resource-server-reply");
  const rsDone = Boolean(rsReply) || (mcpDone && mcpResult) || apiKeyCall;
  const mcpToolArgs = mcpResult?.requestJson?.params
    || mcpResult?.requestJson?.arguments
    || (mcpResult?.requestJson?.params?.arguments != null
      ? mcpResult.requestJson.params
      : null);
  const rsRequest = (() => {
    if (apiMeta.resourceRequest) {
      return {
        title: "Resource server HTTP (actual)",
        text: asJson(apiMeta.resourceRequest),
      };
    }
    if (apiKeyCall && apiMeta.apiCall) {
      return { title: "Resource server call (api-key path)", text: String(apiMeta.apiCall) };
    }
    if (evtBackend) {
      return { title: "Backend outbound", text: asJson(evtBackend) };
    }
    if (mcpToolArgs || mcpResult?.tool || rsReply?.toolName) {
      return {
        title: "MCP → banking API (via tool)",
        text: asJson({
          tool: mcpResult?.tool || mcpResult?.toolName || rsReply?.toolName || null,
          params: mcpResult?.requestJson?.params || mcpToolArgs || null,
          note: "No raw HTTP method/URL on this path — tool args are the teaching request.",
        }),
      };
    }
    return undefined;
  })();
  const rsResponseBody = apiMeta.resourceResult != null
    ? apiMeta.resourceResult
    : (mcpResult && mcpResult.result != null ? mcpResult.result : null);
  steps.push(makeStep("api",
    authorizeFailed ? "notinpath" : rsDone ? "done" : traceComplete ? "notinpath" : "pending",
    rsDone ? {
      why: rsReply
        ? `Resource server replied for “${rsReply.toolName || "tool"}”`
          + (rsReply.durationMs != null ? ` in ${rsReply.durationMs} ms` : "")
          + (rsReply.routedVia ? ` via ${rsReply.routedVia}` : "")
          + "."
        : apiMeta.resourceRequest
          ? `Resource server HTTP ${apiMeta.resourceRequest.method || ""} ${apiMeta.resourceRequest.url || apiMeta.resourceRequest.path || ""}`.trim()
            + " under the credential path for this run."
        : apiKeyCall
          ? "Backend call after credential swap — X-API-Key + X-User-Sub (no OAuth bearer on the wire)."
          : "Tool result returned from the MCP/resource path under the delegated identity.",
      narrative: apiKeyCall
        ? "Backend call after credential swap — X-API-Key + X-User-Sub (no OAuth bearer on the wire)."
        : "The resource-server hop behind the MCP tool (banking API or equivalent).",
      request: rsRequest,
      response: rsResponseBody != null
        ? { title: "Resource / tool result", text: asJson(rsResponseBody) }
        : rsReply?.resultSummary
          ? { title: "Resource server summary", text: String(rsReply.resultSummary) }
          : undefined,
      kv: [
        rsReply?.toolName ? ["tool", String(rsReply.toolName)] : null,
        rsReply?.durationMs != null ? ["duration", `${rsReply.durationMs} ms`] : null,
        rsReply?.routedVia ? ["routed via", String(rsReply.routedVia)] : null,
        rsReply?.resultStatus ? ["result status", String(rsReply.resultStatus)] : null,
        apiMeta.resourceRequest?.method ? ["HTTP method", String(apiMeta.resourceRequest.method)] : null,
        apiMeta.resourceRequest?.url || apiMeta.resourceRequest?.path
          ? ["URL", String(apiMeta.resourceRequest.url || apiMeta.resourceRequest.path)]
          : null,
        apiKeyCall && apiMeta.apiCall ? ["api call", apiMeta.apiCall] : null,
        apiKeyCall && apiMeta.apiKeyMaskedLast4 ? ["service key", `••••${apiMeta.apiKeyMaskedLast4}`] : null,
        evtBackend ? ["backend", evtBackend.label] : null,
      ].filter(Boolean),
      tokenEvent: rsReply || undefined,
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

  const ucId = firstUseCaseId(tokenEvents);
  const UC_WHY_STEPS = new Set([
    "authorize", "gateway", "exchange", "stepup", "intent-binding", "dpop", "rar", "mcp", "mtls", "dual-token",
  ]);
  return steps.map((s, i) => {
    let detail = UC_WHY_STEPS.has(s.id) ? withUcWhy(s.detail, ucId) : s.detail;
    detail = withEduLink(detail, s.id);
    return { ...s, num: i + 1, detail };
  });
}
