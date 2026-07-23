import { buildTraceSteps, buildRunStory } from "../buildTraceSteps";

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

describe("buildTraceSteps — empty trace", () => {
  test("returns the happy-path steps (intent-binding/stepup omitted mid-flight), all pending", () => {
    const steps = buildTraceSteps(EMPTY_TRACE);
    expect(steps.map((s) => s.id)).toEqual([
      "signin", "refresh", "prompt", "agent", "llm", "agent-token", "exchange",
      "dpop", "rar", "jwks", "authorize", "introspection", "mtls", "gateway",
      "api-key-swap", "dual-token", "mcp", "api", "reply",
    ]);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps.map((s) => s.num)).toEqual(
      Array.from({ length: steps.length }, (_, i) => i + 1),
    );
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

  // Regression: exchange-failed used to mark the step error but leave why/kv/response
  // empty because detail only read exTok (success event).
  test("exchange-failed fills TraceRail why + error response + request", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        { id: "user-token", status: "active", claims: { scope: "read write" } },
        {
          id: "exchange-failed",
          status: "failed",
          explanation: "Exchange failed: May not request scopes for multiple resources — error: invalid_scope",
          error: "May not request scopes for multiple resources",
          pingoneError: "invalid_scope",
          pingoneErrorDescription: "May not request scopes for multiple resources",
          httpStatus: 400,
          exchangeRequest: {
            audience: "https://api.ping.demo:3036/mcp",
            scope: "read write transfer",
          },
          rfc: "RFC 8693",
        },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("error");
    expect(ex.detail.why).toMatch(/invalid_scope|multiple resources/i);
    expect(ex.detail.request.text).toContain("read write transfer");
    expect(ex.detail.response.text).toContain("invalid_scope");
    expect(ex.detail.kv.some(([k, v]) => k === "error" && String(v).includes("invalid_scope"))).toBe(true);
  });

  test("two-ex-final-token with status failed is error not blank done", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        {
          id: "two-ex-final-token",
          status: "failed",
          explanation: "Final hop rejected by PingOne",
          error: "invalid_scope",
          exchangeRequest: { scope: "gateway:mcp:invoke" },
        },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("error");
    expect(ex.detail.why).toMatch(/Final hop rejected|invalid_scope/i);
    expect(ex.detail.response.text).toContain("invalid_scope");
  });

  test("sim-rar-grant lights rar teaching step with authorization_details", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        {
          id: "sim-rar-grant",
          status: "active",
          explanation: "Attested authorization_details cap the transfer at $100.",
          authorization_details: [{ type: "banking_transaction", amount: 100 }],
          rfc: "RFC 9396",
        },
      ],
    });
    const rar = steps.find((s) => s.id === "rar");
    expect(rar.status).toBe("done");
    expect(rar.detail.request.text).toContain("banking_transaction");
    expect(rar.detail.why).toMatch(/\$100|authorization_details/i);
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

  test("gw-authorize alone fills authorize step why + request (no BFF authorize-decision)", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [
        {
          id: "gw-authorize",
          status: "permit",
          decision: "PERMIT",
          tool: "get_my_accounts",
          url: "https://api.pingone.com/v1/.../decisionEndpoints/abc",
          parameters: { ToolName: "get_my_accounts", UserId: "u1" },
          rawResponse: { decision: "PERMIT", id: "dec_1" },
          backend: "real",
        },
      ],
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

  test("HITL_REQUIRED outcome paints challenge banner, not hard DENY", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [{ phase: "authorize_denied", status: 428 }],
      authorize: {
        decision: "INDETERMINATE",
        outcome: "HITL_REQUIRED",
        engine: "pingone",
        decisionContext: "McpFirstTool",
        response: {
          decision: "PERMIT",
          statements: [{ code: "HITL" }, { code: "mcp-tool-authorized" }],
        },
      },
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("active");
    expect(az.detail.decision.outcome).toBe("HITL_REQUIRED");
    expect(az.detail.decision.label).toMatch(/HITL_REQUIRED/);
    expect(az.detail.why).toMatch(/human must approve/i);
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
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "gw-authorize", status: "active",
        decision: "PERMIT", url: "https://gw/authz", statements: [] }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("done");
    expect(gw.detail.kv.some(([k]) => k === "authorize")).toBe(true);
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
    expect(gw.detail.moreDetail).toMatchObject({ edu: "agent-gateway", tab: "overview" });
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
    expect(az.detail.moreDetail).toMatchObject({ href: "/pingone-authorize", label: "Open PingOne Authorize" });
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

  test("gateway with only a skipped-status introspection event leaves gateway notinpath; introspection carries the skip narrative", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{ id: "gw-introspection", status: "skipped",
        explanation: "Gateway introspection skipped (endpoint not configured)" }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    const intro = steps.find((s) => s.id === "introspection");
    expect(gw.status).toBe("notinpath");
    expect(intro.status).toBe("notinpath");
    expect(intro.detail.narrative).toContain("Gateway introspection skipped");
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
        {
          id: "intent-binding-verified",
          label: "Intent Verified (RAR — RFC 9396)",
          status: "active",
          grantedAmount: 100,
          requestedAmount: 50,
        },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("done");
    expect(byId["intent-binding"].detail.kv.find((r) => r[0] === "amount before (granted)")?.[1]).toBe("100");
    expect(byId["intent-binding"].detail.kv.find((r) => r[0] === "amount after (requested)")?.[1]).toBe("50");
    expect(byId["intent-binding"].detail.response?.text).toContain('"before"');
  });

  test("error when a gateway deny carries rar_unexpected_deny or rar_amount_exceeded", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        {
          id: "sim-gateway-deny",
          label: "Gateway DENY (rar_amount_exceeded)",
          status: "error",
          error: "rar_amount_exceeded",
          grantedAmount: 100,
          requestedAmount: 500,
        },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId["intent-binding"].status).toBe("error");
    expect(byId["intent-binding"].detail.kv.find((r) => r[0] === "amount before (granted)")?.[1]).toBe("100");
    expect(byId["intent-binding"].detail.kv.find((r) => r[0] === "amount after (requested)")?.[1]).toBe("500");
    expect(byId["intent-binding"].detail.response?.title).toMatch(/before → after/);
    expect(byId["intent-binding"].detail.response?.text).toContain('"mismatch": true');
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
        presentedScopes: "read", requiredScopes: "write",
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
    expect(byId.gateway.detail.kv.find((r) => r[0] === "scope before")?.[1]).toBe("read");
    expect(byId.gateway.detail.kv.find((r) => r[0] === "scope after (required)")?.[1]).toBe("write");
    expect(byId.gateway.detail.response?.title).toMatch(/Scope check/);
    expect(byId.gateway.detail.response?.text).toContain('"before"');
    expect(byId.mcp.status).toBe("error");
  });

  test("steps the sim never touches resolve notinpath, not pending", () => {
    const steps = buildTraceSteps(SIM_TRACE);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    for (const id of ["agent", "llm", "agent-token", "jwks", "authorize", "introspection", "reply", "api"]) {
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

  test("sim-exchange-error surfaces PingOne detail on the exchange step", () => {
    const explanation =
      "Token exchange failed: Token exchange failed for f4dd707d-f78d-4417-ba56-dc8707d10a1f: " +
      "Not a valid access token for request param 'subject_token'";
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      prompt: { message: "Demo step 10: UC5 — Wrong / insufficient scope" },
      outcome: "error",
      tokenEvents: [
        { id: "user-token", status: "active", claims: { sub: "user-123", scope: "read write" } },
        {
          id: "sim-exchange-error",
          label: "Token Exchange FAILED",
          status: "error",
          error: "invalid_request",
          httpStatus: 400,
          explanation,
          pingoneErrorDescription: "Not a valid access token for request param 'subject_token'",
          requestContext: {
            audience: "https://api.ping.demo:3036/mcp",
            scope: "read",
            client_id: "f4dd707d-f78d-4417-ba56-dc8707d10a1f",
          },
        },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.exchange.status).toBe("error");
    expect(byId.exchange.detail.why).toContain("subject_token");
    expect(byId.exchange.detail.tokenEvent.id).toBe("sim-exchange-error");
    expect(byId.exchange.detail.response.text).toContain("subject_token");
    expect(byId.exchange.detail.kv).toEqual(expect.arrayContaining([
      ["error", "invalid_request"],
      ["http status", "400"],
      ["exchanger client", "f4dd707d-f78d-4417-ba56-dc8707d10a1f"],
      ["requested scope", "read"],
    ]));
    expect(byId.gateway.status).toBe("notinpath");
  });

  test("invalid_aud deny shows aud before/after in kv and response", () => {
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
    const beforeKv = gateway.detail.kv.find((row) => row[0] === "aud before");
    const afterKv = gateway.detail.kv.find((row) => row[0] === "aud after");
    expect(beforeKv?.[1]).toBe("https://api.ping.demo:3001");
    expect(afterKv?.[1]).toBe("https://api.ping.demo:3036/mcp");
    expect(gateway.detail.response?.title).toMatch(/before → after/);
    expect(gateway.detail.response?.text).toContain('"before"');
    expect(gateway.detail.response?.text).toContain("https://api.ping.demo:3001");
    expect(gateway.detail.response?.text).toContain('"after"');
    expect(gateway.detail.response?.text).toContain("https://api.ping.demo:3036/mcp");
    expect(gateway.detail.response?.text).toContain('"mismatch": true');
  });

  test("exchange aud mismatch shows aud before/after", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        {
          id: "exchanged-token",
          status: "active",
          claims: { sub: "u1", aud: "https://wrong.example", scope: "read" },
          audActual: "https://wrong.example",
          audExpected: "https://api.ping.demo:3036/mcp",
          audMatches: false,
        },
      ],
    });
    const exchange = steps.find((s) => s.id === "exchange");
    expect(exchange.status).toBe("done");
    expect(exchange.detail.kv.find((r) => r[0] === "aud before")?.[1]).toBe("https://wrong.example");
    expect(exchange.detail.kv.find((r) => r[0] === "aud after")?.[1]).toBe("https://api.ping.demo:3036/mcp");
    expect(exchange.detail.response?.title).toMatch(/Audience binding/);
    expect(exchange.detail.response?.text).toContain('"mismatch": true');
  });

  test("rogue act shows act before/after on authorize and gateway", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      authorize: {
        decision: "DENY",
        engine: "pingone",
        decisionId: "d-1",
        response: { decision: "DENY", reason: "invalid actor" },
      },
      tokenEvents: [
        {
          id: "sim-rogue-actor",
          status: "active",
          presentedAct: "rogue-agent-9f2a-not-allowlisted",
          allowedAct: "authorized-actor-client",
        },
        {
          id: "sim-gateway-deny",
          status: "error",
          error: "mcp_invalid_actor",
          httpStatus: 403,
          presentedAct: "rogue-agent-9f2a-not-allowlisted",
          allowedAct: "authorized-actor-client",
        },
      ],
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(byId.authorize.status).toBe("error");
    expect(byId.authorize.detail.kv.find((r) => r[0] === "act before")?.[1])
      .toBe("rogue-agent-9f2a-not-allowlisted");
    expect(byId.authorize.detail.kv.find((r) => r[0] === "act after")?.[1])
      .toBe("authorized-actor-client");
    expect(byId.gateway.status).toBe("error");
    expect(byId.gateway.detail.kv.find((r) => r[0] === "act before")?.[1])
      .toBe("rogue-agent-9f2a-not-allowlisted");
    expect(byId.gateway.detail.response?.title).toMatch(/Act claim/);
    expect(byId.gateway.detail.response?.text).toContain("rogue-agent-9f2a-not-allowlisted");
  });
});

