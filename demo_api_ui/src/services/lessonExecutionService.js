import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import apiClient from "./apiClient";

const READINESS_ENDPOINTS = Object.freeze({
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

const OBSERVATION_ENDPOINTS = Object.freeze({
  login: "/api/auth/oauth/user/status",
  "token-exchange": "/api/token-chain",
  "mcp-discovery": "/api/admin/mcp-discovery/inventory",
  "authorize-decision": "/api/authorize/test-status",
  "hitl-step-up": "/api/app-events?category=authorize&limit=10",
  "agent-lifecycle": "/api/agent/identity/status",
  "ai-architecture": "/api/health/services",
});

const silentRead = Object.freeze({ _silent: true, _noAuthBanner: true });
const SNAPSHOT_WARNING = "Read-only snapshot; no lesson action was executed.";

function flagValue(flags, id) {
  const value = flags.find((flag) => flag?.id === id)?.value;
  return value === true || value === "true";
}

function isPingOneCloudEndpoint(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      /^auth\.pingone\.(com|eu|asia|ca|com\.au)$/.test(hostname)
    );
  } catch {
    return false;
  }
}

function dependency(id, label, status, provenance, detail) {
  return { id, label, status, provenance, detail };
}

async function readReadinessEndpoint(url) {
  try {
    const response = await apiClient.get(url, silentRead);
    return { ok: true, data: response?.data || {} };
  } catch {
    return { ok: false, data: {} };
  }
}

function pingOneDependency(reads) {
  const connected =
    reads.identity.ok &&
    reads.identity.data.status === "connected" &&
    reads.identity.data.details?.httpStatus === 200 &&
    isPingOneCloudEndpoint(reads.identity.data.endpoint);
  const configured =
    reads.credentials.ok &&
    reads.credentials.data.configured === true &&
    reads.credentials.data.userOAuthConfigured === true;

  if (connected) {
    return dependency(
      "pingone",
      "PingOne",
      "available",
      PROVENANCE.LIVE_CLOUD,
      "PingOne introspection health check connected",
    );
  }
  if (configured) {
    return dependency(
      "pingone",
      "PingOne",
      "configured",
      PROVENANCE.RECORDED,
      "Credentials are configured; cloud connectivity is not verified",
    );
  }
  return dependency(
    "pingone",
    "PingOne",
    "unavailable",
    PROVENANCE.RECORDED,
    "PingOne cloud connectivity is not verified",
  );
}

function authorizeDependency(reads, flags) {
  const enabled = flagValue(flags, "ff_authorize_real");
  const verified =
    enabled && reads.authorize.ok && reads.authorize.data.readiness === "ready";

  if (verified) {
    return dependency(
      "authorize",
      "Authorize",
      "available",
      PROVENANCE.LIVE_CLOUD,
      "PingOne Authorize policy readiness verified",
    );
  }
  if (!enabled) {
    return dependency(
      "authorize",
      "Authorize",
      "available",
      PROVENANCE.SIMULATED,
      "Simulated policy engine selected",
    );
  }
  return dependency(
    "authorize",
    "Authorize",
    reads.authorize.ok ? "configured" : "unavailable",
    PROVENANCE.RECORDED,
    "Authorize is enabled, but cloud policy readiness is not verified",
  );
}

function davinciDependency(reads, flags) {
  const enabled = flagValue(flags, "ff_davinci_orchestration");
  return dependency(
    "davinci",
    "DaVinci",
    enabled ? (reads.davinci.ok ? "configured" : "unavailable") : "not-enabled",
    PROVENANCE.RECORDED,
    enabled
      ? "DaVinci configuration observed; no live cloud health signal is available"
      : "Orchestration flag is off",
  );
}

function privilegeDependency(reads, flags) {
  const enabled =
    flagValue(flags, "ff_mcp_gateway_privilege_first") ||
    flagValue(flags, "ff_privilege_llm_first");
  if (!enabled) {
    return dependency(
      "privilege",
      "Privilege",
      "not-enabled",
      PROVENANCE.RECORDED,
      "Privilege flags are off",
    );
  }
  if (reads.privilege.ok && reads.privilege.data.initialized === true) {
    return dependency(
      "privilege",
      "Privilege",
      "available",
      PROVENANCE.LIVE_LOCAL,
      "Local Privilege relay is initialized; cloud readiness is not verified",
    );
  }
  return dependency(
    "privilege",
    "Privilege",
    reads.privilege.ok ? "configured" : "unavailable",
    PROVENANCE.RECORDED,
    "Privilege target is configured but not initialized",
  );
}

