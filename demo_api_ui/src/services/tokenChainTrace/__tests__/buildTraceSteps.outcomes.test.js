import { buildTraceSteps, buildRunStory, buildGatewayStages, MCP_STEP_IDS, laneLabel } from "../buildTraceSteps";
import { hasPopoutWorthyDetail } from "../../../components/TraceStepCard";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — intent-binding step", () => {
  test("absent mid-flight with no tokenEvents", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    expect(steps.find((s) => s.id === "intent-binding")).toBeUndefined();
  });

  test("notinpath once the trace completes without RAR evidence", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok" });
    const ib = steps.find((s) => s.id === "intent-binding");
    expect(ib.status).toBe("notinpath");
    expect(ib.detail.narrative).toMatch(/not required on the default token path/i);
  });

  test("done when an intent-binding-verified event is present", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "intent-binding-verified", label: "Intent Verified (RAR — RFC 9396)", status: "active" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("done");
  });

  test("error when a gateway deny carries rar_unexpected_deny or rar_amount_exceeded", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "sim-gateway-deny", label: "Gateway DENY (rar_amount_exceeded)", status: "error", error: "rar_amount_exceeded" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("error");
  });

  test("a live PAR permit draws the push and request_uri right before the intent check", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [
        { id: "par-push", label: "PAR Endpoint Push", status: "active" },
        { id: "request-uri", label: "Received request_uri", status: "active" },
        { id: "intent-check", label: "Intent cap $80 <= $100", status: "active" },
        { id: "p1az-permit", label: "PingOne Authorize — PERMIT", status: "active" },
      ],
    });
    const ids = steps.map((s) => s.id);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["par-push"]).toMatchObject({ status: "done", lane: "PINGONE" });
    expect(byId["request-uri"]).toMatchObject({ status: "done", lane: "PINGONE" });
    expect(byId["intent-binding"].status).toBe("done");
    expect(ids.indexOf("request-uri")).toBe(ids.indexOf("par-push") + 1);
    expect(ids.indexOf("intent-binding")).toBe(ids.indexOf("request-uri") + 1);
  });

  test("a rejected PAR push is an error, and a live over-cap run fails the intent check", () => {
    const rejected = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [{ id: "par-push", label: "PAR Endpoint Push", status: "error" }],
    });
    expect(rejected.find((s) => s.id === "par-push").status).toBe("error");
    expect(rejected.find((s) => s.id === "request-uri")).toBeUndefined();

    const overCap = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        { id: "par-push", status: "active" },
        { id: "request-uri", status: "active" },
        { id: "intent-check", status: "exceeded" },
        { id: "transfer-blocked", label: "Transfer blocked — intent exceeded", status: "enforced" },
      ],
    });
    expect(overCap.find((s) => s.id === "intent-binding").status).toBe("error");
  });

  test("a run with no PAR evidence has no PAR steps", () => {
    const ids = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok" }).map((s) => s.id);
    expect(ids).not.toContain("par-push");
    expect(ids).not.toContain("request-uri");
  });
});


