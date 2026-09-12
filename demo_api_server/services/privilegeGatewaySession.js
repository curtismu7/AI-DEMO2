'use strict';

/**
 * The façade's upstream leg to the Privilege AI Gateway, one session per
 * Agentic App.
 *
 * WHY THIS EXISTS. Standalone MCP clients (LM Studio) register themselves with
 * whatever authorization server a door advertises. The gateway keeps its RFC
 * 7591 client registry in MEMORY — verified 2026-09-02, there is no on-disk
 * store in the container — so every gateway restart forgets every client, and a
 * client that cached its registration dead-ends on a bare "Unknown client" page
 * until a human deletes and re-adds the integration.
 *
 * The fix is to stop pointing those clients at the gateway. A door backed by
 * this module advertises OUR durable authorization server instead and keeps the
 * gateway leg server-side, where the BFF already re-registers itself when the
 * gateway forgets it (see isDcrClientStillKnown in routes/privilegeMcpClient.js).
 * The client's own registration then never breaks.
 *
 * HOW A SESSION ARRIVES. The gateway offers only authorization_code and
 * refresh_token — no client_credentials — and issues no refresh token (its
 * metadata has no offline_access), so every session is one browser sign-in and
 * lasts one access-token lifetime: 60 minutes, measured 2026-09-11. Two
 * sign-ins hand one over: /privilege-mcp-client in Privilege mode, and the MCP
 * client's own OAuth, which the broker chains through
 * /api/privilege-mcp/facade-link (see
 * docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md).
 *
 * ONE PER APP. The gateway binds a token to the Agentic App it was minted for,
 * so each app keeps its own session. A call with no app means the default door
 * app, which keeps every caller written before this split working unchanged.
 *
 * PERSISTED. This used to be deliberately in-memory, "a credential at rest for
 * no demo benefit". The benefit turned out to be real: several sessions share
 * one stack, so the BFF container is recreated often, and each recreate threw a
 * live session away. The same token is already persisted in the LMDB session
 * store (CLEAR_SESSIONS_ON_BOOT=false) and lives at most an hour, so this copy
 * adds no new kind of secret at rest. Writes are best-effort: LMDB near its
 * mapSize must not break the in-memory session.
 *
 * ponytail: one operator identity per app; key it per user if a second identity
 * ever needs this door.
 */

// Refresh this far before expiry so a call never races the clock.
const REFRESH_SKEW_MS = 60_000;

const sessions = new Map();
let loaded = false;
let storeOverride; // see __setStore

/** The app a door URL with no app segment means. */
function defaultApp() {
  return process.env.MCP_FACADE_PRIVILEGE_GATEWAY_APP || 'opensearch22';
}

function keyFor(app) {
  return app || defaultApp();
}

function store() {
  if (storeOverride !== undefined) return storeOverride;
  // Jest runs suites in parallel against one LMDB file, so persisting under
  // test would leak one suite's session into another. Suites that cover
  // persistence inject a store with __setStore.
  if (process.env.NODE_ENV === 'test') return null;
  return require('./lmdb/privilegeGatewaySessionStore.lmdb');
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const s = store();
  if (!s) return;
  try {
    for (const [app, record] of Object.entries(s.loadAll())) {
      // A session past expiry with no refresh token can never serve a call
      // again; do not resurrect it into a fresh process.
      const dead = record && !record.refreshToken && record.expiresAt <= Date.now();
      if (record?.accessToken && record.tokenUri && !dead) sessions.set(app, record);
    }
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not load persisted sessions:', err.message);
  }
}

function persist(app) {
  const s = store();
  if (!s) return;
  try {
    const record = sessions.get(app);
    if (record) s.save(app, record);
    else s.remove(app);
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not persist session:', err.message);
  }
}

/**
 * Record a gateway session established by an interactive sign-in.
 * Called on every successful authorization-code exchange and refresh.
 */
function remember({ app, accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret }) {
  if (!accessToken || !tokenUri) return;
  ensureLoaded();
  const key = keyFor(app);
  sessions.set(key, {
    accessToken,
    refreshToken: refreshToken || null,
    tokenUri,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    // A token with no expires_in is treated as short-lived rather than eternal.
    expiresAt: Date.now() + (Number(expiresIn) > 0 ? Number(expiresIn) * 1000 : 300_000),
  });
  persist(key);
}

