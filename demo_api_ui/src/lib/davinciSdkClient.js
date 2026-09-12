// Ping Orchestration SDK client for /davinci-sdk-login.
//
// Debugging this path goes through the SDK's OWN logger, not through watching
// HTTP. `logger.custom` is the designed channel: it narrates what the SDK
// decided, which is the thing you actually need when a collector does not
// appear or a value does not land. Raw request/response tells you what went
// over the wire, which is a different and usually less useful question.
//
// Three observability hooks are wired here from the start, all inert unless a
// sink is passed, because retrofitting them later means touching every call
// site (the live trace panel consumes exactly these):
//   logger.custom      — the SDK's own narration
//   requestMiddleware  — the HTTP underneath, when you do want it
//   client.subscribe   — every internal state transition
//
// Config comes from the BFF (POST /api/davinci-sdk-login/start), which also arms
// the single-use nonce. Nothing about the tenant is hardcoded in the bundle.
import { davinci } from "@forgerock/davinci-client";

// Shapes one SDK log call into a trace entry. LogMessage is string|number|object,
// and the SDK passes several args, so keep them all rather than the first.
function toEntry(level, args) {
  return {
    at: Date.now(),
    source: "logger",
    level,
    parts: args.map((a) => (typeof a === "object" ? a : String(a))),
  };
}

/**
 * Build a DaVinci client.
 *
 * @param {object} cfg - from POST /api/davinci-sdk-login/start
 * @param {object} [opts]
 * @param {(entry: object) => void} [opts.onTrace] - receives trace entries from
 *   all three hooks. Omit it and the SDK stays silent.
 * @param {'error'|'warn'|'info'|'debug'|'none'} [opts.logLevel]
 */
export async function initClient(cfg, { onTrace, logLevel = "debug" } = {}) {
  const emit = onTrace || null;

  const logger = emit
    ? {
        level: logLevel,
        custom: {
          error: (...a) => emit(toEntry("error", a)),
          warn: (...a) => emit(toEntry("warn", a)),
          info: (...a) => emit(toEntry("info", a)),
          debug: (...a) => emit(toEntry("debug", a)),
        },
      }
    : { level: "none" };

  // Pass-through middleware: it must return the args unchanged, so this only
  // observes. Anything that mutates here changes the real request.
  const requestMiddleware = emit
    ? [
        (fetchArgs, action, next) => {
          emit({
            at: Date.now(),
            source: "http",
            action: action?.type ?? null,
            url: typeof fetchArgs?.[0] === "string" ? fetchArgs[0] : fetchArgs?.url,
            method: fetchArgs?.[1]?.method ?? fetchArgs?.method ?? "GET",
          });
          return next?.();
        },
      ]
    : undefined;

  const client = await davinci({
    config: {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scope: cfg.scope || "openid profile email",
      responseType: "code",
      // `wellknown` is what the client requires — NOT baseUrl, whatever the
      // older sdk-types PathsConfig suggests.
      serverConfig: { wellknown: cfg.wellknown },
    },
    ...(requestMiddleware ? { requestMiddleware } : {}),
    logger,
  });

  if (emit) {
    client.subscribe(() => {
      const node = client.getNode();
      emit({
        at: Date.now(),
        source: "state",
        status: node?.status ?? null,
        collectors: (node?.client?.collectors || []).map((c) => ({
          category: c.category,
          type: c.type,
          name: c.name,
          key: c.output?.key,
        })),
      });
    });
  }

  return client;
}

export async function fetchSdkConfig() {
  const res = await fetch("/api/davinci-sdk-login/start", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // /start answers 503 with a `missing` list naming the exact key and where it
    // lives, because "set these three" cannot distinguish a missing .env entry
    // from a vaulted secret that never reached configStore.
    const err = new Error(body.message || `Could not start a DaVinci SDK flow (HTTP ${res.status}).`);
    err.notConfigured = res.status === 503;
    err.missing = body.missing || null;
    throw err;
  }
  return body;
}

// The SDK generates the PKCE verifier in the browser and abandons it in
// sessionStorage — it never reads it back, and nothing on the client exposes it,
// so reading the key is the only route. Deliberately NOT imported from
// @forgerock/sdk-oidc: that bare specifier resolves to the HOISTED 2.0.0 copy
// while davinci-client uses its NESTED 2.1.1 one, and that function also removes
// the item itself, so whoever calls first wins.
//
// Contract: `${prefix||'FR-SDK'}-authflow-${clientId}`, JSON, `.verifier`.
// createAuthorizeUrl passes no prefix, so it is always FR-SDK. Pinned by a
// contract test that drives the real SDK — an assertion on this string alone
// would keep passing through the upgrade that breaks it.
// `store` is a default parameter purely so the unavailable-storage branch is
// testable: jsdom's sessionStorage does not dispatch through Storage.prototype,
// so a spy never fires and the test would silently assert the wrong branch.
export function takePkceVerifier(clientId, store = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  const key = `FR-SDK-authflow-${clientId}`;
  let raw = null;
  try {
    if (!store) throw new Error("no storage");
    raw = store.getItem(key);
    store.removeItem(key);
  } catch {
    // Private windows and blocked site-data throw on access.
    throw new Error("Could not read the sign-in record from session storage. Restart the sign-in.");
  }
  if (!raw) throw new Error("The sign-in flow did not store its PKCE verifier. Restart the sign-in.");
  const { verifier } = JSON.parse(raw);
  if (!verifier) throw new Error("The stored sign-in record has no PKCE verifier. Restart the sign-in.");
  return verifier;
}

export async function postCallback({ code, codeVerifier }) {
  const res = await fetch("/api/davinci-sdk-login/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code, codeVerifier }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Sign-in failed (HTTP ${res.status}).`);
  return body;
}

export function isSdkError(result) {
  return !result || (typeof result === "object" && "error" in result && Boolean(result.error));
}