function mcpDependency(reads) {
  const gatewayLive = reads.mcpGateway.ok && reads.mcpGateway.data.ok === true;
  const serverLive = reads.mcpServer.ok && reads.mcpServer.data.ok === true;
  if (gatewayLive || serverLive) {
    return dependency(
      "mcp",
      "MCP",
      "available",
      PROVENANCE.LIVE_LOCAL,
      "MCP liveness verified through the BFF",
    );
  }
  if (reads.gatewayConfig.ok) {
    return dependency(
      "mcp",
      "MCP",
      "configured",
      PROVENANCE.RECORDED,
      "MCP configuration observed; liveness is not verified",
    );
  }
  return dependency(
    "mcp",
    "MCP",
    "unavailable",
    PROVENANCE.RECORDED,
    "MCP liveness is not verified",
  );
}

function verticalDependency(reads) {
  const id =
    typeof reads.vertical.data.id === "string"
      ? reads.vertical.data.id.trim()
      : "";
  return dependency(
    "vertical",
    "Selected vertical",
    id ? "available" : "unavailable",
    PROVENANCE.LIVE_LOCAL,
    id || "No vertical selected",
  );
}

export async function getTenantReadiness() {
  const entries = await Promise.all(
    Object.entries(READINESS_ENDPOINTS).map(async ([key, url]) => [
      key,
      await readReadinessEndpoint(url),
    ]),
  );
  const reads = Object.fromEntries(entries);
  const flags = Array.isArray(reads.flags.data.flags)
    ? reads.flags.data.flags
    : [];
  const dependencies = [
    pingOneDependency(reads),
    authorizeDependency(reads, flags),
    davinciDependency(reads, flags),
    privilegeDependency(reads, flags),
    mcpDependency(reads),
    verticalDependency(reads),
  ];
  const byId = Object.fromEntries(dependencies.map((item) => [item.id, item]));
  const optionalCloudProductsEnabled =
    byId.davinci.status !== "not-enabled" ||
    byId.privilege.status !== "not-enabled";
  const cloudVerified =
    byId.pingone.provenance === PROVENANCE.LIVE_CLOUD &&
    byId.authorize.provenance === PROVENANCE.LIVE_CLOUD;
  const ready = Boolean(
    cloudVerified &&
    byId.mcp.status === "available" &&
    byId.vertical.status === "available" &&
    !optionalCloudProductsEnabled,
  );
  const warnings = dependencies
    .filter((item) => ["configured", "unavailable"].includes(item.status))
    .map((item) => `${item.label}: ${item.detail}`);

  return {
    environment: cloudVerified
      ? {
          provenance: PROVENANCE.LIVE_CLOUD,
          label: "Verified cloud services with local dependencies",
        }
      : {
          provenance: PROVENANCE.LIVE_LOCAL,
          label: "Local or configured services",
        },
    dependencies,
    lastCheckedAt: new Date().toISOString(),
    ready,
    warnings,
  };
}