describe("buildRunStory — L0 strip", () => {
  test("returns null when the trace is empty", () => {
    expect(buildRunStory(EMPTY_TRACE, [])).toBeNull();
  });

  test("summarizes a successful run with authorize decision", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      prompt: { message: "show my balance" },
      tokenEvents: [
        {
          id: "gw-authorize", status: "permit", decision: "PERMIT",
          tool: "get_my_accounts", parameters: { ToolName: "get_my_accounts" },
          rawResponse: { decision: "PERMIT" }, backend: "real",
        },
      ],
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

describe("buildTraceSteps — PingOne gap fills (introspection / JWKS / signin / MCP deny)", () => {
  test("signin surfaces login introspection request/response when user-token-introspection is present", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
        {
          id: "user-token-introspection", status: "active", rfc: "RFC 7662",
          claims: { sub: "u1", active: true, scope: "read" },
          introspectionResult: { active: true, sub: "u1", scope: "read", exp: 99 },
        },
      ],
    });
    const signin = steps.find((s) => s.id === "signin");
    expect(signin.status).toBe("done");
    expect(signin.detail.why).toMatch(/OIDC login completed/i);
    expect(signin.detail.request.text).toContain("/as/introspect");
    expect(signin.detail.response.text).toContain('"active": true');
  });

  test("introspection step takes gw-introspection evidence out of the gateway composite", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [
        {
          id: "gw-introspection", status: "valid", active: true, sub: "u1",
          scope: "p1:banks:read", rawResponse: { active: true, sub: "u1", scope: "p1:banks:read" },
        },
        { id: "gw-authorize", status: "permit", decision: "PERMIT", tool: "get_balance" },
      ],
    });
    const intro = steps.find((s) => s.id === "introspection");
    const gw = steps.find((s) => s.id === "gateway");
    expect(intro.status).toBe("done");
    expect(intro.detail.response.text).toContain("p1:banks:read");
    expect(intro.detail.why).toMatch(/RFC 7662/i);
    expect(gw.status).toBe("done");
    expect(JSON.stringify(gw.detail.kv || [])).not.toMatch(/introspection/i);
  });

  test("jwks step surfaces exchanged-token-verified evidence", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{
        id: "exchanged-token-verified", status: "active", verified: true,
        fallbackMethod: "jwks", alg: "RS256", kid: "k1",
        claims: { sub: "u1" },
      }],
    });
    const jwks = steps.find((s) => s.id === "jwks");
    expect(jwks.status).toBe("done");
    expect(jwks.detail.why).toMatch(/Signature verified via JWKS/i);
    expect(jwks.detail.response.text).toContain("RS256");
  });

  test("MCP deny path keeps attempted requestJson + error body", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      phases: [{ phase: "gateway_policy_denied", tool: "transfer_money", detail: "audience mismatch" }],
      mcpResult: {
        tool: "transfer_money",
        denied: true,
        requestJson: { jsonrpc: "2.0", method: "tools/call", params: { name: "transfer_money", arguments: { amount: 50 } } },
        result: { error: "gateway_policy_denied", message: "audience mismatch", gatewayErrorCode: "invalid_audience" },
      },
    });
    const mcp = steps.find((s) => s.id === "mcp");
    expect(mcp.status).toBe("error");
    expect(mcp.detail.request.text).toContain("transfer_money");
    expect(mcp.detail.response.text).toContain("invalid_audience");
    expect(mcp.detail.why).toMatch(/never ran/i);
  });

  test("weather TxWeatherScope deny lights gateway step with filter chain detail", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        { id: "user-token", status: "active", claims: { sub: "u1" } },
        { id: "two-ex-final-token", status: "exchanged", claims: { scope: "gateway:mcp:invoke" } },
        {
          id: "gw-filter-chain",
          status: "deny",
          explanation: "Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas",
          denyingFilter: "tx-weather-scope.groovy",
          lastFilter: "TxWeatherScope",
          filterChain: ["McpAudit", "StripWeatherPrefix", "rsFilter", "McpProtocol", "TxWeatherScope"],
          policy: { passed: false, name: "ff_weather_mcp_allowed_state", route: "/mcp/weather" },
          gatewayErrorCode: "weather_scope_denied",
          route: "/mcp/weather",
        },
        {
          id: "gw-mcp-audit",
          status: "deny",
          how: { decision: "DENY", result: "blocked", backend: "weather-mcp" },
          denyingFilter: "tx-weather-scope.groovy",
        },
      ],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("error");
    expect(gw.detail.why).toMatch(/tx-weather-scope|weather scope/i);
    expect(gw.detail.kv.some(([k, v]) => k === "filter / stage" && String(v).includes("tx-weather-scope"))).toBe(true);
    expect(gw.detail.kv.some(([k, v]) => k === "filter chain hops" && String(v).includes("TxWeatherScope"))).toBe(true);
    expect(gw.detail.decision.outcome).toBe("DENY");
  });

  // UC30: exchange/DPoP succeed, third-party weather returns mcp_error — must
  // not leave mcp pending while the run story only quotes successful hops.
  test("mcp_error after successful exchange marks mcp step error with body", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [
        { id: "user-token", status: "active", claims: { sub: "u1" } },
        { id: "two-ex-final-token", status: "exchanged", claims: { scope: "gateway:mcp:invoke" },
          exchangeRequest: { scope: "gateway:mcp:invoke" } },
      ],
      mcpResult: {
        tool: "get_weather",
        status: "error",
        error: "mcp_error",
        result: { error: "mcp_error", message: "❌ mcp_error" },
      },
    });
    const mcp = steps.find((s) => s.id === "mcp");
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("done");
    expect(mcp.status).toBe("error");
    expect(mcp.detail.why).toMatch(/get_weather/);
    expect(mcp.detail.why).toMatch(/mcp_error/);
    expect(mcp.detail.response.text).toContain("mcp_error");
    const story = buildRunStory({ ...EMPTY_TRACE, outcome: "error", prompt: { message: "weather" } }, steps);
    expect(story.headline).toMatch(/MCP|mcp/i);
    expect(story.bits[0]).toMatch(/get_weather|mcp_error/i);
  });
});

