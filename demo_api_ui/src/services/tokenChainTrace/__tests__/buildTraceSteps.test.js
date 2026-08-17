import { buildTraceSteps, buildRunStory, buildGatewayStages } from "../buildTraceSteps";
import { hasPopoutWorthyDetail } from "../../../components/TraceStepCard";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — empty trace", () => {
  test("returns the 19 happy-path steps (intent-binding omitted mid-flight), all pending", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    // Each MCP method is TWO requests: the credential-less one the gateway
    // refuses, then the authorized one. Both legs are their own hop.
    expect(steps.map((s) => s.id)).toEqual([
      "website", "signin", "prompt", "agent",
      "tools-list-challenge", "tools-list", "llm", "agent-token", "exchange",
      "authorize", "gateway", "api-key-swap",
      // A tool call is three MCP messages, not one.
      "tools-call-challenge", "mcp-initialize", "mcp-initialized", "mcp",
      "api", "database", "reply",
    ]);
    expect(steps[0].status).toBe("done"); // website is inherently done
    expect(steps.slice(1).every((s) => s.status === "pending")).toBe(true);
    expect(steps.map((s) => s.num)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]);
  });

  test("each MCP method's challenge leg sits immediately before its authorized leg", () => {
    const ids = buildTraceSteps(EMPTY_TRACE).map((s) => s.id);
    expect(ids.indexOf("tools-list") - ids.indexOf("tools-list-challenge")).toBe(1);
    // The tool-call challenge is followed by the MCP lifecycle handshake, so
    // its authorized leg is three hops later, not one.
    expect(ids.indexOf("mcp") - ids.indexOf("tools-call-challenge")).toBe(3);
    expect(ids.indexOf("mcp-initialize") - ids.indexOf("tools-call-challenge")).toBe(1);
    expect(ids.indexOf("mcp") - ids.indexOf("mcp-initialized")).toBe(1);
  });

  test("tool discovery sits between the agent and the model that consumes the catalog", () => {
    const ids = buildTraceSteps(EMPTY_TRACE).map((s) => s.id);
    expect(ids.indexOf("tools-list")).toBeGreaterThan(ids.indexOf("agent"));
    expect(ids.indexOf("tools-list")).toBeLessThan(ids.indexOf("llm"));
  });
});

describe("buildTraceSteps — MCP 401 challenge legs", () => {
  const challengeEvents = (phase) => [
    {
      type: "mcp_challenge", phase, method: phase, status: 401, challenged: true,
      url: "https://gw.example/mcp",
      wwwAuthenticate: 'Bearer realm="PingOne", resource_metadata="https://gw.example/.well-known/oauth-protected-resource"',
      realm: "PingOne",
      resourceMetadataUrl: "https://gw.example/.well-known/oauth-protected-resource",
    },
    {
      type: "mcp_resource_metadata", phase,
      url: "https://gw.example/.well-known/oauth-protected-resource",
      resource: "https://gw.example/mcp",
      authorizationServers: ["https://auth.pingone.com/env/as"],
      scopesSupported: ["mcp:invoke"],
      document: { resource: "https://gw.example/mcp" },
    },
  ];
  const stepById = (steps, id) => steps.find((s) => s.id === id);

  test("a 401 with a resource_metadata pointer is the control working — done, not error", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: challengeEvents("tools/list") });
    const step = stepById(steps, "tools-list-challenge");
    expect(step.status).toBe("done");
    // The refusal still reads as a DENY for the topology badge.
    expect(step.detail.decision.outcome).toBe("DENY");
    expect(step.detail.response.text).toContain("resource_metadata=");
    expect(step.detail.kv).toContainEqual(["authorization server", "https://auth.pingone.com/env/as"]);
  });

  test("evidence is keyed by phase, so the tools/list challenge does not light up the tools/call hop", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: challengeEvents("tools/list") });
    expect(stepById(steps, "tools-call-challenge").status).toBe("pending");
    expect(stepById(steps, "tools-call-challenge").detail.kv).toBeUndefined();
  });

  test("a gateway that serves an anonymous call instead of challenging it is an error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ type: "mcp_challenge", phase: "tools/call", method: "tools/call", status: 200, challenged: false }],
    });
    const step = stepById(steps, "tools-call-challenge");
    expect(step.status).toBe("error");
    expect(step.detail.why).toContain("HTTP 200");
    expect(step.detail.decision).toBeUndefined();
  });

  test("no gateway to challenge is notinpath, not a failure", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ type: "mcp_challenge_skipped", phase: "tools/list", reason: "no_gateway_configured" }],
    });
    expect(stepById(steps, "tools-list-challenge").status).toBe("notinpath");
  });
});

