// banking_api_ui/src/services/apiTrafficStore.js
import { spinner } from "./spinnerService";
import { notifySessionExpiredIfNeeded } from "../utils/authUi";
/**
 * In-memory ring buffer for API request/response traffic.
 * Subscribed by ApiTrafficPanel; populated by axios interceptors + fetch wrapper.
 */

const MAX_ENTRIES = 200;
/** Max characters stored per raw string body (fetch); avoids runaway memory on huge downloads. */
const MAX_CAPTURE_BODY_CHARS = 20_000;
/** Max characters when serialising a parsed-JSON body for storage; keeps localStorage small. */
const MAX_JSON_BODY_CHARS = 20_000;
const LS_KEY = "api-traffic-store";
let entries = [];
let paused = false;
const listeners = new Set();
let seq = 0;

/** Debounced localStorage write — batches rapid appends into a single serialisation. */
let _persistTimer = null;
function persistToStorage() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(entries));
    } catch (_) {}
  }, 1500);
}

/**
 * Cap a parsed-JSON body so a single large response (e.g. ?limit=500) cannot
 * fill the entire ring buffer with megabytes of data.
 */
function capJsonBody(body) {
  if (body === null || body === undefined) return body;
  if (typeof body !== "object") return body;
  try {
    const s = JSON.stringify(body);
    if (s.length <= MAX_JSON_BODY_CHARS) return body;
    return s.slice(0, MAX_JSON_BODY_CHARS) + "… [truncated]";
  } catch (_) {
    return "[unserializable]";
  }
}

/** Debounced notify — batches rapid appends into a single React render cycle. */
let _notifyTimer = null;
function notify() {
  if (_notifyTimer) return;
  _notifyTimer = setTimeout(() => {
    _notifyTimer = null;
    const snap = entries;
    listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch (_) {}
    });
  }, 50);
}

/** Seed the in-memory store from localStorage (used by the popup page). */
export function seedFromLocalStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    if (Array.isArray(stored) && stored.length > 0) {
      entries = stored;
      if (stored.length > 0) seq = Math.max(...stored.map((e) => e.id || 0));
      notify();
    }
  } catch (_) {}
}

const REDACT_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);
const REDACT_BODY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "password",
  "token",
  "client_credentials",
  "code_verifier",
  "currentpassword",
  "newpassword", // Phase 269.1 — /api/admin/vault/rotate body
]);

/** Redact sensitive request/response headers. */
export function redactHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.has(String(k).toLowerCase()) ? "***" : v;
  }
  return out;
}

/** Shallow-redact known sensitive keys in a JSON body object. */
export function redactBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = REDACT_BODY_KEYS.has(String(k).toLowerCase()) ? "***" : v;
  }
  return out;
}

/** Flatten AxiosHeaders / Headers into a plain object for display. */
export function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.toJSON === "function") return headers.toJSON();
  if (
    typeof headers.forEach === "function" &&
    typeof Object.fromEntries === "function"
  ) {
    try {
      return Object.fromEntries(headers.entries());
    } catch (_) {}
  }
  return typeof headers === "object" ? { ...headers } : {};
}

/** Try to JSON-parse a text string; return the object or null. */
export function tryParseJson(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Append one traffic entry to the ring buffer. No-op when paused. */
export function appendTrafficEntry(entry) {
  if (paused) return;
  const cappedEntry = {
    ...entry,
    id: ++seq,
    responseBody: capJsonBody(entry.responseBody),
    requestBody: capJsonBody(entry.requestBody),
  };
  entries = [cappedEntry, ...entries.slice(0, MAX_ENTRIES - 1)];
  persistToStorage();
  notify();
}

export function clearTraffic() {
  entries = [];
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  if (_notifyTimer) {
    clearTimeout(_notifyTimer);
    _notifyTimer = null;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch (_) {}
  const snap = entries;
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (_) {}
  });
}

export function setPaused(val) {
  paused = !!val;
}
export function isPausedNow() {
  return paused;
}
export function getAll() {
  return entries;
}

/**
 * @param {(entries: object[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ─── MCP + token-event injection ─────────────────────────────────────────────

const TOKEN_EVENT_STATUS_LABELS = {
  active: "active",
  exchanged: "exchanged",
  skipped: "skipped",
  failed: "failed",
  acquiring: "acquiring",
  reused: "reused",
};

/**
 * Inject synthetic token-event entries after an MCP tool call completes.
 * Each entry in tokenEvents becomes its own row in the API Traffic panel.
 *
 * @param {string}   toolName     MCP tool name (e.g. 'create_transfer')
 * @param {Array}    tokenEvents  Array returned by /api/mcp/tool response
 */