describe("buildTraceSteps — E1 authorize statements + dual evidence", () => {
  test("authorize surfaces statement codes from gw-authorize on DENY", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      tokenEvents: [{
        id: "gw-authorize", status: "deny", decision: "DENY",
        statements: [{ code: "mcp.transfer.deny", effect: "deny" }],
        reason: "amount over limit",
        parameters: { ToolName: "transfer_money" },
        rawResponse: { decision: "DENY", statements: [{ code: "mcp.transfer.deny" }] },
      }],
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.status).toBe("error");
    expect(az.detail.why).toMatch(/mcp\.transfer\.deny/);
    expect(az.detail.kv.some(([k, v]) => k === "statements" && String(v).includes("mcp.transfer.deny"))).toBe(true);
    expect(az.detail.response.text).toContain("mcp.transfer.deny");
  });

  test("BFF + gw-authorize both present keeps BFF request and alt gateway evidence", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      authorize: {
        engine: "pingone", decision: "PERMIT", decisionId: "bff-1",
        request: { method: "POST", url: "https://bff/authorize", parameters: { ToolName: "get_balance" } },
        response: { decision: "PERMIT" },
      },
      tokenEvents: [{
        id: "gw-authorize", status: "permit", decision: "PERMIT",
        url: "https://gw/p1az", parameters: { ToolName: "get_balance", Via: "gateway" },
        rawResponse: { decision: "PERMIT", id: "gw-dec" },
      }],
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.detail.request.text).toContain("https://bff/authorize");
    expect(az.detail.altRequest.title).toMatch(/Gateway Authorize/i);
    expect(az.detail.altRequest.text).toContain("Via");
    expect(az.detail.altResponse.text).toContain("gw-dec");
    expect(az.detail.why).toMatch(/Gateway Authorize evidence is also present/i);
    expect(az.detail.kv.some(([k]) => k === "gateway authorize")).toBe(true);
  });
});