/** Drop one app's session — the default app's when none is named. */
function clear(app) {
  ensureLoaded();
  const key = keyFor(app);
  sessions.delete(key);
  persist(key);
}

/** Drop every app's session. */
function clearAll() {
  ensureLoaded();
  for (const key of [...sessions.keys()]) {
    sessions.delete(key);
    persist(key);
  }
}

function statusOf(current) {
  if (!current) return { ready: false, reason: 'no_session' };
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return { ready: true };
  return { ready: Boolean(current.refreshToken), reason: current.refreshToken ? 'refreshable' : 'expired' };
}

/** What the door reports when it cannot serve a request, for the operator. */
function status(app) {
  ensureLoaded();
  return statusOf(sessions.get(keyFor(app)));
}

/** status() for every app that holds a session. */
function statusAll() {
  ensureLoaded();
  return Object.fromEntries([...sessions].map(([app, record]) => [app, statusOf(record)]));
}

async function refresh(key) {
  const current = sessions.get(key);
  if (!current?.refreshToken) return null;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });
  if (current.clientId) form.set('client_id', current.clientId);
  if (current.clientSecret) form.set('client_secret', current.clientSecret);

  let response;
  try {
    response = await fetch(current.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    // Network trouble is not proof the session is dead — keep it and let the
    // next call try again.
    return null;
  }
  if (!response.ok) {
    // The gateway restarted (client gone) or the refresh token expired. Either
    // way this session can never be revived; drop it so status() tells the
    // operator to sign in again instead of failing opaquely forever.
    clear(key);
    return null;
  }
  let data;
  try { data = JSON.parse(await response.text()); } catch { return null; }
  if (!data.access_token) return null;

  remember({
    app: key,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresIn: data.expires_in,
    tokenUri: current.tokenUri,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
  });
  return sessions.get(key).accessToken;
}

/** A usable gateway access token for an app, or null when a human must sign in again. */
async function getAccessToken(app) {
  ensureLoaded();
  const key = keyFor(app);
  const current = sessions.get(key);
  if (!current) return null;
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return current.accessToken;
  return refresh(key);
}

/** Test seam: back the module with a fake store (`undefined` restores the default). */
function __setStore(s) {
  storeOverride = s;
  loaded = false;
  sessions.clear();
}

// Tokens the link flow has minted but not yet committed. They become the app's
// session only when the broker confirms, at /oauth/resume, that the browser
// finishing the sign-in is the one that started the authorize
// (/internal/privilege-link/commit). Deliberately in-memory and never
// persisted: an uncommitted token belongs to nobody yet.
const PENDING_TTL_MS = 600_000;
const pendingLinks = new Map();

// A discard can land before its park: /oauth/resume consumes the resume record
// first, so a deny can run while the BFF's sign-in is still in flight. Remember
// the id briefly so the park that arrives afterwards is refused instead of held,
// uncommittable, until its TTL.
const discardedLinks = new Map();

/** Park a link's gateway token under its broker resume id. */
function rememberPending(id, record) {
  if (!id || !record?.accessToken || !record?.tokenUri) return;
  for (const [key, parked] of pendingLinks) {
    if (parked.expiresAt <= Date.now()) pendingLinks.delete(key);
  }
  for (const [key, expiresAt] of discardedLinks) {
    if (expiresAt <= Date.now()) discardedLinks.delete(key);
  }
  if (discardedLinks.has(id)) return;
  // First park wins. A second under the same id is a different browser's
  // sign-in landing on a slot someone else already filled — never legitimate,
  // since the broker mints each resume id once.
  if (pendingLinks.has(id)) return;
  pendingLinks.set(id, { ...record, expiresAt: Date.now() + PENDING_TTL_MS });
}

/** Promote a parked token into its app's session. Single use; null when the id
 *  is unknown or expired. */
function commitPending(id) {
  const parked = id ? pendingLinks.get(id) : null;
  if (!parked) return null;
  pendingLinks.delete(id);
  if (parked.expiresAt <= Date.now()) return null;
  const { expiresAt, ...record } = parked;
  remember(record);
  return { app: keyFor(record.app) };
}

/** Drop a parked token — the broker refused to commit this link. */
function discardPending(id) {
  if (!id) return;
  pendingLinks.delete(id);
  discardedLinks.set(id, Date.now() + PENDING_TTL_MS);
}

module.exports = {
  remember, clear, clearAll, status, statusAll, getAccessToken, defaultApp, __setStore,
  rememberPending, commitPending, discardPending,
};