describe("buildTraceSteps — attack sim (UC5 gateway scope deny)", () => {
  const SIM_TRACE = {
    ...EMPTY_TRACE,
    prompt: { message: "Demo step 10: UC5 — Wrong / insufficient scope" },
    outcome: "error",
    tokenEvents: [
      { id: "user-token", status: "active", claims: { sub: "user-123", scope: "read write" } },
      { id: "sim-exchange-ok", label: "Exchanged Token (read-only)", status: "active",
        claims: { sub: "user-123", scope: "read", aud: "https://api.ping.demo:3036/mcp" } },
      { id: "sim-gateway-deny", label: "Gateway DENY (insufficient_scope)", status: "error",
        error: "insufficient_scope", httpStatus: 403,
        explanation: "Gateway rejected the call with 403 insufficient_scope: create_transfer requires write" },
    ],
  };

  test("sim-exchange-ok fills the exchange step; the deny lands on the gateway step", () => {
    const steps = buildTraceSteps(SIM_TRACE);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.exchange.status).toBe("done");
    expect(byId.exchange.detail.scopeDiff).toEqual({ before: ["read", "write"], after: ["read"] });
    expect(byId.gateway.status).toBe("error");
    expect(byId.gateway.detail.decision.outcome).toBe("DENY");
    expect(byId.gateway.detail.decision.label).toContain("insufficient_scope");
    expect(byId.mcp.status).toBe("error");
  });

  test("steps the sim never touches resolve notinpath, not pending", () => {
    const steps = buildTraceSteps(SIM_TRACE);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    for (const id of ["agent", "llm", "agent-token", "authorize", "reply", "api"]) {
      expect(byId[id].status).toBe("notinpath");
    }
  });

  test("RAR denies keep feeding intent-binding only — the gateway step is untouched", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        { id: "sim-gateway-deny", status: "error", error: "rar_amount_exceeded" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("error");
    expect(byId.gateway.status).not.toBe("error");
  });

  test("invalid_aud deny shows token aud vs gateway expected aud", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        {
          id: "sim-gateway-deny",
          label: "Gateway DENY (invalid_aud)",
          status: "error",
          error: "invalid_aud",
          httpStatus: 401,
          triedAudience: "https://api.ping.demo:3001",
          allowedAudience: "https://api.ping.demo:3036/mcp",
          explanation: "Gateway rejected the call with 401 invalid_aud",
        },
      ],
    });
    const gateway = steps.find((s) => s.id === "gateway");
    expect(gateway.status).toBe("error");
    const audKv = gateway.detail.kv.find((row) => row[0] === "audience");
    expect(audKv).toBeTruthy();
    expect(audKv[1]).toContain("https://api.ping.demo:3001");
    expect(audKv[1]).toContain("https://api.ping.demo:3036/mcp");
    expect(audKv[1]).toMatch(/MISMATCH/);
  });
});


describe("buildRunStory — L0 strip", () => {
  test("returns null when the trace is empty", () => {
    expect(buildRunStory(EMPTY_TRACE, [])).toBeNull();
  });

  test("summarizes a successful run with authorize decision", () => {
    const gwEv = {
      id: "gw-authorize", status: "permit", decision: "PERMIT",
      tool: "get_my_accounts", parameters: { ToolName: "get_my_accounts" },
      rawResponse: { decision: "PERMIT" }, backend: "real",
    };
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      prompt: { message: "show my balance" },
      authorize: {
        engine: gwEv.backend,
        decision: gwEv.decision,
        decisionId: null,
        decisionContext: `tool:${gwEv.tool}`,
        path: null,
        request: { method: "POST", url: "", parameters: gwEv.parameters },
        response: gwEv.rawResponse,
        source: "gw-authorize",
      },
      tokenEvents: [gwEv],
    });
    const story = buildRunStory({
      ...EMPTY_TRACE, outcome: "ok", prompt: { message: "show my balance" },
      tokenEvents: [{ id: "gw-authorize" }],
    }, steps);
    expect(story.headline).toMatch(/completed successfully/i);
    expect(story.headline).toMatch(/PERMIT/);
    expect(story.outcome).toBe("ok");
    expect(story.bits.length).toBeGreaterThan(0);
  });
});