describe("buildTraceSteps — E3 MCP success response", () => {
  test("mcp done step includes JSON-RPC request and tool result response", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      mcpResult: {
        tool: "get_balance",
        durationMs: 42,
        requestJson: { jsonrpc: "2.0", method: "tools/call", params: { name: "get_balance", arguments: {} } },
        result: { content: [{ type: "text", text: "{\"balance\":100}" }] },
      },
    });
    const mcp = steps.find((s) => s.id === "mcp");
    expect(mcp.status).toBe("done");
    expect(mcp.detail.request.text).toContain("get_balance");
    expect(mcp.detail.response.text).toContain("balance");
  });
});

describe("buildTraceSteps — E4 resource-server step", () => {
  test("resource-server-reply marks api done with tool/duration kv", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "ok",
      tokenEvents: [{
        id: "resource-server-reply", status: "success",
        toolName: "get_balance", durationMs: 17, routedVia: "gateway",
        resultSummary: "balance ok", resultStatus: "success",
      }],
      mcpResult: {
        tool: "get_balance",
        requestJson: { jsonrpc: "2.0", method: "tools/call", params: { name: "get_balance", arguments: { account: "a1" } } },
        result: { balance: 100 },
      },
    });
    const api = steps.find((s) => s.id === "api");
    expect(api.status).toBe("done");
    expect(api.detail.why).toMatch(/get_balance/);
    expect(api.detail.kv.some(([k, v]) => k === "duration" && String(v).includes("17"))).toBe(true);
    expect(api.detail.request.title).toMatch(/banking API/i);
    expect(api.detail.request.text).toContain("get_balance");
    expect(api.detail.response.title).toMatch(/Resource/i);
  });
});

