import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import apiClient from "./apiClient";

const presenterState = new Map();

const READINESS_ENDPOINTS = Object.freeze({
  health: "/api/health",
  services: "/api/health/services",
  flags: "/api/admin/feature-flags",
  authorize: "/api/authorize/test-status",
  davinci: "/api/davinci-demo/config",
  privilege: "/api/privilege-mcp-simple/status",
  gateway: "/api/mcp-gateway/active",
  vertical: "/api/verticals/active",
});

const RUN_ENDPOINTS = Object.freeze({
  login: "/api/auth/oauth/user/status",
  "token-exchange": "/api/token-chain",
  "mcp-discovery": "/api/admin/mcp-discovery/inventory",
  "authorize-decision": "/api/authorize/test-status",
  "hitl-step-up": "/api/app-events?category=authorize&limit=10",
  "agent-lifecycle": "/api/agent/identity/status",
  "ai-architecture": "/api/health/services",
  "product-map": "/api/health/services",
});

const silentRead = Object.freeze({ _silent: true, _noAuthBanner: true });

function flagValue(flags, id) {
  const value = flags.find((flag) => flag?.id === id)?.value;
  return value === true || value === "true";
}

function parseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value, "https://local.ping-devops.com");
  } catch {
    return null;
  }
}

function isPingOneCloudUrl(value) {
  const hostname = parseUrl(value)?.hostname.toLowerCase() || "";
  return /^auth\.pingone\.(com|eu|asia|ca|com\.au)$/.test(hostname);
}

function isRemoteHttpsUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return false;
  }
  return hostname.includes(".");
}