describe("buildRunStory — missing decision is never dressed up as INDETERMINATE", () => {
  // INDETERMINATE is a real P1AZ verdict ("could not evaluate", fail-closed
  // since #1310). A trace whose authorize slot has no decision recorded must
  // not claim it — a successful run headline reading "Authorize returned
  // INDETERMINATE" is a contradiction.
  const carriedGateTrace = {
    ...EMPTY_TRACE,
    outcome: "ok",
    prompt: { message: "show my airline bookings" },
    authorize: { outcome: "STEP_UP", priorGate: "STEP_UP" },
  };

  test("authorize card shows 'no decision recorded', not INDETERMINATE", () => {
    const steps = buildTraceSteps(carriedGateTrace);
    const az = steps.find((s) => s.id === "authorize");
    expect(az.detail.decision.outcome).not.toBe("INDETERMINATE");
    expect(az.detail.decision.outcome).toBe("NOT_RECORDED");
  });

  test("run story headline omits the decision clause entirely", () => {
    const steps = buildTraceSteps(carriedGateTrace);
    const story = buildRunStory(carriedGateTrace, steps);
    expect(story.headline).toMatch(/completed successfully/i);
    expect(story.headline).not.toMatch(/INDETERMINATE/);
    expect(story.headline).not.toMatch(/NOT_RECORDED/);
  });

  test("a REAL INDETERMINATE decision still surfaces verbatim", () => {
    const trace = {
      ...EMPTY_TRACE,
      outcome: "ok",
      prompt: { message: "x" },
      authorize: { decision: "INDETERMINATE", engine: "pingone" },
    };
    const steps = buildTraceSteps(trace);
    const az = steps.find((s) => s.id === "authorize");
    expect(az.detail.decision.outcome).toBe("INDETERMINATE");
  });
});


describe("buildTraceSteps — expected DENY (control worked)", () => {
  const expectedDenyTrace = {
    ...EMPTY_TRACE,
    outcome: "error",
    prompt: { message: "what's the weather in Miami" },
    mcpResult: {
      tool: "get_weather",
      denied: true,
      expected: true,
      result: {
        error: "weather_scope_denied",
        gatewayErrorCode: "weather_scope_denied",
        message: "Agent Gateway: weather scope restricted to Texas — city not recognized as Texas",
      },
    },
  };

  test("api step frames an expected deny as the control working", () => {
    const steps = buildTraceSteps(expectedDenyTrace);
    const api = steps.find((s) => s.id === "api");
    expect(api.status).toBe("done");
    expect(api.detail.narrative).toMatch(/Expected DENY/);
    expect(api.detail.response.text).toContain("weather_scope_denied");
  });

  test("buildRunStory presents an expected deny as a successful run, not an error", () => {
    const steps = buildTraceSteps(expectedDenyTrace);
    const story = buildRunStory(expectedDenyTrace, steps);
    expect(story.outcome).toBe("ok");
    expect(story.headline).toMatch(/Expected DENY/);
  });

  test("a denied result that is NOT expected still reads as an error", () => {
    const trace = { ...expectedDenyTrace, mcpResult: { ...expectedDenyTrace.mcpResult, expected: false } };
    const steps = buildTraceSteps(trace);
    const story = buildRunStory(trace, steps);
    expect(story.outcome).toBe("error");
    expect(story.headline).not.toMatch(/Expected DENY/);
  });
});


