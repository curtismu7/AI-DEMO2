'use strict';

/**
 * The façade's upstream leg to the Agent Privilege, one session per
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
 * ONE PER APP AND USER. The gateway binds a token to the Agentic App it was
 * minted for, so each app keeps its own session; and a session serves only the
 * PingOne user it was linked for (`sub`), so one person's gateway identity is
 * never the credential another caller's tools run under. A call with no app
 * means the default door app. A call with no sub reads the slot a sign-in with
 * no known user wrote — no façade caller, who always has a sub, can reach it.
 *
 * PERSISTED. This used to be deliberately in-memory, "a credential at rest for
 * no demo benefit". The benefit turned out to be real: several sessions share
 * one stack, so the BFF container is recreated often, and each recreate threw a
 * live session away. The same token is already persisted in the LMDB session
 * store (CLEAR_SESSIONS_ON_BOOT=false) and lives at most an hour, so this copy
 * adds no new kind of secret at rest. Writes are best-effort: LMDB near its
 * mapSize must not break the in-memory session.
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

// App names are [A-Za-z0-9._-], so `|` cannot collide with one.
function keyFor(app, sub) {
  const name = app || defaultApp();
  return sub ? `${name}|${sub}` : name;
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
    for (const [key, record] of Object.entries(s.loadAll())) {
      // A session past expiry with no refresh token can never serve a call
      // again; do not resurrect it into a fresh process.
      const dead = record && !record.refreshToken && record.expiresAt <= Date.now();
      // Records written before sessions were per user carry no `app`; their key is it.
      if (record?.accessToken && record.tokenUri && !dead) sessions.set(key, { app: key, ...record });
    }
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not load persisted sessions:', err.message);
  }
}

function persist(key) {
  const s = store();
  if (!s) return;
  try {
    const record = sessions.get(key);
    if (record) s.save(key, record);
    else s.remove(key);
  } catch (err) {
    console.warn('[privilegeGatewaySession] could not persist session:', err.message);
  }
}

/**
 * Record a gateway session established by an interactive sign-in.
 * Called on every successful authorization-code exchange and refresh.
 */