export function appendTokenEvents(toolName, tokenEvents = []) {
  if (!Array.isArray(tokenEvents) || tokenEvents.length === 0) return;
  const ts = new Date().toISOString();
  for (const ev of tokenEvents) {
    appendTrafficEntry({
      kind: "token-event",
      method: "TOKEN",
      url: `[${toolName}] ${ev.label || ev.id}`,
      status: ev.status === "failed" ? 0 : 200,
      duration: null,
      requestHeaders: {},
      requestBody: ev.exchangeDetails || null,
      responseHeaders: {},
      responseBody: ev.jwtFullDecode?.claims || ev.claims || null,
      source: "token-event",
      toolName,
      eventId: ev.id,
      eventLabel: ev.label,
      eventStatus: TOKEN_EVENT_STATUS_LABELS[ev.status] || ev.status,
      explanation: ev.explanation || null,
      claims: ev.claims || null,
      jwtHeader: ev.jwtFullDecode?.header || null,
      exchangeDetails: ev.exchangeDetails || null,
      mayActPresent: ev.mayActPresent,
      mayActValid: ev.mayActValid,
      rfc: ev.rfc || null,
      alg: ev.alg || null,
      timestamp: ts,
    });
  }
}

// ─── window.fetch wrapper ─────────────────────────────────────────────────────

let fetchPatched = false;

/**
 * Patch window.fetch once to capture /api/* calls into the traffic store
 * and show the global spinner for same-origin API requests (unless `init._silent`).
 * Call from index.js before React renders.
 */
export function patchFetch() {
  if (fetchPatched || typeof window === "undefined" || !window.fetch) return;
  fetchPatched = true;
  const origFetch = window.fetch.bind(window);

  window.fetch = async function trafficFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input?.url ?? "");

    // Only capture same-origin /api/* calls
    if (!url || !url.startsWith("/api/")) return origFetch(input, init);

    const method = (init?.method || "GET").toUpperCase();
    /** When true, skip global spinner (parity with axios `config._silent` — background session polls). */
    const silent = !!(init && init._silent);
    const start = Date.now();
    const reqHeaders = redactHeaders(
      init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : init?.headers || {},
    );

    let reqBody = null;
    const rawBody = init?.body;
    if (rawBody) {
      if (typeof rawBody === "string") {
        reqBody = tryParseJson(rawBody) || rawBody.slice(0, 4096);
      } else if (rawBody instanceof FormData) {
        reqBody = "<FormData>";
      } else {
        reqBody = "<binary>";
      }
    }
    if (reqBody && typeof reqBody === "object") reqBody = redactBody(reqBody);

    if (!silent) {
      try {
        spinner.increment(method, url);
      } catch (_) {}
    }

    try {
      const response = await origFetch(input, init);
      const duration = Date.now() - start;
      const resHeaders = Object.fromEntries(response.headers.entries());

      if (!silent) {
        try {
          spinner.decrement(false);
        } catch (_) {}
      }

      if (response.status === 401) {
        response
          .clone()
          .json()
          .then((body) => {
            notifySessionExpiredIfNeeded({
              status: 401,
              body,
              pathname: window.location?.pathname,
            });
          })
          .catch(() => {});
      }

      // Clone so the original body is still readable by the caller
      response
        .clone()
        .text()
        .then((text) => {
          const parsed = tryParseJson(text);
          let responseBody = parsed;
          if (parsed === null && text) {
            responseBody =
              text.length > MAX_CAPTURE_BODY_CHARS
                ? `${text.slice(0, MAX_CAPTURE_BODY_CHARS)}\n… [truncated ${text.length - MAX_CAPTURE_BODY_CHARS} chars]`
                : text;
          }
          appendTrafficEntry({
            method,
            url,
            status: response.status,
            duration,
            requestHeaders: reqHeaders,
            requestBody: reqBody,
            responseHeaders: resHeaders,
            responseBody,
            source: "fetch",
            timestamp: new Date().toISOString(),
          });
        })
        .catch(() => {});

      return response;
    } catch (err) {
      if (!silent) {
        try {
          spinner.decrement(true);
        } catch (_) {}
      }
      appendTrafficEntry({
        method,
        url,
        status: 0,
        duration: Date.now() - start,
        requestHeaders: reqHeaders,
        requestBody: reqBody,
        error: err.message,
        source: "fetch",
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  };
}