describe("buildTraceSteps — dynamic authorize cards (multi-decision)", () => {
  test("2 authorize evaluations render 2 cards, gate first then secondary", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      authorizeEvaluations: [
        { decision: "PERMIT", decisionId: "gate-1", engine: "pingone", decisionContext: "McpFirstTool", response: { decision: "PERMIT" } },
        { decision: "DENY", decisionId: "limit-1", engine: "pingone", decisionContext: "TransactionAmount", raw: { decision: "DENY", reason: "over limit" } },
      ],
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps).toHaveLength(2);
    expect(authorizeSteps[0].id).toBe("authorize");
    expect(authorizeSteps[0].status).toBe("done");
    expect(authorizeSteps[0].detail.decision.outcome).toBe("PERMIT");
    expect(authorizeSteps[0].detail.response.text).toContain('"PERMIT"');
    expect(authorizeSteps[1].id).toBe("authorize:2");
    expect(authorizeSteps[1].status).toBe("error");
    expect(authorizeSteps[1].detail.decision.outcome).toBe("DENY");
    expect(authorizeSteps[1].detail.response.text).toContain("over limit");
    expect(authorizeSteps[1].detail.decision.label).toContain("Amount / transaction policy check");
  });

  test("no authorizeEvaluations field still renders exactly 1 authorize card (back-compat)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: { decision: "PERMIT", engine: "pingone", decisionId: "d-1" },
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps).toHaveLength(1);
    expect(authorizeSteps[0].id).toBe("authorize");
  });

  test("empty authorizeEvaluations array falls back to the single-decision path", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, authorizeEvaluations: [] });
    expect(steps.filter((s) => s.baseId === "authorize")).toHaveLength(1);
  });

  test("a completed trace (outcome 'ok') renders a satisfied STEP_UP secondary card as done, not active", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      authorizeEvaluations: [
        { decision: "PERMIT", decisionId: "gate-1", engine: "pingone", decisionContext: "McpFirstTool" },
        { decision: "STEP_UP", decisionId: "limit-2", engine: "pingone", decisionContext: "TransactionAmount" },
      ],
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps).toHaveLength(2);
    // The run already finished successfully — a STEP_UP the user already
    // satisfied earlier must not render as a permanently "active" ask.
    expect(authorizeSteps[1].status).toBe("done");
  });

  test("a mid-flight trace (no terminal outcome) still renders the STEP_UP secondary card as active", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorizeEvaluations: [
        { decision: "PERMIT", decisionId: "gate-1", engine: "pingone", decisionContext: "McpFirstTool" },
        { decision: "STEP_UP", decisionId: "limit-2", engine: "pingone", decisionContext: "TransactionAmount" },
      ],
    });
    const authorizeSteps = steps.filter((s) => s.baseId === "authorize");
    expect(authorizeSteps[1].status).toBe("active");
  });
});


describe("buildTraceSteps — a finished run cannot still be exchanging", () => {
  const waitingTok = { id: "exchanged-token", status: "waiting", claims: { scope: "read" } };
  const exStep = (steps) => steps.find((s) => s.id === "exchange");

  test("mid-flight, a waiting exchange is still active", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: [waitingTok] });
    expect(exStep(steps).status).toBe("active");
  });

  test("once the run completes it reads done, not a permanent 'in flight'", () => {
    // Observed live: the BFF never supersedes the "waiting" event, so the hop
    // sat on 'in flight' with every downstream hop already done.
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok", tokenEvents: [waitingTok] });
    expect(exStep(steps).status).toBe("done");
    // The detail block is gated on the same flag — it must fill in too.
    expect(exStep(steps).detail.response).toBeTruthy();
  });

  test("a real exchange failure still wins over the completed-run rule", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [waitingTok, { id: "exchange-failed" }],
    });
    expect(exStep(steps).status).toBe("error");
  });
});


describe("buildTraceSteps — exchange proven by downstream evidence", () => {
  const waitingTok = { id: "exchanged-token", status: "waiting", claims: { scope: "read" } };
  const exStep = (steps) => steps.find((s) => s.id === "exchange");

  // Live runs often finish WITHOUT ever setting a terminal outcome — the reply
  // streams, the rail shows Reply done, and `outcome` stays null. A fix keyed on
  // traceComplete alone therefore passed its unit test (which set outcome) and
  // changed nothing on screen. These pin the signal that actually holds live.
  test("a gateway hop proves it, with no terminal outcome anywhere", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: null,
      tokenEvents: [waitingTok, { id: "gw-authorize", decision: "PERMIT" }],
    });
    expect(exStep(steps).status).toBe("done");
    expect(exStep(steps).detail.response).toBeTruthy();
  });

  test("an MCP result proves it too", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: null,
      tokenEvents: [waitingTok],
      mcpResult: { tool: "list_orders", result: { ok: true } },
    });
    expect(exStep(steps).status).toBe("done");
  });

  test("with nothing downstream it is still honestly in flight", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: null, tokenEvents: [waitingTok] });
    expect(exStep(steps).status).toBe("active");
  });
});