function remember({ app, sub, accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret }) {
  if (!accessToken || !tokenUri) return;
  ensureLoaded();
  const key = keyFor(app, sub);
  sessions.set(key, {
    app: app || defaultApp(),
    sub: sub || null,
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

function drop(key) {
  sessions.delete(key);
  persist(key);
}

/** Drop one user's session for an app — the default app's when none is named. */
function clear(app, sub) {
  ensureLoaded();
  drop(keyFor(app, sub));
}

/** Drop every app's session. */
function clearAll() {
  ensureLoaded();
  for (const key of [...sessions.keys()]) drop(key);
}

function statusOf(current) {
  if (!current) return { ready: false, reason: 'no_session' };
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return { ready: true };
  return { ready: Boolean(current.refreshToken), reason: current.refreshToken ? 'refreshable' : 'expired' };
}

/** What the door reports when it cannot serve a request, for the operator. */
function status(app, sub) {
  ensureLoaded();
  return statusOf(sessions.get(keyFor(app, sub)));
}

/** status() for every app this user holds a session for, keyed by app. */
function statusAll(sub) {
  ensureLoaded();
  return Object.fromEntries([...sessions.values()]
    .filter((record) => (record.sub || null) === (sub || null))
    .map((record) => [record.app, statusOf(record)]));
}

// Operator diagnostics only (the readiness check): whichever user's session for
// this app is usable. Never a path a façade caller's tool call takes.
function anyKeyFor(app) {
  const name = app || defaultApp();
  for (const [key, record] of sessions) if (record.app === name && statusOf(record).ready) return key;
  return name;
}

function statusAny(app) {
  ensureLoaded();
  return statusOf(sessions.get(anyKeyFor(app)));
}

function getAnyAccessToken(app) {
  ensureLoaded();
  return tokenFor(anyKeyFor(app));
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
    drop(key);
    return null;
  }
  let data;
  try { data = JSON.parse(await response.text()); } catch { return null; }
  if (!data.access_token) return null;

  remember({
    app: current.app,
    sub: current.sub,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresIn: data.expires_in,
    tokenUri: current.tokenUri,
    clientId: current.clientId,
    clientSecret: current.clientSecret,
  });
  return sessions.get(key).accessToken;
}

async function tokenFor(key) {
  const current = sessions.get(key);
  if (!current) return null;
  if (current.expiresAt - REFRESH_SKEW_MS > Date.now()) return current.accessToken;
  return refresh(key);
}

/** A usable gateway access token for this user on an app, or null when they must sign in again. */
async function getAccessToken(app, sub) {
  ensureLoaded();
  return tokenFor(keyFor(app, sub));
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

// A commit can be applied here while its answer never reaches the broker (lost,
// or past the broker's 3s timeout). The broker then tells the client sign-in
// failed and sends a discard. Remember each commit briefly — what it installed
// and what it replaced — so that discard can put the app's session back instead
// of leaving it holding an identity the client was told it did not get.
const COMMIT_UNDO_MS = 60_000;
const committedLinks = new Map();

/** Drop expired entries from all three maps — parks, the tombstones that block
 *  a late park, and undo records. Runs on both write paths so none can grow
 *  unbounded. */
function sweepLinks(now) {
  for (const [key, parked] of pendingLinks) if (parked.expiresAt <= now) pendingLinks.delete(key);
  for (const [key, until] of discardedLinks) if (until <= now) discardedLinks.delete(key);
  for (const [key, committed] of committedLinks) if (committed.until <= now) committedLinks.delete(key);
}

/** Park a link's gateway token under its broker resume id. */
function rememberPending(id, record) {
  if (!id || !record?.accessToken || !record?.tokenUri) return;
  sweepLinks(Date.now());
  if (discardedLinks.has(id)) return;
  // First park wins. A second under the same id is a different browser's
  // sign-in landing on a slot someone else already filled — never legitimate,
  // since the broker mints each resume id once.
  if (pendingLinks.has(id)) return;
  pendingLinks.set(id, {
    ...record,
    expiresAt: Date.now() + PENDING_TTL_MS,
    // The park's TTL and the TOKEN's lifetime are different clocks. Keep the
    // token's absolute expiry so promoting it later does not restart it.
    tokenExpiresAt: Date.now() + (Number(record.expiresIn) > 0 ? Number(record.expiresIn) * 1000 : 300_000),
  });
}

/** Promote a parked token into its app's session. Single use; null when the id
 *  is unknown or expired. */
function commitPending(id) {
  const parked = id ? pendingLinks.get(id) : null;
  if (!parked) return null;
  pendingLinks.delete(id);
  if (parked.expiresAt <= Date.now()) return null;
  const { expiresAt, tokenExpiresAt, ...record } = parked;
  const remainingSec = Math.max(1, Math.round((tokenExpiresAt - Date.now()) / 1000));
  const key = keyFor(record.app, record.sub);
  ensureLoaded();
  const previous = sessions.get(key) || null;
  remember({ ...record, expiresIn: remainingSec });
  committedLinks.set(id, { key, accessToken: record.accessToken, previous, until: Date.now() + COMMIT_UNDO_MS });
  return { app: record.app || defaultApp() };
}

/** Drop a parked token — the broker refused to commit this link. If the link
 *  was in fact committed moments ago, undo that commit: the broker has told the
 *  client the sign-in failed. */
function discardPending(id) {
  if (!id) return;
  sweepLinks(Date.now());
  pendingLinks.delete(id);
  discardedLinks.set(id, Date.now() + PENDING_TTL_MS);
  const committed = committedLinks.get(id);
  if (!committed) return;
  committedLinks.delete(id);
  // Only while the app still holds exactly what that commit installed — a
  // sign-in that happened since is not ours to remove.
  if (sessions.get(committed.key)?.accessToken !== committed.accessToken) return;
  if (committed.previous) sessions.set(committed.key, committed.previous);
  else sessions.delete(committed.key);
  persist(committed.key);
}

/** Test seam: current tombstone count, so a sweep-on-discard test doesn't
 *  need to poke at module-private state. */
function __discardedLinksSize() {
  return discardedLinks.size;
}

module.exports = {
  remember, clear, clearAll, status, statusAll, statusAny, getAccessToken, getAnyAccessToken, defaultApp, __setStore,
  rememberPending, commitPending, discardPending, __discardedLinksSize,
};