describe("buildTraceSteps — E2a gateway filter/rule teaching", () => {
  test("gateway surfaces statements, reason, mcpAudit, and denyingFilter when present", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      outcome: "error",
      phases: [{ phase: "gateway_policy_denied", detail: "policy deny", gatewayErrorCode: "access_denied" }],
      tokenEvents: [
        {
          id: "gw-authorize", status: "deny", decision: "DENY",
          denyingFilter: "P1AZDecision",
          reason: "over limit",
          backend: "real",
          statements: [{ code: "mcp.amount.cap" }],
          parameters: { ToolName: "transfer_money" },
          rawResponse: { decision: "DENY" },
        },
        {
          id: "gw-mcp-audit", status: "deny",
          how: { decision: "DENY", result: "blocked", backend: "real" },
          who: { userSub: "u1" }, what: { tool: "transfer_money", mcpMethod: "tools/call" },
          mcpAudit: { how: { decision: "DENY", result: "blocked" }, who: { userSub: "u1" }, what: { tool: "transfer_money" } },
        },
      ],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("error");
    expect(gw.detail.why).toMatch(/P1AZDecision/);
    expect(gw.detail.why).toMatch(/mcp\.amount\.cap/);
    expect(gw.detail.kv.some(([k, v]) => k === "filter / stage" && v === "P1AZDecision")).toBe(true);
    expect(gw.detail.kv.some(([k]) => k === "rule / statement")).toBe(true);
    expect(gw.detail.altResponse.title).toMatch(/McpAuditFilter/i);
  });
});