describe("buildTraceSteps — approval gate pause is not a failed run", () => {
  // UC7/UC8: the 428 an approval gate raises is transport-level failure, so the
  // trace arrives with outcome 'error' and mcpResult.status 'error' (denied
  // false — it is not the expected-DENY shape). Before this, the rail narrated
  // "This run stopped with an error at MCP server" while ProofStrip, reading the
  // same trace, said "Step-up MFA required as expected".
  const pausedTrace = (over = {}) => ({
    ...EMPTY_TRACE,
    outcome: "error",
    prompt: { message: "extend my rental $600" },
    authorize: {
      decision: "INDETERMINATE",
      engine: "pingone",
      response: { decision: "INDETERMINATE", obligations: [{ type: "STEP_UP" }] },
    },
    mcpResult: {
      tool: "extend_rental",
      status: "error",
      error: "mcp_step_up_required",
      denied: false,
      result: { error: "mcp_step_up_required", message: "Step-up required." },
    },
    ...over,
  });

  test("mcp step waits on the gate instead of painting error", () => {
    const mcp = buildTraceSteps(pausedTrace()).find((s) => s.id === "mcp");
    expect(mcp.status).toBe("active");
    expect(mcp.detail.why).toMatch(/paused on step-up MFA/);
  });

  test("run story says paused, not stopped with an error", () => {
    const trace = pausedTrace();
    const story = buildRunStory(trace, buildTraceSteps(trace));
    expect(story.outcome).toBe("active");
    expect(story.headline).toMatch(/Paused: waiting on step-up MFA before “extend_rental”/);
    expect(story.headline).not.toMatch(/error/i);
  });

  test("a declined gate says so rather than claiming the run is still waiting", () => {
    const trace = pausedTrace({ approvalOutcome: "declined" });
    const story = buildRunStory(trace, buildTraceSteps(trace));
    expect(story.headline).toMatch(/Approval declined — step-up MFA was refused/);
  });

  test("a declined gate is TERMINAL — nothing is left pending", () => {
    // A refusal cannot resume, so the run is over: 'active' would leave the rail
    // claiming a gate is still being awaited, and the mcp step spinning forever.
    const trace = pausedTrace({ approvalOutcome: "declined" });
    const steps = buildTraceSteps(trace);
    expect(buildRunStory(trace, steps).outcome).toBe("ok");
    expect(steps.find((s) => s.id === "mcp").status).toBe("notinpath");
    expect(steps.find((s) => s.id === "mcp").detail.why).toMatch(/never ran .* was refused/);
  });

  test("a HITL obligation is named as human approval, not step-up", () => {
    const trace = pausedTrace({
      authorize: {
        decision: "PERMIT",
        response: { decision: "PERMIT", obligations: [{ type: "HITL_APPROVAL" }] },
      },
      mcpResult: { tool: "create_transfer", status: "error", error: "hitl_required", denied: false },
    });
    const story = buildRunStory(trace, buildTraceSteps(trace));
    expect(story.headline).toMatch(/waiting on human approval/);
  });

  test("the BFF's stamped authorize.outcome names the gate, not the obligation", () => {
    // mcpToolPipeline stamps the block kind on trace.authorize.outcome and
    // ProofStrip scores THAT (EXPECTED_OUTCOME_FAMILY). Reading it first is what
    // keeps the rail and the strip from classifying one run two different ways.
    const trace = pausedTrace({
      authorize: { decision: "INDETERMINATE", outcome: "HITL_REQUIRED", engine: "pingone" },
      mcpResult: { tool: "create_transfer", status: "error", error: "mcp_hitl_required", denied: false },
    });
    expect(buildRunStory(trace, buildTraceSteps(trace)).headline)
      .toMatch(/waiting on human approval/);
  });

  test("a gate that was SATISFIED is not reported as still pausing the run", () => {
    // ingestAuthorize carries the block kind forward onto the PERMIT that
    // follows an approved step-up so ProofStrip can still score it — so
    // `outcome: 'STEP_UP'` appears on satisfied runs too. `priorGate` is what
    // says the human already answered.
    const trace = pausedTrace({
      outcome: null,
      authorize: { decision: "PERMIT", outcome: "STEP_UP", priorGate: "STEP_UP" },
      mcpResult: { tool: "extend_rental", status: "success", result: { ok: true } },
    });
    expect(buildRunStory(trace, buildTraceSteps(trace)).headline).not.toMatch(/Paused/);
  });

  test("a stamped hard block is NOT dressed up as a gate", () => {
    // The legacy fallback treats a bare INDETERMINATE as a pause. A stamped
    // DENY/POLICY_NOT_FOUND has to stop the lookup before it gets there, or a
    // hard block renders as "waiting on approval" and the run looks recoverable.
    for (const outcome of ["DENY", "POLICY_NOT_FOUND"]) {
      const trace = pausedTrace({
        authorize: { decision: "INDETERMINATE", outcome, engine: "pingone" },
        mcpResult: { tool: "create_transfer", status: "error", error: "mcp_authorization_denied", denied: false },
      });
      const steps = buildTraceSteps(trace);
      expect(steps.find((s) => s.id === "mcp").status).toBe("error");
      expect(buildRunStory(trace, steps).outcome).toBe("error");
    }
  });

  test("a REAL mcp failure still paints error — the carve-out is gate-only", () => {
    const trace = {
      ...EMPTY_TRACE,
      outcome: "error",
      prompt: { message: "what's the weather in Miami" },
      mcpResult: { tool: "get_weather", status: "error", error: "mcp_error", denied: false },
    };
    const steps = buildTraceSteps(trace);
    expect(steps.find((s) => s.id === "mcp").status).toBe("error");
    expect(buildRunStory(trace, steps).outcome).toBe("error");
  });
});