describe("buildTraceSteps — Agent Gateway filter chain", () => {
  const CHAIN = [
    { filter: "TokenIntrospection", result: "passed" },
    { filter: "GatewayTokenPolicy", result: "passed" },
    { filter: "P1AZDecision", result: "forwarded", decision: "PERMIT" },
    { filter: "mTLS", result: "skipped" },
    { filter: "BackendExchange", result: "forwarded" },
  ];
  const gwStep = (steps) => steps.find((s) => s.id === "gateway");

  test("maps the gateway's stage vocabulary onto the rail's status vocabulary", () => {
    const stages = buildGatewayStages(CHAIN, null);
    expect(stages.map((s) => s.status)).toEqual(["done", "done", "done", "notinpath", "done"]);
    // A stage that never ran must stay distinct from one that refused.
    expect(stages[3].status).not.toBe("error");
    expect(stages[2].decision).toBe("PERMIT");
  });

  test("renames the raw filter names and keeps the raw one for keying", () => {
    const stages = buildGatewayStages(CHAIN, null);
    expect(stages[0].name).toBe("Token introspection");
    expect(stages[0].raw).toBe("TokenIntrospection");
    expect(stages[4].name).toBe("Backend token exchange");
  });

  test("an unknown future stage still renders rather than being dropped", () => {
    const stages = buildGatewayStages([{ filter: "SomeNewFilter", result: "passed" }], null);
    expect(stages).toHaveLength(1);
    expect(stages[0].name).toBe("SomeNewFilter");
    expect(stages[0].note).toBeUndefined();
  });

  test("marks the stage that blocked and says so in the why line", () => {
    const blocked = [
      { filter: "TokenIntrospection", result: "passed" },
      { filter: "GatewayTokenPolicy", result: "blocked" },
    ];
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "gateway_policy_denied", detail: "scope" }],
      tokenEvents: [{ id: "gw-filter-chain", filterChain: blocked, denyingFilter: "GatewayTokenPolicy" }],
    });
    const stages = gwStep(steps).detail.stages;
    expect(stages[1].status).toBe("error");
    expect(stages[1].blockedHere).toBe(true);
    expect(stages[0].blockedHere).toBe(false);
    expect(gwStep(steps).detail.why).toMatch(/Gateway token policy/);
  });

  test("reads the chain off gw-authorize when there is no dedicated event", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", decision: "PERMIT", tool: "get_my_accounts", filterChain: CHAIN, lastFilter: "BackendExchange" }],
    });
    expect(gwStep(steps).detail.stages).toHaveLength(5);
    expect(gwStep(steps).detail.why).toMatch(/Backend token exchange/);
  });

  test("no filter chain means no stages block, not an empty one", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", decision: "PERMIT" }],
    });
    expect(gwStep(steps).detail.stages).toBeUndefined();
  });
});

