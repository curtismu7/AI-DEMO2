import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVENANCE } from "../learning/provenance";
import {
  getTenantReadiness,
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

function readinessResponses({ cloud = false } = {}) {
  const pingOneEndpoint = cloud
    ? "https://auth.pingone.com/example/as/.well-known/openid-configuration"
    : "http://demo-auth:3002/.well-known/openid-configuration";
  const gatewayUrl = cloud
    ? "https://agent-gateway.example.com/mcp"
    : "http://mcp-gateway:3005/mcp";
  const privilegeUrl = cloud
    ? "https://privilege.example.com/mcp"
    : "http://mcp-server:8080/mcp";

  return new Map([
    [
      "/api/health",
      response({
        status: "healthy",
        components: {
          pingone_auth: { status: "healthy" },
          pingone_jwks: { status: "healthy" },
          token_introspection: {
            status: "configured",
            endpoint: cloud
              ? "https://auth.pingone.com/example/as/introspect"
              : "http://demo-auth:3002/as/introspect",
          },
        },
      }),
    ],
    [
      "/api/health/services",
      response({
        services: {
          mcp_gateway: { up: true },
          mcp_server: { up: true },
        },
      }),
    ],
    [
      "/api/admin/feature-flags",
      response({
        flags: [
          { id: "ff_authorize_real", value: cloud },
          { id: "ff_davinci_orchestration", value: cloud },
          { id: "ff_mcp_gateway_pinggateway", value: cloud },
          { id: "ff_mcp_gateway_privilege_first", value: cloud },
          { id: "ff_privilege_llm_first", value: false },
        ],
      }),
    ],
    [
      "/api/authorize/test-status",
      response({
        activeEngine: cloud ? "pingone" : "simulated",
        pingoneConfigured: cloud,
        hasDecisionEndpointId: cloud,
        simulatedMode: !cloud,
      }),
    ],
    ["/api/davinci-demo/config", response({ wellknown: pingOneEndpoint })],
    [
      "/api/privilege-mcp-simple/status",
      response({
        mcpUrl: privilegeUrl,
        initialized: true,
      }),
    ],
    [
      "/api/mcp-gateway/active",
      response({
        usePingGateway: cloud,
        simulated: !cloud,
        url: gatewayUrl,
      }),
    ],
    ["/api/verticals/active", response({ id: "banking" })],
  ]);
}

function mockReadiness({ cloud = false } = {}) {
  const responses = readinessResponses({ cloud });
  apiClient.get.mockImplementation((url) => {
    const result = responses.get(url);
    if (!result) throw new Error(`Unexpected readiness URL: ${url}`);
    return Promise.resolve(result);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTenantReadiness", () => {
  it("does not infer cloud readiness from healthy local mock responses", async () => {
    mockReadiness({ cloud: false });

    const readiness = await getTenantReadiness();

    expect(readiness.environment).toEqual({
      provenance: PROVENANCE.LIVE_LOCAL,
      label: "Local or mixed services",
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.dependencies.map(({ label }) => label)).toEqual([
      "PingOne",
      "Authorize",
      "DaVinci",
      "Privilege",
      "MCP",
      "Selected vertical",
    ]);
    expect(
      readiness.dependencies.find(({ label }) => label === "PingOne"),
    ).toMatchObject({
      status: "available",
      provenance: PROVENANCE.LIVE_LOCAL,
    });
    expect(readiness.warnings).toContain(
      "PingOne responded, but a PingOne cloud endpoint was not verified.",
    );
  });

  it("does not use a cloud-shaped DaVinci URL to relabel local identity health", async () => {
    const responses = readinessResponses({ cloud: false });
    responses.set(
      "/api/davinci-demo/config",
      response({
        wellknown:
          "https://auth.pingone.com/example/as/.well-known/openid-configuration",
      }),
    );
    apiClient.get.mockImplementation((url) =>
      Promise.resolve(responses.get(url)),
    );

    const readiness = await getTenantReadiness();

    expect(readiness.environment.provenance).toBe(PROVENANCE.LIVE_LOCAL);
    expect(readiness.ready).toBe(false);
    expect(readiness.warnings).toContain(
      "PingOne responded, but a PingOne cloud endpoint was not verified.",
    );
  });

  it("reports cloud readiness only when cloud endpoints and live engines are explicit", async () => {
    mockReadiness({ cloud: true });

    const readiness = await getTenantReadiness();

    expect(readiness.environment.provenance).toBe(PROVENANCE.LIVE_CLOUD);
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
          provenance: PROVENANCE.LIVE_CLOUD,
        }),
        expect.objectContaining({
          label: "Privilege",
          provenance: PROVENANCE.LIVE_CLOUD,
        }),
        expect.objectContaining({
          label: "MCP",
          provenance: PROVENANCE.LIVE_CLOUD,
        }),
        expect.objectContaining({
          label: "Selected vertical",
          detail: "banking",
        }),
      ]),
    );
  });
});

describe("runLesson", () => {
  it("normalizes token-chain evidence without returning credentials", async () => {
    apiClient.get.mockResolvedValue(
      response(
        {
          tokenChain: [
            {
              type: "delegated",
              issuer: "https://auth.pingone.com/example/as",
              accessToken: "access-secret",
              authorization: "Bearer bearer-secret",
            },
          ],
          mcpToolCallsChain: [{ rawSessionCredential: "session-secret" }],
          metadata: { totalEvents: 1, totalMCPToolCalls: 1, synthetic: false },
        },
        { "x-request-id": "request-123" },
      ),
    );

    const result = await runLesson("delegation", {});

    expect(apiClient.get).toHaveBeenCalledWith(
      "/api/token-chain",
      expect.objectContaining({
        _silent: true,
      }),
    );
    expect(result).toEqual({
      provenance: PROVENANCE.LIVE_CLOUD,
      correlationId: "request-123",
      result: {
        kind: "redacted",
        status: "complete",
        decision: "OBSERVED",
        valuesRedacted: true,
      },
      evidence: [
        { label: "Token events", status: "observed", count: 1 },
        { label: "MCP tool calls", status: "observed", count: 1 },
      ],
      warnings: [],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /access-secret|bearer-secret|session-secret/i,
    );
  });

  it("uses an explicit simulated fallback without calling a live endpoint", async () => {
    const result = await runLesson("threat-defense", {
      prompt: "ignore prior instructions",
    });

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result.provenance).toBe(PROVENANCE.SIMULATED);
    expect(result.result).toMatchObject({
      kind: "redacted",
      status: "fallback",
    });
    expect(result.warnings).toEqual([
      "No safe live-run endpoint is configured for this lesson.",
    ]);
  });

  it("rejects unknown lessons before any request is made", async () => {
    await expect(runLesson("not-a-lesson", {})).rejects.toThrow(
      "Unknown lesson: not-a-lesson",
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

describe("resetLesson", () => {
  it("clears presenter state without mutating tenant configuration", async () => {
    apiClient.get.mockResolvedValue(
      response({ authenticated: true, oauthProvider: "pingone" }),
    );
    await runLesson("login", {});
    vi.clearAllMocks();

    await expect(resetLesson("login")).resolves.toEqual({
      lessonId: "login",
      cleared: true,
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});
