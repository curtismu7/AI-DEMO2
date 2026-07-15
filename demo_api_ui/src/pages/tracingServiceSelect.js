// demo_api_ui/src/pages/tracingServiceSelect.js
/** Helpers for /tracing service preference, auto-select, and outage detection. */

export const TRACING_SERVICE_STORAGE_KEY = "tracing.selectedService";

/** Services most likely to emit demo traffic — probed first (cap applied after merge). */
export const PREFERRED_TRACE_SERVICES = [
  "demo-api-server",
  "mcp-gateway",
  "agent-service",
  "langchain-agent",
  "mcp-server",
  "hitl-service",
];

const MAX_PROBE_CANDIDATES = 8;

/** @type {Storage | null | undefined} */
let storageOverride;

/**
 * Test-only: inject a Storage mock (avoids setupTests localStorage alias issues).
 * @param {Storage | null | undefined} store
 */
export function __setTracingStorageForTests(store) {
  storageOverride = store;
}

/**
 * Returns a Storage instance without going through a broken globalThis.localStorage getter.
 * @returns {Storage | null}
 */
function getStorage() {
  if (storageOverride !== undefined) return storageOverride;
  try {
    if (typeof Window !== "undefined" && typeof window !== "undefined") {
      const desc = Object.getOwnPropertyDescriptor(Window.prototype, "localStorage");
      if (desc?.get) return desc.get.call(window);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Reads the persisted service preference from localStorage.
 * @returns {string|null}
 */
export function readStoredService() {
  try {
    return getStorage()?.getItem(TRACING_SERVICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Persists the user's manual service choice.
 * @param {string} name
 */
export function writeStoredService(name) {
  try {
    getStorage()?.setItem(TRACING_SERVICE_STORAGE_KEY, name);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Orders probe candidates: preferred names first, then remaining, capped.
 * @param {string[]} services
 * @returns {string[]}
 */
export function rankCandidateServices(services) {
  const list = Array.isArray(services) ? services.filter(Boolean) : [];
  const preferred = PREFERRED_TRACE_SERVICES.filter((s) => list.includes(s));
  const rest = list.filter((s) => !PREFERRED_TRACE_SERVICES.includes(s));
  return [...preferred, ...rest].slice(0, MAX_PROBE_CANDIDATES);
}

/**
 * Picks the service whose newest trace startTime is latest; falls back to first listed.
 * @param {{ service: string, traces: Array<{ startTime?: string }> }[]} probeResults
 * @param {string[]} services
 * @returns {string}
 */
export function pickBestService(probeResults, services) {
  let best = null;
  let bestTime = -1;
  for (const row of probeResults || []) {
    if (!row?.traces?.length) continue;
    for (const t of row.traces) {
      const ms = t.startTime ? Date.parse(t.startTime) : 0;
      if (Number.isFinite(ms) && ms >= bestTime) {
        bestTime = ms;
        best = row.service;
      }
    }
  }
  if (best) return best;
  if (services?.length) return services[0];
  return "demo-api-server";
}

/**
 * True when the failure is a transient gateway/network error, not an empty result.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTransientFailure(err) {
  const msg = String(err?.message || err || "");
  return /HTTP 502|HTTP 503|HTTP 504|Failed to fetch|NetworkError|socket hang up|Load failed|network/i.test(
    msg,
  );
}
