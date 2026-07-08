import { buildTraceSteps } from "../buildTraceSteps";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — empty trace", () => {
  test("returns the 11 happy-path steps, all pending", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    expect(steps.map((s) => s.id)).toEqual([
      "signin", "prompt", "agent", "llm", "agent-token", "exchange",
      "authorize", "gateway", "mcp", "api", "reply",
    ]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps.map((s) => s.num)).toEqual([1,2,3,4,5,6,7,8,9,10,11]);
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
    expect(ex.detail.request.text).toContain("token-exchange");
    expect(ex.detail.inspectToken).toBe("mcp");
    expect(ex.detail.rfcs).toContain("RFC 8693");
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
      label: "PERMIT — pingone (McpFirstTool)" });
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

  test("authorize_denied phase renders authorize step as error", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", label: "Authorize denied", detail: "" }],
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
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", status: "active",
        decision: "PERMIT", url: "https://gw/authz", statements: [] }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("done");
    expect(gw.detail.kv.some(([k]) => k === "authorize")).toBe(true);
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
        { id: 'evt-swap', tokenType: 'api_key', maskedValue: '...0000', status: 'ok' },
        { id: 'evt-backend', tokenType: 'api_key', status: 'ok' },
      ],
      mcpResult: { _meta: { credentialPath: 'api_key', apiKeyMaskedLast4: '0000', apiCall: 'GET /invest' } },
    };
    const step = buildTraceSteps(trace).find((s) => s.id === 'api');
    expect(step.status).toBe('done');
    const flat = JSON.stringify(step.detail);
    expect(flat).toContain('GET /invest');
    expect(flat).toContain('0000');
  });
});
