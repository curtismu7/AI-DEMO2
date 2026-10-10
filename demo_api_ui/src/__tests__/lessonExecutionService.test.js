import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVENANCE } from "../learning/provenance";
import {
  canObserveLesson,
  getTenantReadiness,
  isObservationActionSupported,
  resetLesson,
  runLesson,
} from "../services/lessonExecutionService";

const { apiClient } = vi.hoisted(() => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../services/apiClient", () => ({ default: apiClient }));

const response = (data, headers = {}) => ({ data, headers });

const readinessUrls = Object.freeze({
  identity: "/api/health/introspection",
  credentials: "/api/health/readiness",
  flags: "/api/admin/feature-flags",
  authorize: "/api/authorize/policy-readiness",
  davinci: "/api/davinci-demo/config",
  privilege: "/api/privilege-mcp-simple/status",
  mcpGateway: "/api/health/mcp-gateway",
  mcpServer: "/api/health/mcp-server",
  gatewayConfig: "/api/mcp-gateway/active",
  vertical: "/api/verticals/active",
});

function readinessResponses({ cloud = false, enabled = false } = {}) {
  return new Map([
    [
      readinessUrls.identity,
      cloud
        ? response({
            status: "connected",
            endpoint: "https://auth.pingone.com/example/as/introspect",
            details: { httpStatus: 200, responseTime: 25 },
          })
        : response({
            status: "not_configured",
            endpoint: "https://auth.pingone.com/example/as/introspect",
          }),
    ],
    [
      readinessUrls.credentials,
      response({ configured: true, userOAuthConfigured: true }),
    ],
    [
      readinessUrls.flags,
      response({
        flags: [
          { id: "ff_authorize_real", value: cloud },
          { id: "ff_davinci_orchestration", value: enabled },
          { id: "ff_mcp_gateway_privilege_first", value: enabled },
          { id: "ff_privilege_llm_first", value: false },
        ],
      }),
    ],
    [
      readinessUrls.authorize,
      cloud
        ? response({
            readiness: "ready",
            gates: [{ gate: "Transaction decision endpoint", status: "ready" }],
          })
        : response({
            readiness: "skipped",
            reason: "worker_creds_missing",
            gates: [],
          }),
    ],
    [
      readinessUrls.davinci,
      response({
        wellknown: enabled
          ? "https://auth.pingone.com/example/as/.well-known/openid-configuration"
          : "https://auth.example.com/.well-known/openid-configuration",
      }),
    ],
    [
      readinessUrls.privilege,
      response({
        mcpUrl: "https://privilege.example.com/mcp",
        initialized: enabled,
      }),
    ],
    [readinessUrls.mcpGateway, response({ ok: true, httpStatus: 200 })],
    [readinessUrls.mcpServer, response({ ok: true })],
    [
      readinessUrls.gatewayConfig,
      response({
        usePingGateway: true,
        name: "PingOne Agent Gateway",
        url: "https://agent-gateway.example.com/mcp",
      }),
    ],
    [readinessUrls.vertical, response({ id: "banking" })],
  ]);
}

function useResponses(responses) {
  apiClient.get.mockImplementation((url) => {
    const value = responses.get(url);
    if (value instanceof Error) return Promise.reject(value);
    if (!value) throw new Error(`Unexpected URL: ${url}`);
    return Promise.resolve(value);
  });
}

function dependency(readiness, label) {
  return readiness.dependencies.find((item) => item.label === label);
}

function credentialKeys(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => credentialKeys(entry, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      if (
        /^(accessToken|refreshToken|authorization|bearer|clientSecret|sessionCredential)$/i.test(
          key,
        )
      ) {
        found.push(key);
      }
      credentialKeys(entry, found);
    });
  }
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTenantReadiness", () => {
  it("does not promote local auth/JWKS plus configured cloud-shaped introspection", async () => {
    const responses = readinessResponses({ cloud: false });
    responses.set(
      "/api/health",
      response({
        components: {
          pingone_auth: { status: "healthy" },
          pingone_jwks: { status: "healthy" },
          token_introspection: {
            status: "configured",
            endpoint: "https://auth.pingone.com/example/as/introspect",
          },
        },
      }),
    );
    useResponses(responses);

    const readiness = await getTenantReadiness();

    expect(readiness.environment).toEqual({
      provenance: PROVENANCE.LIVE_LOCAL,
      label: "Local or configured services",
    });
    expect(readiness.ready).toBe(false);
    expect(dependency(readiness, "PingOne")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
    expect(apiClient.get).not.toHaveBeenCalledWith(
      "/api/health",
      expect.anything(),
    );
  });

  it("does not treat non-Ping remote URLs as cloud provenance", async () => {
    const responses = readinessResponses({ cloud: true, enabled: true });
    responses.set(
      readinessUrls.davinci,
      response({
        wellknown:
          "https://identity.example.net/.well-known/openid-configuration",
      }),
    );
    responses.set(
      readinessUrls.privilege,
      response({
        mcpUrl: "https://gateway.example.net/mcp",
        initialized: true,
      }),
    );
    useResponses(responses);

    const readiness = await getTenantReadiness();

    expect(dependency(readiness, "DaVinci").provenance).toBe(
      PROVENANCE.RECORDED,
    );
    expect(dependency(readiness, "Privilege").provenance).toBe(
      PROVENANCE.LIVE_LOCAL,
    );
    expect(dependency(readiness, "MCP").provenance).toBe(PROVENANCE.LIVE_LOCAL);
    expect(readiness.ready).toBe(false);
  });

  it("keeps uninitialized Privilege and config-only DaVinci or MCP non-live", async () => {
    const responses = readinessResponses({ cloud: true, enabled: true });
    responses.set(
      readinessUrls.privilege,
      response({
        mcpUrl: "https://privilege.example.com/mcp",
        initialized: false,
      }),
    );
    responses.set(readinessUrls.mcpGateway, new Error("gateway unavailable"));
    responses.set(readinessUrls.mcpServer, new Error("server unavailable"));
    useResponses(responses);

    const readiness = await getTenantReadiness();

    expect(dependency(readiness, "DaVinci")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
    expect(dependency(readiness, "Privilege")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
    expect(dependency(readiness, "MCP")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
    expect(readiness.ready).toBe(false);
  });

  it("reports ready only from authoritative cloud checks plus live local MCP", async () => {
    useResponses(readinessResponses({ cloud: true, enabled: false }));

    const readiness = await getTenantReadiness();

    expect(readiness.environment).toEqual({
      provenance: PROVENANCE.LIVE_CLOUD,
      label: "Verified cloud services with local dependencies",
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readiness.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "PingOne",
          provenance: PROVENANCE.LIVE_CLOUD,
        }),
        expect.objectContaining({
          label: "Authorize",
          provenance: PROVENANCE.LIVE_CLOUD,
        }),
        expect.objectContaining({
          label: "DaVinci",
          provenance: PROVENANCE.RECORDED,
        }),
        expect.objectContaining({
          label: "Privilege",
          provenance: PROVENANCE.RECORDED,
        }),
        expect.objectContaining({
          label: "MCP",
          provenance: PROVENANCE.LIVE_LOCAL,
        }),
        expect.objectContaining({
          label: "Selected vertical",
          detail: "banking",
        }),
      ]),
    );
  });

  it("does not mark MCP executable when only the downstream server is healthy", async () => {
    const responses = readinessResponses({ cloud: false });
    responses.set(readinessUrls.mcpGateway, new Error("gateway unavailable"));
    useResponses(responses);

    const readiness = await getTenantReadiness();

    expect(dependency(readiness, "MCP")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
  });

  it.each([400, 403, 404, 429])(
    "rejects connected introspection health with upstream HTTP %i",
    async (httpStatus) => {
      const responses = readinessResponses({ cloud: true, enabled: false });
      responses.set(
        readinessUrls.identity,
        response({
          status: "connected",
          endpoint: "https://auth.pingone.com/example/as/introspect",
          details: { httpStatus, responseTime: 25 },
        }),
      );
      useResponses(responses);

      const readiness = await getTenantReadiness();

      expect(readiness.ready).toBe(false);
      expect(readiness.environment.provenance).toBe(PROVENANCE.LIVE_LOCAL);
      expect(dependency(readiness, "PingOne")).toMatchObject({
        status: "configured",
        provenance: PROVENANCE.RECORDED,
      });
    },
  );

  it("rejects connected introspection health over plain HTTP", async () => {
    const responses = readinessResponses({ cloud: true, enabled: false });
    responses.set(
      readinessUrls.identity,
      response({
        status: "connected",
        endpoint: "http://auth.pingone.com/example/as/introspect",
        details: { httpStatus: 200, responseTime: 25 },
      }),
    );
    useResponses(responses);

    const readiness = await getTenantReadiness();

    expect(readiness.ready).toBe(false);
    expect(dependency(readiness, "PingOne")).toMatchObject({
      status: "configured",
      provenance: PROVENANCE.RECORDED,
    });
  });
});