describe("buildTraceSteps — deep digs (refresh/dpop/rar/mtls/dual/UC/RS)", () => {
  test("token-refresh lights refresh step", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{ id: "token-refresh", status: "active", rfc: "RFC 6749 §6",
        claims: { sub: "u1", scope: "openid" }, refreshedAt: "2026-07-22T12:00:00Z" }],
    });
    const refresh = steps.find((s) => s.id === "refresh");
    expect(refresh.status).toBe("done");
    expect(refresh.detail.why).toMatch(/silently refreshed/i);
    expect(refresh.detail.rfcs).toContain("RFC 6749 §6");
  });

  test("dpop-binding and rar-authorization are first-class hops after exchange", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "exchanged-token", status: "active", claims: { scope: "write", act: { sub: "a1" } } },
        { id: "dpop-binding", status: "active", cnf: { jkt: "thumb-abc" }, rfc: "RFC 9449" },
        { id: "rar-authorization", status: "active", authorization_details: [{ type: "transfer", amount: 100 }], rfc: "RFC 9396" },
      ],
    });
    const ids = steps.map((s) => s.id);
    expect(ids.indexOf("dpop")).toBeGreaterThan(ids.indexOf("exchange"));
    expect(ids.indexOf("rar")).toBeGreaterThan(ids.indexOf("dpop"));
    expect(steps.find((s) => s.id === "dpop").detail.kv.some(([k, v]) => k === "cnf.jkt" && v === "thumb-abc")).toBe(true);
    expect(steps.find((s) => s.id === "rar").detail.request.text).toContain("transfer");
  });

  test("two-exchange shows hop #1 as altRequest/altResponse", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "two-ex-exchange1", status: "active",
          claims: { scope: "agent", act: { sub: "a1" } },
          exchangeRequest: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", scope: "agent" } },
        { id: "two-ex-final-token", status: "active",
          claims: { scope: "write", act: { sub: "a1", act: { sub: "upstream" } } },
          exchangeRequest: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", scope: "write" } },
      ],
    });
    const ex = steps.find((s) => s.id === "exchange");
    expect(ex.status).toBe("done");
    expect(ex.detail.why).toMatch(/Two-exchange/i);
    expect(ex.detail.altRequest.text).toContain("agent");
    expect(ex.detail.altResponse.text).toContain("act");
    expect(ex.detail.kv.some(([k, v]) => k === "mode" && v === "2-exchange")).toBe(true);
  });

  test("HITL phase enriches stepup with challenge why/kv", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      phases: [
        { phase: "authorize_denied_hitl", label: "HITL required", challenge_type: "consent" },
        { phase: "gateway_hitl_required", label: "Gateway HITL" },
      ],
      mcpResult: {
        result: { error: "hitl_required", challengeId: "chal-9", hitl_threshold_usd: 250, hitl: { type: "consent" } },
      },
    });
    const su = steps.find((s) => s.id === "stepup");
    expect(su.status).toBe("active");
    expect(su.detail.why).toMatch(/Human-in-the-loop/i);
    expect(su.detail.kv.some(([k, v]) => k === "challenge id" && v === "chal-9")).toBe(true);
    expect(su.detail.request.text).toContain("chal-9");
  });

  test("gw-mtls is its own step; dual_token path lights dual-token", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [
        { id: "gw-mtls", status: "active", subject: "banking-mcp-gateway", mtlsEnabled: true,
          label: "mTLS verified", explanation: "Gateway → MCP mTLS verified." },
        { id: "evt-idtoken-fetch", credentialPath: "dual_token", status: "ok",
          label: "id_token fetched from BFF" },
        { id: "gw-passthrough", credentialPath: "dual_token", status: "ok",
          label: "TX token forwarded unchanged" },
      ],
      mcpResult: { _meta: { credentialPath: "dual_token", backendRoute: "/api/resource-server/identity",
        idTokenAttached: true, accessTokenAttached: true }, result: { ok: true } },
    });
    const mtls = steps.find((s) => s.id === "mtls");
    const dual = steps.find((s) => s.id === "dual-token");
    expect(mtls.status).toBe("done");
    expect(mtls.detail.kv.some(([k]) => k === "cert subject")).toBe(true);
    expect(dual.status).toBe("done");
    expect(dual.detail.why).toMatch(/Dual-token/i);
  });

  test("api prefers _meta.resourceRequest over tool-arg teaching", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      mcpResult: {
        tool: "show_invest",
        requestJson: { params: { name: "show_invest" } },
        result: { portfolio: 1 },
        _meta: {
          credentialPath: "api_key",
          apiCall: "GET /invest",
          resourceRequest: { method: "GET", path: "/invest", headers: { "X-API-Key": "••••0000" } },
        },
      },
      tokenEvents: [
        { id: "evt-swap", credentialPath: "api_key", status: "ok", label: "swap" },
        { id: "evt-backend", credentialPath: "api_key", status: "ok", label: "outbound" },
      ],
    });
    const api = steps.find((s) => s.id === "api");
    expect(api.status).toBe("done");
    expect(api.detail.request.title).toMatch(/HTTP/);
    expect(api.detail.request.text).toContain("/invest");
    expect(api.detail.why).toMatch(/Resource server HTTP/i);
  });

  test("useCaseId appends UC_WHY tip onto authorize why", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      authorize: {
        decision: "DENY", engine: "real", decisionId: "d1",
        request: { parameters: { ToolName: "x" } },
        response: { decision: "DENY" },
      },
      phases: [{ phase: "authorize_denied" }],
      tokenEvents: [{ id: "authorize-decision", useCaseId: "authz-denied", authorizeDecision: "DENY" }],
      outcome: "error",
    });
    const az = steps.find((s) => s.id === "authorize");
    expect(az.detail.why).toMatch(/\[authz-denied\]/);
    expect(az.detail.why).toMatch(/Expect PingOne Authorize DENY/);
  });

  test("gateway shows full filterChain on success as altResponse", () => {
    const steps = buildTraceSteps({
      ...EMPTY_TRACE,
      tokenEvents: [{
        id: "gw-authorize", status: "permit", decision: "PERMIT",
        lastFilter: "BackendExchange",
        filterChain: [
          { filter: "TokenIntrospection", result: "passed" },
          { filter: "GatewayTokenPolicy", result: "passed" },
          { filter: "P1AZDecision", result: "forwarded", decision: "PERMIT" },
          { filter: "mTLS", result: "skipped" },
          { filter: "BackendExchange", result: "forwarded" },
        ],
        parameters: { ToolName: "get_my_accounts" },
        rawResponse: { decision: "PERMIT" },
      }],
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("done");
    expect(gw.detail.why).toMatch(/BackendExchange/);
    expect(gw.detail.altResponse.title).toMatch(/Filter chain/i);
    expect(gw.detail.altResponse.text).toContain("TokenIntrospection");
    expect(gw.detail.kv.some(([k, v]) => k === "filter chain hops" && v === "5")).toBe(true);
  });
});