function correlationIdFrom(response) {
  const headers = response?.headers;
  const fromHeaders =
    typeof headers?.get === "function"
      ? headers.get("x-request-id") || headers.get("x-correlation-id")
      : headers?.["x-request-id"] || headers?.["x-correlation-id"];
  const fromBody =
    response?.data?.correlationId || response?.data?.correlation_id;
  const candidate = fromHeaders || fromBody;
  return typeof candidate === "string" &&
    /^[a-zA-Z0-9._:-]{1,160}$/.test(candidate)
    ? candidate
    : null;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function evidence(label, value) {
  return {
    label,
    status: value > 0 ? "observed" : "not-observed",
    count: Number.isFinite(value) ? value : 0,
  };
}

function observation(provenance, entries, warnings = []) {
  const hasEvidence = entries.some((entry) => entry.count > 0);
  return {
    provenance: hasEvidence ? provenance : null,
    result: {
      kind: "observation",
      status: hasEvidence ? "observed" : "no-evidence",
      decision: hasEvidence ? "OBSERVED" : "NO_EVIDENCE",
      valuesRedacted: true,
    },
    evidence: entries,
    warnings: [
      ...(hasEvidence ? [] : ["No lesson evidence was observed."]),
      SNAPSHOT_WARNING,
      ...warnings,
    ],
  };
}

function serviceObservation(data) {
  const services = Object.values(data.services || {});
  return observation(PROVENANCE.LIVE_LOCAL, [
    evidence(
      "Available services",
      services.filter((service) => service?.up === true).length,
    ),
    evidence("Observed services", services.length),
  ]);
}

const OBSERVATION_NORMALIZERS = Object.freeze({
  login: (data) =>
    observation(PROVENANCE.LIVE_LOCAL, [
      evidence("Authenticated session", data.authenticated === true ? 1 : 0),
    ]),
  "token-exchange": (data) => {
    // The BFF /api/token-chain endpoint owns server-side token scrubbing. This
    // client projects only aggregate counts from that already-scrubbed contract.
    const tokenEvents = Number.isFinite(data.metadata?.totalEvents)
      ? data.metadata.totalEvents
      : count(data.tokenChain);
    const mcpCalls = Number.isFinite(data.metadata?.totalMCPToolCalls)
      ? data.metadata.totalMCPToolCalls
      : count(data.mcpToolCallsChain);
    return observation(
      data.metadata?.synthetic === true
        ? PROVENANCE.RECORDED
        : PROVENANCE.LIVE_LOCAL,
      [
        evidence("Token events", tokenEvents),
        evidence("MCP tool calls", mcpCalls),
      ],
      ["Evidence is cumulative session history, not this lesson invocation."],
    );
  },
  "mcp-discovery": (data) => {
    const records = Array.isArray(data.records) ? data.records : [];
    return observation(PROVENANCE.LIVE_LOCAL, [
      evidence("Discovered servers", records.length),
      evidence(
        "Healthy servers",
        records.filter((record) => record?.status === "healthy").length,
      ),
    ]);
  },
  "authorize-decision": (data) =>
    observation(
      data.activeEngine === "simulated"
        ? PROVENANCE.SIMULATED
        : PROVENANCE.RECORDED,
      [
        evidence(
          "Configured decision endpoint",
          data.hasDecisionEndpointId === true ? 1 : 0,
        ),
      ],
      ["Authorize status is configuration evidence, not a policy decision."],
    ),
  "hitl-step-up": (data) =>
    observation(PROVENANCE.LIVE_LOCAL, [
      evidence("Authorization activity events", count(data.events)),
    ]),
  "agent-lifecycle": (data) =>
    observation(PROVENANCE.LIVE_LOCAL, [
      evidence("Agent identity mapping", data.agentMapping ? 1 : 0),
    ]),
  "ai-architecture": (data) => serviceObservation(data),
});

export function isObservationActionSupported(action) {
  return Boolean(
    OBSERVATION_ENDPOINTS[action] && OBSERVATION_NORMALIZERS[action],
  );
}

export function canObserveLesson(lessonId) {
  const lesson = getLesson(lessonId);
  return Boolean(
    lesson && isObservationActionSupported(lesson.run.action),
  );
}

function unobservedResult(status, warning) {
  return {
    provenance: null,
    correlationId: null,
    result: {
      kind: "observation",
      status,
      decision: status === "not-run" ? "NOT_RUN" : "UNAVAILABLE",
      valuesRedacted: true,
    },
    evidence: [],
    warnings: [warning],
  };
}

export async function runLesson(lessonId, input = {}) {
  const lesson = getLesson(lessonId);
  if (!lesson) throw new Error(`Unknown lesson: ${lessonId}`);

  const action = input.action || lesson.run.action;
  if (
    action !== lesson.run.action ||
    !isObservationActionSupported(action)
  ) {
    return unobservedResult(
      "not-run",
      "No direct evidence observation is configured for this lesson and scenario.",
    );
  }

  const endpoint = OBSERVATION_ENDPOINTS[action];

  try {
    const response = await apiClient.get(endpoint, silentRead);
    const normalize = OBSERVATION_NORMALIZERS[action];
    return {
      correlationId: correlationIdFrom(response),
      ...normalize(response?.data || {}),
    };
  } catch {
    return unobservedResult(
      "unavailable",
      `Observation endpoint unavailable; ${lesson.fallback.label} was not executed.`,
    );
  }
}

export async function resetLesson(lessonId) {
  if (!getLesson(lessonId)) throw new Error(`Unknown lesson: ${lessonId}`);
  return { lessonId, cleared: true, tenantMutated: false };
}