describe("runLesson observations", () => {
  const cases = [
    {
      lessonId: "login",
      action: "login",
      endpoint: "/api/auth/oauth/user/status",
      data: { authenticated: true, oauthProvider: "pingone" },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "delegation",
      action: "token-exchange",
      endpoint: "/api/token-chain",
      data: {
        tokenChain: [{ type: "delegated" }],
        mcpToolCallsChain: [],
        metadata: {
          totalEvents: 1,
          totalMCPToolCalls: 0,
          totalsScope: "session_accumulated",
          synthetic: false,
        },
      },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "mcp",
      action: "mcp-discovery",
      endpoint: "/api/admin/mcp-discovery/inventory",
      data: {
        records: [{ id: "mcp-1", status: "healthy", source: "remote-url" }],
      },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "authorize",
      action: "authorize-decision",
      endpoint: "/api/authorize/pingone-live-policy",
      data: {
        activeEngine: "pingone",
        recentDecisions: [{ decision: "DENY" }],
      },
      provenance: PROVENANCE.LIVE_CLOUD,
    },
    {
      lessonId: "hitl-step-up",
      action: "hitl-step-up",
      endpoint: "/api/token-chain",
      data: {
        tokenChain: [{ id: "ciba-poll", grantedVia: "ciba", eventType: "auth" }],
        mcpToolCallsChain: [],
      },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "lifecycle",
      action: "agent-lifecycle",
      endpoint: "/api/agent/identity/status",
      data: { agentMapping: { id: "mapping-1" }, actorMcpEnabled: true },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "ai-architecture",
      action: "ai-architecture",
      endpoint: "/api/health/services",
      data: { services: { mcp_gateway: { up: true } } },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "product-map",
      action: "privilege-status",
      endpoint: "/api/privilege-mcp-simple/status",
      data: { initialized: true, tokenCached: false },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "login",
      action: "davinci-session-status",
      endpoint: "/api/davinci-login/session-status",
      data: { davinciWidgetLogin: true, needsRefresh: false },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
    {
      lessonId: "lifecycle",
      action: "audit-evidence",
      endpoint: "/api/token-chain",
      data: {
        tokenChain: [
          { eventType: "auth", id: "auth-1" },
          { eventType: "exchange", id: "authorize-decision", authorizeDecision: "DENY" },
        ],
        mcpToolCallsChain: [{ tool: "get_balance" }],
      },
      provenance: PROVENANCE.LIVE_LOCAL,
    },
  ];

  it.each(cases)(
    "labels $lessonId ambient GET evidence as an observation",
    async ({ lessonId, action, endpoint, data, provenance }) => {
      apiClient.get.mockResolvedValue(response(data));

      const observed = await runLesson(lessonId, {
        action,
      });

      expect(apiClient.get).toHaveBeenCalledWith(endpoint, expect.any(Object));
      expect(observed.provenance).toBe(provenance);
      expect(observed.correlationId).toBeNull();
      expect(observed.result).toMatchObject({
        kind: "observation",
        status: "observed",
        valuesRedacted: true,
      });
      expect(observed.result.status).not.toBe("complete");
      expect(observed.warnings).toContain(
        "Read-only snapshot; no lesson action was executed.",
      );
    },
  );

  it("exposes only actions and lessons backed by direct observation mappings", () => {
    expect(isObservationActionSupported("token-exchange")).toBe(true);
    expect(isObservationActionSupported("mcp-discovery")).toBe(true);
    expect(isObservationActionSupported("privilege-status")).toBe(true);
    expect(isObservationActionSupported("davinci-session-status")).toBe(true);
    expect(isObservationActionSupported("audit-evidence")).toBe(true);
    expect(isObservationActionSupported("threat-defense")).toBe(false);
    expect(isObservationActionSupported("product-map")).toBe(false);
    expect(canObserveLesson("delegation")).toBe(true);
    expect(canObserveLesson("threat-defense")).toBe(true);
    expect(canObserveLesson("multi-party-delegation")).toBe(true);
    expect(canObserveLesson("product-map")).toBe(false);
    expect(canObserveLesson("product-map", "privilege-status")).toBe(true);
    expect(canObserveLesson("login", "davinci-session-status")).toBe(true);
    expect(canObserveLesson("lifecycle", "audit-evidence")).toBe(true);
    expect(canObserveLesson("threat-defense", "audit-evidence")).toBe(true);
    expect(canObserveLesson("multi-party-delegation", "authorize-decision")).toBe(true);
  });

  it("normalizes nested PingOne denials and CIBA/audit token-chain evidence", async () => {
    apiClient.get
      .mockResolvedValueOnce(
        response({
          activeEngine: "pingone",
          recentDecisions: [{ decisionResponse: { decision: "DENY" } }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          tokenChain: [{ id: "ciba-poll", grantedVia: "ciba", eventType: "auth" }],
          mcpToolCallsChain: [],
        }),
      )
      .mockResolvedValueOnce(
        response({
          tokenChain: [
            { eventType: "auth", id: "auth-1" },
            { eventType: "exchange", id: "authorize-decision", authorizeDecision: "DENY" },
          ],
          mcpToolCallsChain: [{ tool: "get_balance" }],
        }),
      );

    const denial = await runLesson("authorize", { action: "authorize-decision" });
    const ciba = await runLesson("hitl-step-up", { action: "hitl-step-up" });
    const audit = await runLesson("lifecycle", { action: "audit-evidence" });

    expect(denial.evidence).toContainEqual({
      label: "DENY decisions",
      status: "observed",
      count: 1,
    });
    expect(ciba.evidence).toContainEqual({
      label: "CIBA approval events",
      status: "observed",
      count: 1,
    });
    expect(audit.evidence).toEqual([
      { label: "Token-chain events", status: "observed", count: 2 },
      { label: "Identity lifecycle events", status: "observed", count: 2 },
      { label: "Policy decision records", status: "observed", count: 1 },
      { label: "MCP tool-call records", status: "observed", count: 1 },
    ]);
  });

  it("executes the bounded MCP read demo through the BFF", async () => {
    apiClient.post.mockResolvedValueOnce(
      response({
        result: { content: [{ type: "text", text: "accounts returned" }] },
        correlationId: "mcp-demo-1",
      }),
    );

    const result = await runLesson("mcp");

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/mcp/tool",
      { tool: "get_my_accounts", params: {} },
      expect.objectContaining({ _silent: true }),
    );
    expect(result.result).toMatchObject({ status: "observed", decision: "EXECUTED" });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Banking read tool", count: 1 }),
      ]),
    );
  });

  it("does not claim a failed MCP response was executed", async () => {
    apiClient.post.mockResolvedValueOnce(
      response({ error: "tool_denied", ok: false }),
    );

    const result = await runLesson("mcp");

    expect(result.result).toMatchObject({ status: "no-evidence", decision: "NO_EVIDENCE" });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Banking read tool", count: 0 }),
      ]),
    );
  });

  it("executes the policy-only demo without calling the protected tool", async () => {
    apiClient.post.mockResolvedValueOnce(
      response({ decision: "DENY", engine: "simulated", correlationId: "policy-demo-1" }),
    );

    const result = await runLesson("authorize");

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/authorize/test-evaluate-mcp",
      { toolName: "get_my_accounts", tokenScopes: "read" },
      expect.objectContaining({ _silent: true }),
    );
    expect(result.result).toMatchObject({ status: "observed", decision: "EXECUTED" });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Policy decision", count: 1 }),
      ]),
    );
  });

  it("does not treat unrelated token-chain history as CIBA approval evidence", async () => {
    apiClient.get.mockResolvedValue(
      response({
        tokenChain: [{ id: "auth-1", eventType: "auth" }],
        mcpToolCallsChain: [],
      }),
    );

    const observed = await runLesson("hitl-step-up", { action: "hitl-step-up" });

    expect(observed.result).toMatchObject({
      status: "no-evidence",
      decision: "NO_EVIDENCE",
    });
    expect(observed.provenance).toBeNull();
    expect(observed.evidence).toContainEqual({
      label: "CIBA approval events",
      status: "not-observed",
      count: 0,
    });
  });

  it("rejects a scenario action that does not match the lesson evidence mapping", async () => {
    const observed = await runLesson("delegation", {
      action: "mcp-discovery",
    });

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(observed).toMatchObject({
      provenance: null,
      result: { status: "not-run" },
      evidence: [],
    });
  });

  it("does not report an empty cumulative token-chain snapshot as complete", async () => {
    apiClient.get.mockResolvedValue(
      response({
        tokenChain: [],
        mcpToolCallsChain: [],
        metadata: {
          totalEvents: 0,
          totalMCPToolCalls: 0,
          totalsScope: "session_accumulated",
          synthetic: false,
        },
      }),
    );

    const observed = await runLesson("delegation", {});

    expect(observed.result).toMatchObject({
      kind: "observation",
      status: "no-evidence",
    });
    expect(observed.provenance).toBeNull();
    expect(observed.evidence.every((entry) => entry.count === 0)).toBe(true);
    expect(observed.warnings).toContain("No lesson evidence was observed.");
    expect(observed.warnings).toContain(
      "Evidence is cumulative session history, not this lesson invocation.",
    );
  });

  it("labels bounded observations so a readiness snapshot is not presented as an action result", async () => {
    apiClient.get.mockResolvedValue(
      response({ initialized: true, tokenCached: false }),
    );

    const observed = await runLesson("product-map", {
      action: "privilege-status",
    });

    expect(observed.result).toMatchObject({ status: "observed" });
    expect(observed.evidence).toEqual([
      { label: "Privilege relay initialized", status: "observed", count: 1 },
      { label: "Brokered token cached", status: "not-observed", count: 0 },
    ]);
    expect(observed.warnings).toContain(
      "Relay readiness is bounded evidence; no privileged tool call was executed.",
    );
  });

  it("preserves a returned correlation ID but never invents one", async () => {
    apiClient.get
      .mockResolvedValueOnce(response({ authenticated: true }))
      .mockResolvedValueOnce(
        response({ authenticated: true }, { "x-request-id": "request-123" }),
      );

    const withoutId = await runLesson("login", {});
    const withId = await runLesson("login", {});

    expect(withoutId.correlationId).toBeNull();
    expect(withId.correlationId).toBe("request-123");
  });

  it("returns only normalized fields with no credential keys", async () => {
    apiClient.get.mockResolvedValue(
      response({
        tokenChain: [{ type: "delegated", status: "active" }],
        mcpToolCallsChain: [],
        metadata: {
          totalEvents: 1,
          totalMCPToolCalls: 0,
          totalsScope: "session_accumulated",
          synthetic: false,
        },
      }),
    );

    const observed = await runLesson("delegation", {});

    expect(credentialKeys(observed)).toEqual([]);
  });

  it("returns provenance-free not-run when no safe live endpoint exists", async () => {
    // threat-defense now observes through the audit evidence, so the not-run
    // specimen is a real lesson asked for an unsupported observation action.
    const observed = await runLesson("delegation", { action: "login" });

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(observed).toMatchObject({
      provenance: null,
      correlationId: null,
      result: { kind: "observation", status: "not-run" },
      evidence: [],
    });
  });

  it("returns provenance-free unavailable when an observation endpoint fails", async () => {
    apiClient.get.mockRejectedValue(new Error("endpoint failed"));

    const observed = await runLesson("login", {});

    expect(observed).toMatchObject({
      provenance: null,
      correlationId: null,
      result: { kind: "observation", status: "unavailable" },
      evidence: [],
    });
    expect(observed.warnings).toContain(
      "Observation endpoint unavailable; Recorded login trace was not executed.",
    );
  });
});

describe("resetLesson", () => {
  it("is a pure reset contract with no hidden state or tenant mutation", async () => {
    const before = await resetLesson("login");
    apiClient.get.mockResolvedValue(response({ authenticated: true }));
    await runLesson("login", {});
    const after = await resetLesson("login");

    expect(before).toEqual({
      lessonId: "login",
      cleared: true,
      tenantMutated: false,
    });
    expect(after).toEqual(before);
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});