function hasPingOneCloudSignal(value, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (typeof value === "string") return isPingOneCloudUrl(value);
  if (Array.isArray(value)) {
    return value.some((entry) => hasPingOneCloudSignal(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value).some((entry) =>
      hasPingOneCloudSignal(entry, depth + 1),
    );
  }
  return false;
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
  const healthComponents = reads.health.data.components || {};
  const pingOneResponded =
    reads.health.ok &&
    healthComponents.pingone_auth?.status === "healthy" &&
    healthComponents.pingone_jwks?.status === "healthy";
  const verifiedIdentityEndpoint =
    healthComponents.token_introspection?.endpoint ||
    healthComponents.token_revocation?.endpoint;
  const pingOneCloud =
    pingOneResponded && isPingOneCloudUrl(verifiedIdentityEndpoint);

  const dependencies = [];
  dependencies.push(
    dependency(
      "pingone",
      "PingOne",
      pingOneResponded ? "available" : "unavailable",
      pingOneCloud ? PROVENANCE.LIVE_CLOUD : PROVENANCE.LIVE_LOCAL,
      pingOneCloud
        ? "Cloud identity endpoints verified"
        : "Cloud identity endpoint not verified",
    ),
  );

  const authorizeData = reads.authorize.data;
  const authorizeSimulated =
    authorizeData.activeEngine === "simulated" ||
    authorizeData.simulatedMode === true;
  const authorizeCloud =
    authorizeData.activeEngine === "pingone" &&
    authorizeData.pingoneConfigured === true &&
    flagValue(flags, "ff_authorize_real") &&
    pingOneCloud;
  dependencies.push(
    dependency(
      "authorize",
      "Authorize",
      authorizeCloud || authorizeSimulated ? "available" : "unavailable",
      authorizeCloud
        ? PROVENANCE.LIVE_CLOUD
        : authorizeSimulated
          ? PROVENANCE.SIMULATED
          : PROVENANCE.LIVE_LOCAL,
      authorizeCloud
        ? "Live PingOne policy engine"
        : authorizeSimulated
          ? "Simulated policy engine"
          : "Live policy engine not ready",
    ),
  );

  const davinciEnabled = flagValue(flags, "ff_davinci_orchestration");
  const davinciCloud =
    davinciEnabled &&
    reads.davinci.ok &&
    isPingOneCloudUrl(reads.davinci.data.wellknown);
  dependencies.push(
    dependency(
      "davinci",
      "DaVinci",
      davinciEnabled
        ? reads.davinci.ok
          ? "available"
          : "unavailable"
        : "not-enabled",
      davinciCloud
        ? PROVENANCE.LIVE_CLOUD
        : davinciEnabled
          ? PROVENANCE.LIVE_LOCAL
          : PROVENANCE.RECORDED,
      davinciEnabled
        ? davinciCloud
          ? "Cloud orchestration configured"
          : "Cloud orchestration not verified"
        : "Orchestration flag is off",
    ),
  );

  const privilegeEnabled =
    flagValue(flags, "ff_mcp_gateway_privilege_first") ||
    flagValue(flags, "ff_privilege_llm_first");
  const privilegeCloud =
    privilegeEnabled &&
    reads.privilege.ok &&
    isRemoteHttpsUrl(reads.privilege.data.mcpUrl);
  dependencies.push(
    dependency(
      "privilege",
      "Privilege",
      privilegeEnabled
        ? reads.privilege.ok
          ? "available"
          : "unavailable"
        : "not-enabled",
      privilegeCloud
        ? PROVENANCE.LIVE_CLOUD
        : privilegeEnabled
          ? PROVENANCE.LIVE_LOCAL
          : PROVENANCE.RECORDED,
      privilegeEnabled
        ? privilegeCloud
          ? "Remote Privilege route configured"
          : "Local Privilege route"
        : "Privilege flags are off",
    ),
  );

  const services = reads.services.data.services || {};
  const mcpAvailable =
    reads.services.ok &&
    (services.mcp_gateway?.up === true || services.mcp_server?.up === true);
  const mcpCloud =
    mcpAvailable &&
    reads.gateway.data.usePingGateway === true &&
    isRemoteHttpsUrl(reads.gateway.data.url);
  dependencies.push(
    dependency(
      "mcp",
      "MCP",
      mcpAvailable ? "available" : "unavailable",
      mcpCloud ? PROVENANCE.LIVE_CLOUD : PROVENANCE.LIVE_LOCAL,
      mcpCloud
        ? "Remote PingOne Agent Gateway reachable"
        : mcpAvailable
          ? "Local MCP path reachable"
          : "MCP path unavailable",
    ),
  );

  const verticalId =
    typeof reads.vertical.data.id === "string"
      ? reads.vertical.data.id.trim()
      : "";
  dependencies.push(
    dependency(
      "vertical",
      "Selected vertical",
      verticalId ? "available" : "unavailable",
      PROVENANCE.LIVE_LOCAL,
      verticalId || "No vertical selected",
    ),
  );

  const warnings = [];
  if (pingOneResponded && !pingOneCloud) {
    warnings.push(
      "PingOne responded, but a PingOne cloud endpoint was not verified.",
    );
  }
  for (const item of dependencies) {
    if (item.status === "unavailable")
      warnings.push(`${item.label} is unavailable.`);
  }

  const enabledCloudDependencies = dependencies.filter(
    (item) => item.id !== "vertical" && item.status !== "not-enabled",
  );
  const ready = Boolean(
    verticalId &&
    pingOneCloud &&
    enabledCloudDependencies.length > 0 &&
    enabledCloudDependencies.every(
      (item) =>
        item.status === "available" &&
        item.provenance === PROVENANCE.LIVE_CLOUD,
    ),
  );

  return {
    environment: pingOneCloud
      ? { provenance: PROVENANCE.LIVE_CLOUD, label: "PingOne cloud tenant" }
      : { provenance: PROVENANCE.LIVE_LOCAL, label: "Local or mixed services" },
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
  if (
    typeof candidate === "string" &&
    /^[a-zA-Z0-9._:-]{1,160}$/.test(candidate)
  ) {
    return candidate;
  }
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `academy-${Date.now().toString(36)}`;
}

function redactedResult(status, decision = "OBSERVED") {
  return { kind: "redacted", status, decision, valuesRedacted: true };
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function observed(label, value) {
  return {
    label,
    status: "observed",
    count: Number.isFinite(value) ? value : 0,
  };
}

function normalizeRun(action, data) {
  switch (action) {
    case "login": {
      const authenticated = data.authenticated === true;
      return {
        provenance: String(data.oauthProvider || "")
          .toLowerCase()
          .includes("pingone")
          ? PROVENANCE.LIVE_CLOUD
          : PROVENANCE.LIVE_LOCAL,
        result: redactedResult(
          authenticated ? "complete" : "not-authenticated",
          authenticated ? "AUTHENTICATED" : "NOT_AUTHENTICATED",
        ),
        evidence: [observed("Authenticated session", authenticated ? 1 : 0)],
        warnings: authenticated
          ? []
          : ["Sign in to capture live identity evidence."],
      };
    }
    case "token-exchange": {
      const tokenEvents = Number.isFinite(data.metadata?.totalEvents)
        ? data.metadata.totalEvents
        : count(data.tokenChain);
      const mcpCalls = Number.isFinite(data.metadata?.totalMCPToolCalls)
        ? data.metadata.totalMCPToolCalls
        : count(data.mcpToolCallsChain);
      const synthetic = data.metadata?.synthetic === true;
      return {
        provenance: synthetic
          ? PROVENANCE.RECORDED
          : hasPingOneCloudSignal(data)
            ? PROVENANCE.LIVE_CLOUD
            : PROVENANCE.LIVE_LOCAL,
        result: redactedResult("complete"),
        evidence: [
          observed("Token events", tokenEvents),
          observed("MCP tool calls", mcpCalls),
        ],
        warnings: synthetic
          ? ["The token chain was reconstructed from session metadata."]
          : [],
      };
    }
    case "mcp-discovery": {
      const records = Array.isArray(data.records) ? data.records : [];
      const healthy = records.filter((record) => record?.status === "healthy");
      const remote = healthy.some(
        (record) =>
          record?.location === "remote" ||
          record?.source === "remote-url" ||
          isRemoteHttpsUrl(record?.endpoint),
      );
      return {
        provenance: remote ? PROVENANCE.LIVE_CLOUD : PROVENANCE.LIVE_LOCAL,
        result: redactedResult("complete"),
        evidence: [
          observed("Discovered servers", records.length),
          observed("Healthy servers", healthy.length),
        ],
        warnings: healthy.length ? [] : ["No healthy MCP server was observed."],
      };
    }
    case "authorize-decision": {
      const engine = data.activeEngine;
      const provenance =
        engine === "pingone"
          ? PROVENANCE.LIVE_CLOUD
          : engine === "simulated"
            ? PROVENANCE.SIMULATED
            : PROVENANCE.LIVE_LOCAL;
      return {
        provenance,
        result: redactedResult(
          engine === "pingone" || engine === "simulated"
            ? "complete"
            : "not-ready",
          String(engine || "UNKNOWN").toUpperCase(),
        ),
        evidence: [
          observed(
            "Configured decision endpoint",
            data.hasDecisionEndpointId ? 1 : 0,
          ),
        ],
        warnings:
          engine === "pending_config" || engine === "off"
            ? ["Authorize is not ready for a live decision."]
            : [],
      };
    }
    case "hitl-step-up": {
      const events = Array.isArray(data.events) ? data.events : [];
      return {
        provenance: hasPingOneCloudSignal(data)
          ? PROVENANCE.LIVE_CLOUD
          : PROVENANCE.LIVE_LOCAL,
        result: redactedResult("complete"),
        evidence: [observed("Authorization activity events", events.length)],
        warnings: events.length
          ? []
          : ["No recent authorization activity was observed."],
      };
    }
    case "agent-lifecycle": {
      const mappingPresent = Boolean(data.agentMapping);
      return {
        provenance: hasPingOneCloudSignal(data.agentMapping)
          ? PROVENANCE.LIVE_CLOUD
          : PROVENANCE.LIVE_LOCAL,
        result: redactedResult(
          "complete",
          mappingPresent ? "REGISTERED" : "UNREGISTERED",
        ),
        evidence: [observed("Agent identity mapping", mappingPresent ? 1 : 0)],
        warnings: mappingPresent
          ? []
          : ["No agent identity mapping is registered for this session."],
      };
    }
    case "ai-architecture":
    case "product-map": {
      const services = Object.values(data.services || {});
      const available = services.filter(
        (service) => service?.up === true,
      ).length;
      return {
        provenance: PROVENANCE.LIVE_LOCAL,
        result: redactedResult("complete"),
        evidence: [
          observed("Available services", available),
          observed("Observed services", services.length),
        ],
        warnings: available ? [] : ["No supporting services were reachable."],
      };
    }
    default:
      return null;
  }
}

function fallbackRun(lesson, warning) {
  return {
    provenance: lesson.fallback.provenance,
    correlationId: correlationIdFrom(null),
    result: redactedResult("fallback", "NOT_RUN"),
    evidence: lesson.evidence.events.map((label) => ({
      label,
      status: "not-observed",
      count: 0,
    })),
    warnings: [warning],
  };
}

export async function runLesson(lessonId, _input = {}) {
  const lesson = getLesson(lessonId);
  if (!lesson) throw new Error(`Unknown lesson: ${lessonId}`);

  const endpoint = RUN_ENDPOINTS[lesson.run.action];
  if (!endpoint) {
    const fallback = fallbackRun(
      lesson,
      "No safe live-run endpoint is configured for this lesson.",
    );
    presenterState.set(lessonId, fallback);
    return fallback;
  }

  try {
    const response = await apiClient.get(endpoint, silentRead);
    const normalized = normalizeRun(lesson.run.action, response?.data || {});
    if (!normalized) throw new Error("unsupported_run_action");
    const result = {
      correlationId: correlationIdFrom(response),
      ...normalized,
    };
    presenterState.set(lessonId, result);
    return result;
  } catch {
    const fallback = fallbackRun(
      lesson,
      `Live endpoint unavailable; using ${lesson.fallback.label}.`,
    );
    presenterState.set(lessonId, fallback);
    return fallback;
  }
}

export async function resetLesson(lessonId) {
  if (!getLesson(lessonId)) throw new Error(`Unknown lesson: ${lessonId}`);
  presenterState.delete(lessonId);
  return { lessonId, cleared: true };
}
