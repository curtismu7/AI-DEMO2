import { buildTraceSteps, buildRunStory, buildGatewayStages, MCP_STEP_IDS, laneLabel } from "../buildTraceSteps";
import { hasPopoutWorthyDetail } from "../../../components/TraceStepCard";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — pop-out spec content", () => {
  test("every step carries a spec block with a mandate, a rationale and a failure mode", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok" });
    for (const s of steps) {
      expect(s.detail.spec, `${s.id} has no spec`).toBeTruthy();
      expect(s.detail.spec.mandate, `${s.id} spec.mandate`).toEqual(expect.any(String));
      expect(s.detail.spec.why, `${s.id} spec.why`).toEqual(expect.any(String));
      expect(s.detail.spec.failure, `${s.id} spec.failure`).toEqual(expect.any(String));
      expect(Array.isArray(s.detail.spec.refs), `${s.id} spec.refs`).toBe(true);
    }
  });

  test("spec refs deep-link to the section that applies", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    const exchange = steps.find((s) => s.id === "exchange");
    expect(exchange.detail.spec.refs.map((r) => r.label))
      .toEqual(["RFC 8693 §2.1", "RFC 8693 §4.1", "RFC 8707 §2"]);
    for (const ref of exchange.detail.spec.refs) {
      expect(ref.href).toMatch(/^https:\/\/.+#section-/);
      expect(ref.title).toEqual(expect.any(String));
    }
  });

  test("heuristic routing replaces the LLM spec instead of teaching a hop that did not run", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, routingMode: "heuristic" });
    const llm = steps.find((s) => s.id === "llm");
    expect(llm.detail.spec.mandate).toMatch(/no model was called/i);
    expect(llm.detail.spec.why).toMatch(/model removed from the picture/i);
  });

  test("spec alone does not make an un-run step pop-out-worthy", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    const prompt = steps.find((s) => s.id === "prompt");
    expect(prompt.detail.spec).toBeTruthy();
    expect(hasPopoutWorthyDetail(prompt.detail)).toBe(false);
  });

  test("the short rfcs chips stay independent of the long-form spec refs", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.signin.detail.rfcs).toEqual(["RFC 6749", "RFC 7636"]);
    expect(byId.exchange.detail.rfcs).toEqual(["RFC 8693", "RFC 8707"]);
    expect(byId.gateway.detail.rfcs).toBeUndefined();
    expect(byId.gateway.detail.spec.refs.length).toBeGreaterThan(0);
  });
});