describe("laneLabel", () => {
  test("shows agent lanes as the Banking Agent and leaves other lanes alone", () => {
    expect(laneLabel("AGENT")).toBe("BANKING AGENT");
    expect(laneLabel("HEURISTICS")).toBe("BANKING AGENT");
    expect(laneLabel("LLM")).toBe("BANKING AGENT");
    expect(laneLabel("GATEWAY")).toBe("GATEWAY");
  });
});


describe("mcp step — terminal failure phases", () => {
  // mcpToolPipeline returns on each of these WITHOUT publishing an mcpResult, so
  // neither mcpDone (wants mcp_remote_done or a result) nor mcpErrored (wants
  // mcpResult.status) can ever become true. mcpBegun then won the status chain
  // and the hop went on claiming the tool was executing for the rest of the
  // session — "MCP server — tool executes" still spinning on a finished run.
  const begun = { phase: "mcp_remote_begin" };

  test.each([
    "mcp_remote_tool_error",
    "gateway_unreachable_no_fallback",
    "local_tool_error",
    "local_fallback_blocked_no_user",
  ])("%s ends the mcp hop as an error, not a spinner", (phase) => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok", phases: [begun, { phase }] });
    expect(steps.find((s) => s.id === "mcp").status).toBe("error");
  });

  // The two below pass with or without the fix: they are guards against
  // over-correcting it, not proof of it.
  test("mcp_remote_unreachable is NOT terminal — a successful local fallback still reads done", () => {
    // The pipeline emits it BEFORE falling back, and the fallback publishes a
    // result. Treating it as terminal would paint a completed run red.
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      phases: [begun, { phase: "mcp_remote_unreachable" }, { phase: "local_tool_done" }],
      mcpResult: { tool: "get_branch_hours", result: { hours: "9-5" } },
    });
    expect(steps.find((s) => s.id === "mcp").status).toBe("done");
  });

  test("a run genuinely still in flight keeps its spinner", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, phases: [begun] });
    expect(steps.find((s) => s.id === "mcp").status).toBe("active");
  });
});