describe("buildTraceSteps — MCP lifecycle handshake and the second exchange", () => {
  const byId = (steps, id) => steps.find((s) => s.id === id);

  test("initialize reports the negotiated protocol version and the server it agreed with", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "mcp-initialize", request: { method: "initialize" }, response: { result: { protocolVersion: "2025-11-25" } },
          negotiatedVersion: "2025-11-25", serverInfo: { name: "banking-mcp", version: "1.2.0" } },
        { id: "mcp-initialized", request: { jsonrpc: "2.0", method: "notifications/initialized" } },
      ],
    });
    expect(byId(steps, "mcp-initialize").status).toBe("done");
    expect(byId(steps, "mcp-initialize").detail.kv).toContainEqual(["protocol version", "2025-11-25"]);
    expect(byId(steps, "mcp-initialize").detail.kv).toContainEqual(["server", "banking-mcp 1.2.0"]);
  });

  test("the initialized notification says it gets no reply rather than showing an empty response", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "mcp-initialized", request: { jsonrpc: "2.0", method: "notifications/initialized" } }],
    });
    const step = byId(steps, "mcp-initialized");
    expect(step.detail.response).toBeUndefined();
    expect(step.detail.kv[0][1]).toMatch(/not answered/);
  });

  test("two-exchange runs get their own exchange #1 hop, immediately before the delegated one", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "two-ex-exchange1", claims: { scope: "agent:invoke", aud: "agentgateway.ping.demo" } },
        { id: "two-ex-final-token", claims: { scope: "read", act: { sub: "agent-1" } } },
      ],
    });
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("exchange-1");
    expect(ids.indexOf("exchange") - ids.indexOf("exchange-1")).toBe(1);
    expect(byId(steps, "exchange-1").detail.kv).toContainEqual(["scope", "agent:invoke"]);
  });

  test("a 1-exchange run adds no exchange #1 card", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "exchanged-token", claims: { scope: "read" } }],
    });
    expect(steps.map((s) => s.id)).not.toContain("exchange-1");
  });

  test("on the gateway path the handshake hops explain that the gateway owns the MCP session", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-authorize", decision: "PERMIT", tool: "list_orders" }],
    });
    for (const id of ["mcp-initialize", "mcp-initialized"]) {
      const step = steps.find((s) => s.id === id);
      expect(step.status).toBe("notinpath");
      // Must say WHY there is nothing here, not leave an unexplained grey card.
      expect(step.detail.narrative).toMatch(/gateway is the MCP client/);
    }
  });

  test("the direct path keeps the protocol narrative, not the gateway explanation", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [],
    });
    const step = steps.find((s) => s.id === "mcp-initialize");
    expect(step.detail.narrative).not.toMatch(/gateway is the MCP client/);
  });
});

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
    expect(byId.llm.title).toBe("Heuristics — intent match & tool choice");
    expect(byId.llm.lane).toBe("HEURISTICS");
    expect(byId.llm.detail.response.text).toContain("view_coverage");
    expect(byId.reply.status).toBe("done");
    expect(byId.reply.title).toBe("Heuristics composes reply → chat");
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
    expect(byId.reply.title).toBe("Heuristics composes reply → chat");
    expect(byId.reply.lane).toBe("HEURISTICS");
    expect(byId.reply.detail.response.text).toContain("a1");
  });

  test("api step surfaces the api-key call + masked key when the swap ran", () => {
    const trace = { ...EMPTY_TRACE,
      tokenEvents: [
        { id: 'evt-inbound', tokenType: 'access_token', credentialPath: 'api_key', status: 'ok', label: 'Inbound user bearer received' },
        { id: 'evt-swap', tokenType: 'api_key', maskedValue: '...0000', credentialPath: 'api_key', status: 'ok', label: 'Gateway swap: OAuth bearer dropped, service API key attached' },
        { id: 'evt-backend', tokenType: 'api_key', credentialPath: 'api_key', status: 'ok', label: 'Outbound GET demo_data_service /invest' },
      ],
      mcpResult: { _meta: { credentialPath: 'api_key', apiKeyMaskedLast4: '0000', apiCall: 'GET /invest' }, result: { invest: { portfolioId: 'INV-1' } } },
    };
    const steps = buildTraceSteps(trace);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId['api-key-swap'].status).toBe('done');
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
});

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