describe("buildTraceSteps — statuses from evidence", () => {
  test("prompt + user-token event mark steps 1-2 done", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      prompt: { message: "transfer $250 to savings" },
      tokenEvents: [{ id: "user-token", label: "User Token", status: "active",
        claims: { sub: "user-123", scope: "read write" } }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.signin.status).toBe("done");
    expect(byId.prompt.status).toBe("done");
    expect(byId.prompt.detail.request.text).toContain("transfer $250 to savings");
    expect(byId.signin.detail.inspectToken).toBe("user");
  });

  test("llmDetail fills the llm step with request/response and kv", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      llmDetail: {
        model: "qwen2.5-14b-instruct",
        request: { messages: [{ role: "system", content: "You are a banking assistant." }] },
        toolCalls: [{ name: "transfer_funds", arguments: { amount: 250 } }],
        usage: { inputTokens: 1842, outputTokens: 61 },
      },
    });
    const llm = steps.find((s) => s.id === "llm");
    expect(llm.status).toBe("done");
    expect(llm.lane).toBe("LLM");
    expect(llm.detail.request.text).toContain("banking assistant");
    expect(llm.detail.response.text).toContain("transfer_funds");
    expect(llm.detail.kv).toContainEqual(["tokens used", "prompt 1842 · completion 61"]);
  });

  test("exchanged-token event fills exchange step with scope diff and act proof", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active", claims: { scope: "read write" } },
        { id: "exchanged-token", status: "active",
          claims: { sub: "user-123", scope: "write", aud: "mcp-gw", act: { sub: "agent-001" } },
          scopeNarrowed: true, audienceNarrowed: true,
          exchangeRequest: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
            scope: "write", audience: "mcp-gw" } },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("done");
    expect(ex.detail.scopeDiff).toEqual({ before: ["read", "write"], after: ["write"] });
    expect(ex.detail.beforeAfter.before.text).toContain("read write");
    expect(ex.detail.beforeAfter.after.text).toContain("aud");
    expect(ex.detail.request.text).toContain("token-exchange");
    expect(ex.detail.inspectToken).toBe("mcp");
    expect(ex.detail.rfcs).toContain("RFC 8693");
  });

  // Regression: 2-exchange used to drop exchangeRequest when splicing the
  // in-progress card — TraceRail then had claims response but no coloured request.
  test("two-ex-final-token with exchangeRequest fills TraceRail request JSON", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active", claims: { scope: "read write" } },
        {
          id: "two-ex-final-token",
          status: "exchanged",
          claims: { sub: "user-123", scope: "gateway:mcp:invoke", aud: "mcpgateway.ping.demo",
            act: { sub: "agent-001" } },
          exchangeRequest: {
            exchanger: "mcp-exchanger-client",
            audience: "mcpgateway.ping.demo",
            scope: "gateway:mcp:invoke",
          },
        },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("done");
    expect(ex.detail.request).toBeDefined();
    expect(ex.detail.request.title).toBe("Exchange request (actual)");
    expect(ex.detail.request.text).toContain("mcp-exchanger-client");
    expect(ex.detail.request.text).toContain("gateway:mcp:invoke");
    expect(ex.detail.response.text).toContain("user-123");
    expect(ex.detail.why).toMatch(/delegated token/i);
  });

  test("store-synthesized authorize from gw-authorize fills authorize step why + request", () => {
    // tokenChainTraceStore synthesizes trace.authorize from the gw-authorize event
    // (via _syncGwAuthorize) before buildTraceSteps is called, so buildTraceSteps
    // always receives a pre-populated authorize field on gateway-authoritative runs.
    const gwEv = {
      id: "gw-authorize",
      status: "permit",
      decision: "PERMIT",
      tool: "get_my_accounts",
      url: "https://api.pingone.com/v1/.../decisionEndpoints/abc",
      parameters: { ToolName: "get_my_accounts", UserId: "u1" },
      rawResponse: { decision: "PERMIT", id: "dec_1" },
      backend: "real",
    };
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      authorize: {
        engine: gwEv.backend,
        decision: gwEv.decision,
        decisionId: null,
        decisionContext: `tool:${gwEv.tool}`,
        path: gwEv.url,
        request: { method: "POST", url: gwEv.url, parameters: gwEv.parameters },
        response: gwEv.rawResponse,
        source: "gw-authorize",
      },
      tokenEvents: [gwEv],
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("done");
    expect(az.detail.why).toMatch(/PERMIT/);
    expect(az.detail.request.text).toContain("get_my_accounts");
    expect(az.detail.response.text).toContain("PERMIT");
    expect(az.detail.decision.outcome).toBe("PERMIT");
  });

  test("authorize evaluation fills authorize step with decision + full request", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: {
        engine: "pingone", decision: "PERMIT", decisionId: "dec_8f31",
        decisionContext: "McpFirstTool",
        request: { method: "POST",
          url: "https://api.pingone.com/v1/environments/e1/decisionEndpoints/d1",
          body: { parameters: { UserId: "user-123", ToolName: "transfer_funds", Amount: 250 } } },
        response: { decision: "PERMIT", id: "dec_8f31" },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("done");
    expect(az.detail.decision).toEqual({ outcome: "PERMIT",
      label: "PERMIT — pingone (MCP tool-call check)" });
    expect(az.detail.request.text).toContain("decisionEndpoints/d1");
    expect(az.detail.request.text).toContain("transfer_funds");
    expect(az.detail.kv).toContainEqual(["decision id", "dec_8f31"]);
  });

  // Phase 4 of the INDETERMINATE rework: a pause is now `decision: "PERMIT"`
  // carrying an unfulfilled obligation (cloud parity — routes/decision.js's
  // pausePermit()). Found while implementing phase 4: `azIsPermit` was
  // `azDecision === "PERMIT"` with no obligation exclusion, so it matched a
  // phase-4 pause and won the status ternary BEFORE azIsChallenge was ever
  // consulted — a step-up would have rendered "done" (looks like nothing
  // needs the user) instead of "active" (needs approval). Same bug class the
  // isChallenge/isDeny fix in buildAuthorizeDetail() exists to prevent, one
  // level deeper in this single-decision status computation.
  test("a PERMIT carrying a pause obligation renders as an active challenge, not done (phase 4)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: {
        engine: "pingone", decision: "PERMIT", decisionId: "dec_pause1",
        decisionContext: "McpToolCall",
        request: { method: "POST",
          url: "https://api.pingone.com/v1/environments/e1/decisionEndpoints/d1",
          body: { parameters: { ToolName: "create_transfer", TransactionAmount: "600" } } },
        response: {
          decision: "PERMIT",
          obligations: [{ id: "step-up", type: "STEP_UP", obligatory: true, fulfilled: false }],
        },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("active");
    expect(az.status).not.toBe("done");
  });

  test("simulated-engine authorize evaluation renders request parameters (no .body wrapper)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: {
        engine: "simulated", decision: "PERMIT", decisionId: "sim_1",
        decisionContext: "McpFirstTool",
        request: { parameters: { UserId: "user-123", ToolName: "transfer_funds", Amount: 250 } },
        response: { decision: "PERMIT" },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.detail.request.text).toContain("transfer_funds");
  });

  test("public catalog marks P1AZ not in path instead of claiming simulation", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "authorize-decision",
        status: "skipped",
        authorizeDecision: "SKIPPED",
        authorizeEngine: "not-called",
        publicCatalog: true,
      }],
      outcome: "ok",
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("notinpath");
    expect(az.detail.decision).toEqual({
      outcome: "SKIPPED",
      label: "SKIPPED — public catalog path",
    });
    expect(az.detail.why).toContain("was not called");
  });

  test("authorize_denied phase renders authorize step as error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", label: "Authorize denied", detail: "" }],
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("error");
  });

  test("authorize_denied with HTTP 428 is a challenge (active), not a hard DENY", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", status: 428, label: "Step-up required" }],
      authorize: {
        decision: "INDETERMINATE",
        engine: "simulated",
        decisionId: "d-stepup",
        request: { parameters: { ToolName: "create_transfer" } },
        response: { decision: "INDETERMINATE" },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("active");
    expect(az.detail.decision.outcome).toBe("INDETERMINATE");
    expect(az.detail.request.text).toContain("create_transfer");
  });

  test("authorize_denied with detail 'HTTP 428' (legacy SSE row) is a challenge", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", label: "Authorize denied", detail: "HTTP 428" }],
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("active");
  });

  test("authorize_denied + DENY evaluation stays error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", status: 403 }],
      authorize: { decision: "DENY", engine: "pingone", decisionId: "d-deny" },
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("error");
  });

  test("authorize_unavailable renders authorize step as error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [
        { phase: "authorize_gate_begin" },
        { phase: "authorize_unavailable" },
      ],
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("error");
  });

  test("mfa_challenge_initiated inserts conditional step-up step after authorize", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "mfa_challenge_initiated", label: "HITL — MFA challenge", detail: "" }],
    });
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf("stepup")).toBe(ids.indexOf("authorize") + 1);
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  // demo_hitl_service's consent-required gate is a SEPARATE mechanism from the
  // mfa_challenge_* device step-up above, but shares the same "stepup" chip —
  // both real deps.emit() phases from mcpToolPipeline.js's HITL branch.
  test("authorize_denied_hitl marks step-up active (demo_hitl_service challenge created)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied_hitl", label: "HITL challenge required", detail: "" }],
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  test("gateway_step_up_required and mcp_auth_challenge_intercepted also mark step-up active", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [
        { phase: "mcp_auth_challenge_intercepted", label: "", detail: "" },
        { phase: "gateway_step_up_required", label: "", detail: "" },
      ],
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  // The HITL gate is asynchronous — the human approves out-of-band and the
  // agent retries as a separate later trace — so "done" is only knowable on
  // the retry's own trace, via authorize.hitlApproved (already returned by
  // mcpToolAuthorizationService.js once a verified receipt permits the call).
  test("a retry trace with authorize.hitlApproved marks step-up done", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_permitted", label: "", detail: "" }],
      authorize: { decision: "PERMIT", hitlApproved: true, hitlChallengeId: "chal-1" },
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("done");
  });

  test("gw-authorize token event fills gateway step checks", () => {
    const statements = [{
      name: "MCP Tool Authorization Denied",
      payload: '{"denied":true,"reason":"invalid_aud"}',
    }];
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", status: "active",
        decision: "PERMIT", url: "https://gw/authz", statements }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("done");
    expect(gw.detail.kv.some(([k]) => k === "authorize")).toBe(true);
    expect(gw.detail.kv.find(([k]) => k === "statements")[1]).toBe(statements);
  });

  test("gw-authorize parameters + rawResponse render full request/response and moreDetail link", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "gw-authorize", status: "permit", decision: "PERMIT",
        url: "https://api.pingone.com/v1/environments/e/decisionEndpoints/d",
        parameters: { ToolName: "get_my_accounts", UserId: "user-1" },
        rawResponse: { decision: "PERMIT", id: "dec_1" },
      }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.detail.request.text).toContain("get_my_accounts");
    expect(gw.detail.response.text).toContain("PERMIT");
    // The gateway hop's education topic is the Agent Gateway — the P1AZ
    // decision is a separate step with its own link.
    expect(gw.detail.moreDetail).toEqual({ edu: "agent-gateway", label: "Learn: Agent Gateway" });
  });

  test("gateway step carries a gateway-tester replay of the tool call that ran", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", status: "permit", decision: "PERMIT" }],
      mcpResult: { requestJson: { name: "transfer_funds", arguments: { amount: 250 } } },
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.detail.replay).toEqual({
      target: "gateway",
      href: "/agent-gateway-inspector?subtab=tester",
      label: "Replay in Gateway Tester",
      tool: "transfer_funds",
      arguments: { amount: 250 },
    });
  });

  test("gateway step falls back to the sim-gateway-deny tool/arguments when the call never reached the MCP server", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "sim-gateway-deny", label: "Gateway DENY (insufficient_scope)", status: "error",
        error: "insufficient_scope", httpStatus: 403,
        tool: "create_transfer", arguments: { amount: 1, toAccountId: "sim-acc-001" },
      }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.detail.replay).toEqual({
      target: "gateway",
      href: "/agent-gateway-inspector?subtab=tester",
      label: "Replay in Gateway Tester",
      tool: "create_transfer",
      arguments: { amount: 1, toAccountId: "sim-acc-001" },
    });
  });

  test("gateway step has no replay when the run produced no tool call", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "evt-inbound", label: "user bearer received" }],
    });
    expect(steps.find((s) => s.id === "gateway").detail.replay).toBeNull();
  });

  test("authorize-decision token event fills authorize step when ingestAuthorize absent", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "authorize-decision", status: "active",
        authorizeEngine: "pingone", authorizeDecision: "PERMIT",
        authorizeDecisionId: "dec_9",
        authorizeRequest: { method: "POST", url: "/decision", body: { parameters: { ToolName: "transfer_funds" } } },
        authorizeResponse: { decision: "PERMIT" },
      }],
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("done");
    expect(az.detail.request.text).toContain("transfer_funds");
    expect(az.detail.response.text).toContain("PERMIT");
    expect(az.detail.moreDetail).toEqual({ edu: "pingone-authorize", label: "Learn: PingOne Authorize" });
    expect(az.detail.replay).toEqual({
      target: "p1az",
      href: "/pingone-authorize",
      label: "Replay in P1AZ Evaluate",
      parameters: { ToolName: "transfer_funds" },
      endpointId: null,
    });
  });

  test("mcpResult fills mcp and api steps; llmReply fills reply", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: { tool: "transfer_funds", durationMs: 412,
        requestJson: { name: "transfer_funds", arguments: { amount: 250 } },
        result: { transactionId: "txn_9d2e", status: "posted" } },
      llmReply: "Done! I transferred $250.",
      phases: [{ phase: "mcp_remote_done", label: "done", detail: "" }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.mcp.status).toBe("done");
    expect(byId.mcp.detail.request.text).toContain("transfer_funds");
    expect(byId.api.detail.response.text).toContain("txn_9d2e");
    expect(byId.reply.status).toBe("done");
    expect(byId.reply.detail.response.text).toContain("Done!");
  });

  test("United SQL results add observed resource-server and database cards", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: {
        tool: "get_airline_bookings",
        result: { source: "sqlite", upcomingTrips: 2 },
      },
      phases: [{ phase: "mcp_remote_done" }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));

    expect(byId.api).toMatchObject({
      title: "United Airlines backend app — resource server",
      lane: "AIRLINES",
      status: "done",
    });
    expect(byId.database).toMatchObject({
      title: "SQL Database — United Airlines data",
      lane: "DATA",
      status: "done",
    });
    expect(byId.database.detail.kv).toContainEqual(["engine", "SQLite"]);
    expect(steps.indexOf(byId.database)).toBe(steps.indexOf(byId.api) + 1);
  });

  test("a non-United SQLite result keeps generic backend labels", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: { tool: "future_sql_tool", result: { source: "sqlite", ok: true } },
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));

    expect(byId.api.title).toBe("Resource server — backend app");
    expect(byId.database.title).toBe("Database — data query");
    expect(byId.database.detail.narrative).not.toContain("United Airlines");
  });

  test("two-exchange event ids fill agent-token and exchange steps", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active",
          claims: { sub: "user-123", scope: "read write transfer" } },
        { id: "two-ex-agent-actor", status: "active",
          claims: { client_id: "ai-agent", scope: "agent:invoke" } },
        { id: "two-ex-final-token", status: "exchanged",
          scopeNarrowed: true, audienceNarrowed: true,
          audExpected: "mcp-gw", audActual: "mcp-gw", exchangeMethod: "RFC 8693 x2",
          claims: { sub: "user-123", scope: "write", aud: "mcp-gw",
            act: { sub: "agent-001" } } },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["agent-token"].status).toBe("done");
    expect(byId["agent-token"].detail.inspectToken).toBe("agent");
    expect(byId["agent-token"].detail.response.text).toContain("agent:invoke");
    expect(byId.exchange.status).toBe("done");
    expect(byId.exchange.detail.scopeDiff).toEqual({
      before: ["read", "write", "transfer"], after: ["write"] });
    expect(byId.exchange.detail.response.text).toContain("agent-001");
    expect(byId.exchange.detail.kv).toContainEqual(["act chain", expect.stringContaining("agent-001")]);
    expect(byId.exchange.detail.inspectToken).toBe("mcp");
  });

  test("signin and agent-token steps expose full token claims as a response block", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active",
          claims: { sub: "user-123", scope: "read write", acr: "Multi_Factor",
            iss: "https://auth.pingone.com/env/as", aud: "enduser", sid: "s1",
            client_id: "web", exp: 2, iat: 1 } },
        { id: "agent-actor-token", status: "active",
          claims: { client_id: "ai-agent", scope: "agent:invoke" } },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    // Full claims must be visible even beyond the 6-row kv preview
    expect(byId.signin.detail.response.text).toContain("Multi_Factor");
    expect(byId.signin.detail.response.text).toContain("client_id");
    expect(byId["agent-token"].detail.response.text).toContain("ai-agent");
  });

  test("gateway_policy_denied phase marks gateway error with denial detail and fails mcp step", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [
        { phase: "mcp_remote_begin", label: "MCP call", detail: "" },
        { phase: "gateway_policy_denied", label: "Gateway policy denied",
          detail: "code · access_denied" },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.gateway.status).toBe("error");
    expect(byId.gateway.detail.decision.outcome).toBe("DENY");
    expect(byId.gateway.detail.decision.label).toContain("access_denied");
    expect(byId.mcp.status).toBe("error");
  });

  test("heuristic routing marks agent + llm done (bypass) and reply from llmReply", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      routingMode: "heuristic",
      routingDetail: { action: "view_coverage" },
      llmReply: "Your deductible is $500.",
      tokenEvents: [{ id: "user-token", status: "active", claims: { sub: "u1" } }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.agent.status).toBe("done");
    expect(byId.llm.status).toBe("done");
    expect(byId.llm.title).toBe("Banking Agent · Generalist agent — intent match & tool choice");
    expect(byId.llm.lane).toBe("HEURISTICS");
    expect(byId.llm.detail.response.text).toContain("view_coverage");
    expect(byId.reply.status).toBe("done");
    expect(byId.reply.title).toBe("Banking Agent composes reply → chat");
    expect(byId.reply.lane).toBe("HEURISTICS");
  });

  test("heuristic chip path marks reply done from mcpResult without llmReply", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      routingMode: "heuristic",
      routingDetail: { action: "get_my_accounts" },
      phases: [{ phase: "mcp_remote_done" }],
      mcpResult: { tool: "get_my_accounts", result: { accounts: [{ id: "a1" }] } },
      tokenEvents: [{ id: "user-token", status: "active", claims: { sub: "u1" } }],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.llm.status).toBe("done");
    expect(byId.llm.lane).toBe("HEURISTICS");
    expect(byId.reply.status).toBe("done");
    expect(byId.reply.title).toBe("Banking Agent composes reply → chat");
    expect(byId.reply.lane).toBe("HEURISTICS");
    expect(byId.reply.detail.response.text).toContain("a1");
  });

  test("api step surfaces the api-key call + masked key when the swap ran", () => {
    const trace = { ...EMPTY_TRACE,
      tokenEvents: [
        { id: 'evt-inbound', tokenType: 'access_token', credentialPath: 'api_key', status: 'ok', label: 'Inbound user bearer received' },
        { id: 'vault-key-inject', tokenType: 'api_key', maskedValue: '...0000', credentialPath: 'api_key', status: 'ok', label: 'Vault key injected by PingOne Agent Gateway → invest' },
        { id: 'evt-swap', tokenType: 'api_key', maskedValue: '...0000', credentialPath: 'api_key', status: 'ok', label: 'Gateway swap: OAuth bearer dropped, service API key attached' },
        { id: 'evt-backend', tokenType: 'api_key', credentialPath: 'api_key', status: 'ok', label: 'Outbound GET demo_data_service /invest' },
      ],
      mcpResult: { _meta: { credentialPath: 'api_key', apiKeyMaskedLast4: '0000', apiCall: 'GET /invest' }, result: { invest: { portfolioId: 'INV-1' } } },
    };
    const steps = buildTraceSteps(trace);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId['api-key-swap'].status).toBe('done');
    expect(byId['vault-key-inject'].status).toBe('done');
    expect(JSON.stringify(byId['api-key-swap'].detail)).toContain('0000');
    expect(byId.api.status).toBe('done');
    const flat = JSON.stringify(byId.api.detail);
    expect(flat).toContain('GET /invest');
    expect(flat).toContain('0000');
  });
});


