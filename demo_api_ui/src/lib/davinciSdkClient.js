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
 * The body a flow step POSTs to DaVinci, reduced to its shape: eventName,
 * eventType, actionKey, and the formData KEYS with every typed value replaced.
 * Built from an allowlist rather than by blanking known fields, so a field
 * this code has never seen is dropped instead of shown. Exported for tests.
 * @param {unknown} body the request body string the SDK is about to send
 * @returns {object|null}
 */
export function maskStepBody(body) {
  if (typeof body !== "string" || !body) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const params = parsed.parameters || {};
  const data = params.data || {};
  const formData =
    data.formData && typeof data.formData === "object"
      ? Object.fromEntries(Object.keys(data.formData).map((k) => [k, data.formData[k] === "" ? "" : "…"]))
      : null;
  return {
    ...(parsed.id ? { id: "…" } : {}),
    ...(parsed.eventName ? { eventName: String(parsed.eventName) } : {}),
    ...(parsed.interactionId ? { interactionId: "…" } : {}),
    parameters: {
      ...(params.eventType ? { eventType: String(params.eventType) } : {}),
      data: {
        ...(data.actionKey ? { actionKey: String(data.actionKey) } : {}),
        ...(formData ? { formData } : {}),
      },
    },
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

  // Pass-through middleware: it only observes. Anything that mutates the
  // request here changes what is actually sent. The SDK hands every middleware
  // its own request object, { url: URL, method, headers, body }
  // (sdk-request-middleware initQuery), so the JSON a flow step POSTs is
  // visible here. The body is masked BEFORE it leaves this function: the trace
  // feeds the on-page Step Inspector, and a typed password must never reach it.
  const requestMiddleware = emit
    ? [
        (req, action, next) => {
          emit({
            at: Date.now(),
            source: "http",
            action: action?.type ?? null,
            url: req?.url ? String(req.url) : null,
            method: req?.method ?? "GET",
            body: maskStepBody(req?.body),
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

/**
 * End the browser's PingOne SSO session and come back to this page with a
 * clean form. This does NOT touch the app's own BFF session.
 *
 * Needed because an existing PingOne session is reused: signed in to PingOne as
 * one user, the flow completes as that user, and signing in as someone else on
 * top of it fails with "userSessionMismatch". Signing out of PingOne is the way
 * to switch.
 *
 * Measured against the live environment: /as/signoff honours
 * post_logout_redirect_uri WITHOUT an id_token_hint once the URI is registered
 * on the app — so this is built in the browser and the ID token (held by the
 * BFF) never has to reach it.
 *
 * `go` is injectable only so a test can capture the URL; jsdom will not let a
 * test redefine window.location.
 */
export async function signOutOfPingOne(cfg, go = (url) => window.location.assign(url)) {
  const discovery = await fetch(cfg.wellknown).then((r) => r.json());
  if (!discovery?.end_session_endpoint) {
    throw new Error("PingOne did not advertise an end_session_endpoint, so sign-out is unavailable.");
  }
  const url = new URL(discovery.end_session_endpoint);
  url.searchParams.set("post_logout_redirect_uri", cfg.redirectUri);
  url.searchParams.set("client_id", cfg.clientId);
  go(url.toString());
  return url.toString();
}

export function isSdkError(result) {
  return !result || (typeof result === "object" && "error" in result && Boolean(result.error));
}
