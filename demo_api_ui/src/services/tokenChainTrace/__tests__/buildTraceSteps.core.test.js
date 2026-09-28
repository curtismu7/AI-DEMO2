import { buildTraceSteps, buildRunStory, buildGatewayStages, MCP_STEP_IDS, laneLabel } from "../buildTraceSteps";
import { hasPopoutWorthyDetail } from "../../../components/TraceStepCard";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — empty trace", () => {
  test("returns the 18 happy-path steps (intent-binding omitted mid-flight), all pending", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    // Each MCP method is TWO requests: the credential-less one the gateway
    // refuses, then the authorized one. Both legs are their own hop.
    expect(steps.map((s) => s.id)).toEqual([
      "website", "signin", "prompt", "agent",
      // No initialize / notifications/initialized hops. The MCP session is opened
      // by the gateway during DISCOVERY — traced live 2026-08-18, the tool-call
      // leg produces initialize / notifications/initialized / tools/list on the
      // MCP server and no tools/call at all. As their own cards they claimed a
      // session per invocation; next to discovery they sat blank on any chain
      // built from one invoke response. The evidence hangs off `tools-list`
      // instead — see the discovery-hop test below.
      "tools-list-challenge", "tools-list",
      "llm", "agent-token", "exchange",
      // tools/call's credential-less leg goes out after the Authorize gate and
      // before the authorized call reaches the gateway, so it is drawn there.
      "authorize", "tools-call-challenge", "gateway", "vault-key-inject", "api-key-swap", "mcp",
      "api", "database", "reply",
    ]);
    expect(steps[0].status).toBe("done"); // website is inherently done
    expect(steps.slice(1).every((s) => s.status === "pending")).toBe(true);
    expect(steps.map((s) => s.num)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
  });

  test("each MCP method's challenge leg is drawn in wire order, just before the hop that carries its authorized call", () => {
    const ids = buildTraceSteps(EMPTY_TRACE).map((s) => s.id);
    // tools/list's authorized leg is its own hop. tools/call's authorized leg
    // reaches the gateway first, so its challenge sits between Authorize and the
    // gateway. The session handshake is not a hop at all (its evidence hangs off
    // tools-list).
    expect(ids.indexOf("tools-list") - ids.indexOf("tools-list-challenge")).toBe(1);
    expect(ids.indexOf("tools-call-challenge") - ids.indexOf("authorize")).toBe(1);
    expect(ids.indexOf("gateway") - ids.indexOf("tools-call-challenge")).toBe(1);
    // The MCP tab renders MCP_STEP_IDS in list order, so it must match the chain.
    expect(MCP_STEP_IDS).toEqual(ids.filter((id) => MCP_STEP_IDS.includes(id)));
    expect(ids).not.toContain("mcp-initialize");
    expect(ids).not.toContain("mcp-initialized");
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

  test("renders the live P1AZ resolver as a distinct SQLite-backed step", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "gw-authorize",
        status: "permit",
        decision: "PERMIT",
        resolver: {
          status: "resolved",
          source: "sqlite",
          userId: "demo-user",
          accountId: "acct-002",
          riskTier: "standard",
          balance: 18540,
          currency: "USD",
        },
      }],
    });
    const resolver = steps.find((step) => step.id === "p1az-resolver");
    expect(resolver).toMatchObject({
      title: "P1AZ Resolver → SQLite account context",
      lane: "DATA",
      status: "done",
    });
    expect(resolver.detail.kv).toEqual([
      ["user", "demo-user"],
      ["account", "acct-002"],
      ["risk tier", "standard"],
      ["balance", "18540 USD"],
      ["source", "SQLite"],
    ]);
    expect(steps.indexOf(resolver)).toBe(steps.findIndex((step) => step.id === "gateway") - 1);
  });

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

  test("labels the PingOne Agent Gateway filters a live IG run actually reports", () => {
    // Confirmed live on the focus-mode dashboard: the IG route emits these three
    // rather than the Node gateway's GatewayTokenPolicy/mTLS/BackendExchange.
    const stages = buildGatewayStages([
      { filter: "McpValidationFilter", result: "passed" },
      { filter: "McpAuditFilter", result: "passed" },
      { filter: "McpProtectionFilter", result: "passed" },
    ], null);
    expect(stages.map((s) => s.name)).toEqual([
      "MCP protocol validation", "Audit trail", "MCP resource protection",
    ]);
    expect(stages.every((s) => typeof s.note === "string" && s.note.length > 0)).toBe(true);
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

  test("a gateway permit that reports only its filter chain is drawn as done", () => {
    // PingOne Agent Gateway permits often publish nothing but X-Gw-Audit-Trail.
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-filter-chain", status: "active", filterChain: CHAIN, lastFilter: "BackendExchange" }],
    });
    expect(gwStep(steps).status).toBe("done");
    expect(gwStep(steps).detail.stages).toHaveLength(5);
  });

  test("a deny carrying the gateway's own P1AZ DENY is drawn on the gateway, not as not in path", () => {
    // The pipeline hands the gateway's decision over as the run's authorize
    // evidence, so Authorize reads failed too.
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      authorize: { decision: "DENY" },
      phases: [{ phase: "gateway_policy_denied", detail: "access_denied" }],
      tokenEvents: [{
        id: "gw-filter-chain", status: "deny", denyingFilter: "P1AZDecision",
        filterChain: [
          { filter: "TokenIntrospection", result: "passed" },
          { filter: "P1AZDecision", result: "blocked", decision: "DENY" },
        ],
      }],
    });
    expect(steps.find((s) => s.id === "authorize").status).toBe("error");
    expect(gwStep(steps).status).toBe("error");
    expect(gwStep(steps).detail.decision.outcome).toBe("DENY");
  });

  test("a filter-chain deny with no gateway_policy_denied phase is still drawn on the gateway", () => {
    // Live UC31 (Miami under the texas scope) on /api/agent/invoke: the deny
    // reaches the trace only as gw-filter-chain status "deny".
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [{
        id: "gw-filter-chain", status: "deny",
        explanation: "Agent Gateway: weather scope restricted to texas",
        denyingFilter: "tx-weather-scope.groovy",
        filterChain: [{ filter: "tx-weather-scope.groovy", result: "blocked" }],
      }],
    });
    expect(gwStep(steps).status).toBe("error");
    expect(gwStep(steps).detail.decision.outcome).toBe("DENY");
    expect(gwStep(steps).detail.decision.label).toContain("weather scope restricted");
  });
});