describe("buildTraceSteps — not-in-path steps once the trace completes", () => {
  test("gateway with no evidence stays pending mid-flight, flips to notinpath once outcome is set", () => {
    const midFlight = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } } });
    expect(midFlight.find((s) => s.id === "gateway").status).toBe("pending");

    const complete = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } }, outcome: "ok" });
    expect(complete.find((s) => s.id === "gateway").status).toBe("notinpath");
  });

  test("gateway with only a skipped-status introspection event renders notinpath, not done", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-introspection", status: "skipped",
        explanation: "Gateway introspection skipped (endpoint not configured)" }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("notinpath");
    expect(gw.detail.narrative).toContain("Gateway introspection skipped");
  });

  test("real gateway evidence still marks the step done even after the trace completes", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-authorize", status: "permit", decision: "PERMIT" }],
    });
    expect(steps.find((s) => s.id === "gateway").status).toBe("done");
  });

  test("api-key-swap stays pending mid-flight, flips to notinpath once outcome is set on the OAuth path", () => {
    const midFlight = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } } });
    expect(midFlight.find((s) => s.id === "api-key-swap").status).toBe("pending");

    const complete = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } }, outcome: "ok" });
    expect(complete.find((s) => s.id === "api-key-swap").status).toBe("notinpath");
  });

  test("database stays pending mid-flight and becomes notinpath without SQL evidence", () => {
    const midFlight = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } } });
    expect(midFlight.find((s) => s.id === "database").status).toBe("pending");

    const complete = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: { result: { ok: true } },
      outcome: "ok",
    });
    expect(complete.find((s) => s.id === "database").status).toBe("notinpath");
  });

  test("stepup is absent mid-flight and appears as notinpath once the trace completes without a challenge", () => {
    const midFlight = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } } });
    expect(midFlight.map((s) => s.id)).not.toContain("stepup");

    const complete = buildTraceSteps({ ...EMPTY_TRACE, mcpResult: { result: { ok: true } }, outcome: "ok" });
    const ids = complete.map((s) => s.id);
    expect(ids.indexOf("stepup")).toBe(ids.indexOf("authorize") + 1);
    expect(complete.find((s) => s.id === "stepup").status).toBe("notinpath");
  });

  test("a real step-up challenge still wins over the notinpath default", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      phases: [{ phase: "mfa_challenge_initiated", label: "HITL — MFA challenge", detail: "" }],
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  test("a bare 428 authorize_denied (the BFF's step-up block) marks step-up active", () => {
    // The BFF's step-up block emits no phase of its own.
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", status: 428 }],
    });
    const stepup = steps.find((s) => s.id === "stepup");
    expect(stepup.status).toBe("active");
    expect(stepup.detail.kv).toContainEqual(["authorize", "HTTP 428 challenge"]);
  });

  test("a hard 403 authorize_denied does not invent a step-up", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      phases: [{ phase: "authorize_denied", status: 403 }],
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("notinpath");
  });

  test("a step-up retry that PERMITs with the gate carried does not reopen step-up", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      authorize: { decision: "PERMIT", outcome: "STEP_UP", priorGate: "STEP_UP" },
    });
    expect(steps.find((s) => s.id === "stepup").status).not.toBe("active");
  });

  test("gateway_hitl_required (live PingOne Agent Gateway consent gate) marks step-up active", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "gateway_hitl_required", label: "", detail: "" }],
    });
    expect(steps.find((s) => s.id === "stepup").status).toBe("active");
  });

  test.each([
    ["pending", "active"],
    ["approved", "done"],
    ["denied", "error"],
  ])("a ciba-poll event with status %s marks step-up %s", (cibaStatus, expected) => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "ciba-poll", additionalData: { grantedVia: "ciba", status: cibaStatus } }],
    });
    const stepup = steps.find((s) => s.id === "stepup");
    expect(stepup.status).toBe(expected);
    expect(stepup.detail.kv).toContainEqual(["ciba", cibaStatus]);
  });
});
