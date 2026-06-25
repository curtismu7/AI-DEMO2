import { oidc } from "@forgerock/oidc-client";

// Singleton OIDC SDK client for the centralized-login demo (/sdk-login).
//
// Config (well-known URL, public client_id, redirect URI, scope) is fetched from
// the BFF's public GET /api/sdk-demo/config so the demo tracks the deployed
// PingOne environment with nothing hardcoded in the bundle. This is a PUBLIC PKCE
// client, deliberately separate from the confidential BFF login flow.
//
// Token custody: instead of the SDK's default browser storage, this demo wires a
// `custom` storage adapter that round-trips token reads/writes to the BFF, which
// persists them in LMDB (encrypted, scoped per browser session). See
// routes/sdkDemoTokens.js + services/lmdb/sdkDemoTokenStore.lmdb.js.

// A GenericError ({ error, type, message }) — the failure shape the SDK's
// CustomStorageObject contract expects so it can surface a storage problem
// instead of silently treating it as "no token".
const storageError = (message) => ({ error: message, type: "internal_error", message });

// CustomStorageObject — { get(key), set(key, value), remove(key) } — backed by the
// BFF LMDB endpoints. credentials:'same-origin' so the express-session cookie
// (which scopes the LMDB entries) is sent.
//
// On a backend failure these return a GenericError so the SDK surfaces the problem
// instead of mistaking a transient outage for "signed out". Absence of a token is
// a normal 200 with { value: null } (see routes/sdkDemoTokens.js), so only a non-ok
// response is treated as an error. Without this, a failed PUT (e.g. the 32KB cap, a
// 5xx, or a dropped request) would be invisible to the SDK and the user would appear
// signed-out despite a successful login + code exchange.
const lmdbStorageAdapter = {
  async get(key) {
    const res = await fetch(`/api/sdk-demo/tokens?key=${encodeURIComponent(key)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return storageError(`Token read failed (HTTP ${res.status})`);
    const data = await res.json();
    return data.value ?? null;
  },
  async set(key, value) {
    const res = await fetch("/api/sdk-demo/tokens", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-sdk-demo-csrf": "1" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) return storageError(`Token write failed (HTTP ${res.status})`);
    return null;
  },
  async remove(key) {
    const res = await fetch(`/api/sdk-demo/tokens?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "x-sdk-demo-csrf": "1" },
    });
    if (!res.ok) return storageError(`Token remove failed (HTTP ${res.status})`);
    return null;
  },
};

let clientPromise = null;

async function build() {
  const res = await fetch("/api/sdk-demo/config", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Could not load SDK demo config (HTTP ${res.status})`);
  }
  const cfg = await res.json();
  if (!cfg.clientId || !cfg.wellknown) {
    throw new Error(
      "SDK demo is not configured. Set PINGONE_SDK_DEMO_CLIENT_ID (a public PKCE " +
        "SPA client) and the PingOne environment, then restart the server."
    );
  }
  if (!cfg.redirectUri) {
    throw new Error(
      "SDK demo redirect URI is not configured. Set PINGONE_SDK_DEMO_REDIRECT_URI " +
        "(must match the value registered on the PingOne SPA client) and restart the server."
    );
  }
  // The SDK omits the openid scope when scope is empty, which only fails after the
  // full browser redirect with a confusing state/grant error. Catch it up front.
  const scope = (cfg.scope || "").trim();
  if (!scope.split(/\s+/).includes("openid")) {
    throw new Error(
      'SDK demo scope must include "openid". Set PINGONE_SDK_DEMO_SCOPE ' +
        '(e.g. "openid profile email") and restart the server.'
    );
  }

  const client = await oidc({
    config: {
      serverConfig: { wellknown: cfg.wellknown },
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      scope: cfg.scope,
    },
    // Persist tokens in LMDB via the BFF instead of browser storage.
    storage: {
      type: "custom",
      name: "sdkDemoTokens",
      custom: lmdbStorageAdapter,
    },
  });

  // oidc() resolves to an error-shaped object instead of throwing when init
  // fails (e.g. the well-known endpoint is unreachable or misconfigured).
  if (isSdkError(client)) {
    throw new Error(client.error || "OIDC client initialization failed");
  }
  return client;
}

// Memoized: one client instance per page load. Reset on failure so a transient
// error (offline, misconfig) can be retried by re-invoking getSdkClient().
export function getSdkClient() {
  if (!clientPromise) {
    clientPromise = build().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

// SDK methods resolve to a GenericError ({ error, type, message }) instead of
// throwing. token.get() returns this shape (type 'no_tokens'/auth_error) when the
// user is not signed in. Treat any object carrying a truthy `error` as a failure.
export function isSdkError(result) {
  return !result || (typeof result === "object" && Boolean(result.error));
}