describe("buildTraceSteps — MCP lifecycle handshake and the second exchange", () => {
  const byId = (steps, id) => steps.find((s) => s.id === id);

  // The handshake is reported on the hop that CAUSED it. The gateway opens the
  // MCP session in order to list tools, so discovery owns that evidence — not a
  // pair of standalone cards implying a session per tool call.
  const DISCOVERY_EVENTS = [
    { type: "tools_list_success", permittedCount: 97, deniedCount: 3, vertical: "banking" },
    { id: "mcp-initialize", negotiatedVersion: "2025-11-25",
      serverInfo: { name: "banking-mcp", version: "1.2.0" }, performedBy: "agent-gateway" },
    { id: "mcp-initialized", performedBy: "agent-gateway" },
  ];

  test("the discovery hop reports the MCP session it opened", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: DISCOVERY_EVENTS });
    const kv = byId(steps, "tools-list").detail.kv;
    expect(kv).toContainEqual(["MCP session", "initialize -> 2025-11-25 -> notifications/initialized"]);
    expect(kv).toContainEqual(["MCP server", "banking-mcp 1.2.0"]);
    // Who the client is matters: on this path it is the gateway, not the BFF.
    expect(kv).toContainEqual(["session opened by", "agent-gateway"]);
  });

  test("it does not claim the notification when only initialize was reported", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { type: "tools_list_success", permittedCount: 1 },
        { id: "mcp-initialize", negotiatedVersion: "2025-11-25" },
      ],
    });
    const kv = byId(steps, "tools-list").detail.kv;
    expect(kv).toContainEqual(["MCP session", "initialize -> 2025-11-25"]);
  });

  test("a run with no handshake evidence adds no session rows", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ type: "tools_list_success", permittedCount: 1 }],
    });
    const keys = byId(steps, "tools-list").detail.kv.map(([k]) => k);
    expect(keys).not.toContain("MCP session");
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

  // These two replace a pair of tests that required the handshake hops to carry
  // an explanation ("the gateway owns the MCP session") so they never rendered as
  // unexplained grey cards. That intent is preserved by construction now: there
  // is no card to explain. A hop that cannot exist cannot mislead.
  test("no handshake hop is drawn on the gateway path", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-authorize", decision: "PERMIT", tool: "list_orders" }],
    });
    const ids = steps.map((s) => s.id);
    expect(ids).not.toContain("mcp-initialize");
    expect(ids).not.toContain("mcp-initialized");
  });

  test("nor on a run with no gateway evidence at all", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, outcome: "ok", tokenEvents: [] });
    const ids = steps.map((s) => s.id);
    expect(ids).not.toContain("mcp-initialize");
    expect(ids).not.toContain("mcp-initialized");
  });
});
