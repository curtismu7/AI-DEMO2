const express = require('express');
const configStore = require('../services/configStore');
const router = express.Router();
const dataStore = require('../data/store');
// The healthcare vertical's live, in-memory per-user store (module singleton).
// Reading/writing through this same instance keeps the admin ops view coherent
// with the data the healthcare tools mutate. Note: the agent path keys this
// store by req.user.sub, whereas admin ops keys by the selected demo user's
// local id — so admin ops is its own internally-consistent surface, not a
// mirror of a given user's live chat session.
const { verticalManifest } = require('../services/verticalManifest');
// Registration reads seeds at module load. server.js inits the manifest before
// mounting this router, but the route tests require this file directly — so
// init here too. It's idempotent (guarded by an `initialized` flag).
verticalManifest.init();
// Reads this session's own record of what it was granted — no signature check
// needed, and none performed.
const { decodeJwt } = require('../utils/tokenUtils');
const { buildOperatorWriteChain, buildOperatorDenialChain } = require('../services/operatorTokenChain');
const supportDelegation = require('../services/supportDelegationService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const demoTrackService = require('../services/demoTrackService');

// The single real write scope on the enduser resource (scope-topology.json:
// "Super Banking API"). The console's per-vertical permission labels
// (transactions:write / general:write) are the client's advisory vocabulary;
// the delegated token asks for THIS scope. One map, one place.
const SUPPORT_WRITE_SCOPE = 'write';
// Applied PER ROUTE, never as router.use(): other routers share the
// /api/admin mount, and a router-level guard would 403 their traffic before
// Express could fall through to them.
const { requireAdmin } = require('../middleware/auth');

// Plugins for verticals that declare capabilities.adminOps with lookupMode
// 'plugin' (the default). Resolved lazily through verticalManifest.plugins so
// this file holds no per-vertical requires.
function pluginFor(id) {
  return verticalManifest.plugins.get(id) || null;
}

// Known demo users an operator can type into a vertical ops lookup box.
// The BFF user store is shared across verticals — accounts are seeded per
// user, not per vertical — so every vertical lists the same usernames.
function listLookupUsers(vertical) {
  return (_req, res) => {
    const users = dataStore.getAllUsers()
      .filter(u => u.isActive !== false && u.role !== 'admin' && u.username)
      .map(u => ({
        username: u.username,
        name: [u.firstName, u.lastName].filter(Boolean).join(' '),
        email: u.email || '',
      }));
    res.json({ users, vertical });
  };
}

// Lookup users for every vertical that declares capabilities.adminOps.
for (const v of verticalManifest.listAll()) {
  const seed = verticalManifest.loader.get(v.id);
  if (!seed?.manifest?.capabilities?.adminOps) continue;
  router.get(`/${v.id}/users`, requireAdmin, listLookupUsers(v.id));
}

// Resolve a free-text query (username, email, name fragment, or id) to a single
// demo user. Returns the user descriptor used as the healthcare store key.
function resolveUser(q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return null;
  const users = dataStore.getAllUsers().filter(u => u.role !== 'admin' && u.username);
  const match = users.find(u => {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
    return (u.username || '').toLowerCase().includes(needle)
      || (u.email || '').toLowerCase().includes(needle)
      || name.includes(needle)
      || String(u.id || '').toLowerCase() === needle;
  });
  if (!match) return null;
  return {
    id: String(match.id),
    username: match.username,
    name: [match.firstName, match.lastName].filter(Boolean).join(' '),
    email: match.email || '',
  };
}

// True when userId belongs to a real non-admin demo user — write actions
// only mutate a store keyed by a verified user id, not an arbitrary body value.
function isKnownUser(userId) {
  return dataStore.getAllUsers().some(u => u.role !== 'admin' && String(u.id) === String(userId));
}

// Write actions. Each takes { userId } in the body (the resolved user.id from
// lookup) and mutates that user's vertical store via the vertical's helpers.
// `sliceKey` names the slice the action operates on. Without it the existence
// check has to search every array in the customer's data, which accepts an id
// from an unrelated slice — a shipment id passed to the work-order release —
// and the fallback inside the mutator then writes to the wrong row anyway.
function writeAction(plugin, verticalId, method, noun, sliceKey) {
  return async (req, res) => {
    const userId = req.body?.userId;
    const id = req.params.id;
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    if (!isKnownUser(userId)) return res.status(404).json({ ok: false, error: 'unknown user' });
    // Refuse BEFORE calling the mutator, not after. Some mutators fall back to
    // "the first row still in a non-terminal state" when the id does not match
    // — manufacturing's releaseWorkOrder does — so a stale or repeated request
    // silently writes to a DIFFERENT record. Checking the returned row is too
    // late: the store has already been mutated.
    const store = plugin.getDataStore();
    const owned = store.get(String(userId)) || {};
    const searchable = sliceKey
      ? [owned[sliceKey]]
      : Object.values(owned);
    const existing = searchable
      .flatMap((slice) => (Array.isArray(slice) ? slice : []))
      .find((row) => String(row?.id) === String(id));
    if (!existing) return res.status(404).json({ ok: false, error: `${noun} not found` });

    // Real delegation: exchange subject=customer + actor=admin client for a
    // short-lived delegated token whose act claim names the operator's client.
    // Exchange failure aborts the write BEFORE the mutator — nothing mutates
    // under an unproven actor.
    let delegated = null;
    let exchangeEvent = null;
    try {
      const x = await supportDelegation.exchangeForWrite(req, { scope: SUPPORT_WRITE_SCOPE });
      delegated = {
        sub: x.delegatedClaims.sub || null,
        actSub: x.delegatedClaims.act?.sub || null,
        scope: x.delegatedClaims.scope || SUPPORT_WRITE_SCOPE,
        jti: x.delegatedClaims.jti || null,
        aud: x.delegatedClaims.aud || null,
      };
      exchangeEvent = supportDelegation.buildExchangeEvents({ delegatedClaims: x.delegatedClaims, request: x.request })[0];
    } catch (e) {
      demoTrackService.observeSupportEvent?.({ kind: 'exchange-failed' }, req.sessionID);
      // The refusal chain: session, the (live) verification, and the failed
      // exchange hop that stopped the write. Replaces the audit hop — the
      // exchange outcome IS the audit here; the mutator never ran.
      const tokenChain = buildOperatorDenialChain(req, {
        vertical: verticalId, customerId: String(userId), action: `${req.method} ${req.originalUrl}`,
      });
      tokenChain.splice(2, 1, {
        id: 'exchange', label: 'RFC 8693 exchange — act on behalf of', status: 'error',
        vertical: verticalId, claims: {}, explanation: e.message || 'Exchange failed — the write did not proceed.',
      });
      return res.status(e.status || 502).json({ ok: false, error: e.code || 'exchange_failed', message: e.message, tokenChain });
    }
    // The success stamp sits AFTER the try — inside it, a track-service throw
    // would land in the catch and abort a perfectly good exchange as 502.
    try { demoTrackService.observeSupportEvent?.({ kind: 'exchange-ok', detail: { actSub: delegated.actSub } }, req.sessionID); } catch { /* track observation is optional */ }

    const item = store[method](String(userId), id);
    if (!item) return res.status(404).json({ ok: false, error: `${noun} not found` });
    // Second layer: the id existed, but the mutator still returned a different
    // row than the one asked for.
    if (item.id !== undefined && String(item.id) !== String(id)) {
      return res.status(404).json({ ok: false, error: `${noun} not found` });
    }
    const action = `${req.method} ${req.originalUrl}`;
    recordAudit(req, {
      action,
      customerId: String(userId),
      outcome: 'ok',
    });
    // Stamps are strictly best-effort: a track failure must not 500 a write
    // the mutator and audit already committed.
    try { demoTrackService.observeSupportEvent?.({ kind: 'write-ok' }, req.sessionID); } catch { /* track observation is optional */ }
    // The write's own token-chain evidence — session, verification, the row's
    // before/after, the audit. What the console rail renders; see
    // services/operatorTokenChain.js.
    const tokenChain = buildOperatorWriteChain(req, {
      vertical: verticalId,
      customerId: String(userId),
      verifiedUntil: verificationExpiry(req, userId),
      action,
      row: item.id !== undefined ? item.id : id,
      beforeStatus: existing.status ?? null,
      afterStatus: item.status ?? null,
      request: { method: req.method, url: req.originalUrl },
      result: item,
    });
    // Insert the real-evidence hops: customer token + exchange, in wire order.
    // Stamp vertical on them like the operator hops — the console hides a
    // chain whose operator/ceremony events belong to a different vertical.
    const signonTokenEvent = supportDelegation.buildCustomerTokenEvent(req.session.support);
    const exchangeHop = { ...exchangeEvent, vertical: verticalId };
    signonTokenEvent.vertical = verticalId;
    tokenChain.splice(2, 0, signonTokenEvent, exchangeHop);
    // The audit hop records the delegated token's provenance.
    const audit = tokenChain[tokenChain.length - 1];
    audit.claims.actSub = delegated.actSub;
    audit.claims.jti = delegated.jti;
    audit.claims.delegatedScope = delegated.scope;
    res.json({ ok: true, item, delegated, tokenChain });
  };
}

// GET /<vertical>/lookup?q= — resolve the user and return the store slices that
// back this vertical's read tables. `slices` maps a response key to a store key.
// Every declared slice is seeded, so the `?? null` is only defensive; the read
// UI treats a null slice the same as an empty one.
function lookupAction(plugin, vertical, slices) {
  return (req, res) => {
    const query = req.query.q || '';
    const user = resolveUser(query);
    if (!user) return res.json({ user: null, query, vertical });
    const d = plugin.getDataStore().get(user.id);
    const data = {};
    for (const [outKey, storeKey] of Object.entries(slices)) {
      data[outKey] = d[storeKey] ?? null;
    }
    res.json({ user, query, vertical, data });
  };
}

// Banking's store is the global flat accounts/transactions store (keyed by
// account id, linked to a user via userId) rather than a per-user plugin store,
// so it can't use lookupAction directly. It still shares resolveUser — the piece
// the old bespoke handler lacked — so an operator can find a holder by
// name/username/email/id, and it keeps the original account-number/id search as
// a fallback so no lookup capability is lost. Response uses the same
// { user, query, vertical, data } envelope as the other verticals.
function accountsByNumberOrId(query) {
  const raw = String(query || '').trim();
  const qLower = raw.toLowerCase();
  const qDigits = raw.replace(/\D/g, '');
  return dataStore.getAllAccounts().filter((a) => {
    if (String(a.accountNumber).toLowerCase().includes(qLower)) return true;
    if (String(a.id).toLowerCase().includes(qLower)) return true;
    if (qDigits.length > 0 && String(a.accountNumber).replace(/\D/g, '').includes(qDigits)) return true;
    return false;
  });
}

function bankingAccountsFor(query) {
  const user = resolveUser(query);
  if (user) {
    const accounts = dataStore.getAllAccounts()
      .filter((a) => String(a.userId) === String(user.id));
    if (accounts.length) return { user, accounts };
    // The holder resolved but owns no accounts. The query might actually be an
    // account number that only coincidentally matched a user, so try the
    // account-number/id search; use its hits if any, otherwise keep showing the
    // resolved holder with an empty account list.
    const byNumber = accountsByNumberOrId(query);
    if (byNumber.length) return { user: null, accounts: byNumber };
    return { user, accounts: [] };
  }
  return { user: null, accounts: accountsByNumberOrId(query) };
}

function bankingLookup(req, res) {
  try {
    const query = req.query.q || '';
    if (!String(query).trim()) {
      return res.json({ user: null, query, vertical: 'banking', data: { accounts: [], transactions: [] } });
    }
    const { user, accounts } = bankingAccountsFor(query);
    const transactions = [];
    for (const acct of accounts) {
      for (const t of dataStore.getTransactionsByAccountId(acct.id)) {
        transactions.push({ ...t, _accountId: acct.id, _accountNumber: acct.accountNumber });
      }
    }
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ user, query, vertical: 'banking', data: { accounts, transactions: transactions.slice(0, 200) } });
  } catch (error) {
    console.error('banking lookup error:', error?.stack || String(error));
    res.status(500).json({ error: 'lookup_failed', message: error.message });
  }
}

// ── Customer verification ─────────────────────────────────────────────────────
// Records that THIS OPERATOR SESSION verified THIS CUSTOMER. Deliberately not
// req.session.stepUpVerified — that field records the operator's own MFA, and
// crediting it here would let an operator's MFA unlock writes against anyone.
// Not consumed single-use: one support call legitimately performs several
// writes, so the TTL is the bound.
const SUPPORT_VERIFY_TTL_MS = 15 * 60 * 1000;

function markCustomerVerified(req, customerId) {
  if (!req.session) return 0;
  if (!req.session.supportVerified) req.session.supportVerified = {};
  const expiresAt = Date.now() + SUPPORT_VERIFY_TTL_MS;
  req.session.supportVerified[String(customerId)] = expiresAt;
  return expiresAt;
}

function verificationExpiry(req, customerId) {
  const at = req.session?.supportVerified?.[String(customerId)];
  return typeof at === 'number' ? at : 0;
}

function isCustomerVerified(req, customerId) {
  return verificationExpiry(req, customerId) > Date.now();
}

// POST /<vertical>/verify/initiate — open the customer's REAL sign-on
// (headless pi.flow). The BFF submits the password from config; the flow
// stops at the customer's OTP device. The operator's browser never sees a
// token — only which masked contact the code went to.
async function verifyInitiate(req, res) {
  const customerId = req.body?.customerId;
  if (!customerId) return res.status(400).json({ ok: false, error: 'customerId is required' });
  const local = dataStore.getUserById(String(customerId));
  if (!local || local.role === 'admin') return res.status(404).json({ ok: false, error: 'unknown user' });
  let pingOneUserId = local.oauthId || null;
  if (!pingOneUserId) {
    try {
      const { user: linked } = await fetchPingOneUserByUsername(local.username);
      pingOneUserId = linked?.id || null;
    } catch (_) { pingOneUserId = null; }
  }
  if (!pingOneUserId) return res.status(409).json({ ok: false, error: 'customer_not_linked', message: `${local.username} has no PingOne account to sign on with.` });
  // Prefill: the saved customer login_hint (the sign-in modal's stored value)
  // is the demo's expected account — PingOne treats the hint as advisory
  // prefill, and the ceremony's own username stays the identity anchor. The
  // saved hint wins only as the flow's prefill when the lookup name is the
  // generic demo name; a distinctly looked-up customer is who they are.
  const storedHint = String(configStore.getEffective('last_login_hint_customer') || '').trim();
  const username = local.username || storedHint;
  try {
    const out = await supportDelegation.openCustomerSignon(req, {
      username, pingOneUserId, customerId: String(customerId),
    });
    res.json({ ok: true, customerId: String(customerId), ...out });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.code || 'pi_flow_failed', message: e.message });
  }
}

// POST /<vertical>/verify/otp — complete the customer's sign-on with the
// code from their device. Mints the customer token into session.support and
// marks the customer verified (the gate flag the ADMIN_WRITE middleware reads;
// Task 5 rewires it to liveSupportSession).
async function verifyOtp(req, res) {
  const verticalId = String(req.path || '').split('/').filter(Boolean)[0];
  try {
    const out = await supportDelegation.submitCustomerOtp(req, { otp: req.body?.otp });
    if (out.verified) markCustomerVerified(req, req.session.support?.customerId);
    // Stamp vertical like the write chain — the console hides foreign chains.
    const chain = [
      ...supportDelegation.buildSignonEvents(req.session.support),
      out.tokenEvent,
    ].map((e) => ({ ...e, vertical: verticalId }));
    res.json({ ok: true, verified: out.verified, expiresAt: out.expiresAt, tokenChain: chain });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.code || 'pi_flow_failed', message: e.message });
  }
}

// GET /<vertical>/verify/status?customerId=
function verifyStatus(req, res) {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  const expiresAt = verificationExpiry(req, customerId);
  res.json({
    customerId: String(customerId),
    verified: expiresAt > Date.now(),
    expiresAt,
  });
}

// GET /<vertical>/permissions — the operator's granted scopes.
//
// Admin login writes req.session.loginIntrospection.scopes in routes/oauth.js,
// but that write is fire-and-forget and non-fatal, so it can be missing. Fall
// back to the access token's own scope claim, and report which source answered.
// `source: 'none'` means "could not read", NOT "has none" — the client must not
// render that as a blanket denial.
function operatorScopes(req) {
  const introspected = req.session?.loginIntrospection?.scopes;
  if (Array.isArray(introspected) && introspected.length) {
    return { scopes: introspected, source: 'introspection' };
  }
  const accessToken = req.session?.oauthTokens?.accessToken;
  if (accessToken) {
    // decodeJwt returns { header, claims } — not the payload itself.
    const raw = decodeJwt(accessToken)?.claims?.scope;
    if (typeof raw === 'string' && raw.trim()) {
      return { scopes: raw.trim().split(/\s+/), source: 'token' };
    }
    if (Array.isArray(raw) && raw.length) {
      return { scopes: raw, source: 'token' };
    }
  }
  return { scopes: [], source: 'none' };
}

function permissionsFor(req, res) {
  res.json(operatorScopes(req));
}

// ── Operator audit ────────────────────────────────────────────────────────────
// In-memory, per process, same lifetime as the other demo stores. A denial that
// leaves no trace is worse than no audit at all, so denials are recorded too.
const auditLog = new Map(); // customerId -> entries[]

function recordAudit(req, entry) {
  const key = String(entry.customerId);
  if (!auditLog.has(key)) auditLog.set(key, []);
  auditLog.get(key).push({
    at: new Date().toISOString(),
    operator: req.user?.sub || req.user?.username || 'unknown',
    ...entry,
  });
}

function auditFor(req, res) {
  const customerId = req.query.customerId;
  if (!customerId) return res.status(400).json({ error: 'customerId is required' });
  res.json({
    vertical: req.baseUrl.split('/').pop(),
    data: { entries: auditLog.get(String(customerId)) || [] },
  });
}

const { makeRequireCustomerVerified } = require('../middleware/requireCustomerVerified');

// Every vertical write requires a live verification for the targeted customer.
// This array was previously empty — the routes were open to any authenticated
// user. Removing this middleware must turn the "verification is enforced"
// tests red; that is the proof the gate is real and not decorative.
const ADMIN_WRITE = [requireAdmin, makeRequireCustomerVerified({ isCustomerVerified, recordAudit, liveSupportSession: supportDelegation.liveSupportSession, observeSupportEvent: demoTrackService.observeSupportEvent })];

// ── Capability-driven registration (T4) ──────────────────────────────────────
// Route URLs, methods, and guards are unchanged from the pre-T4 hardcoded
// registration; what changed is WHERE the per-vertical data lives: each
// vertical's manifest.json declares it under capabilities.adminOps, so a new
// vertical opts in with config, not edits to this file. A vertical without the
// block registers no per-vertical routes at all (not disabled ones — none).
//
// Verify/permissions/audit/queue are registered for every declaring vertical;
// lookup and writes come from lookupSlices/writes. Banking uses
// lookupMode 'banking' (global accounts store, not a per-user plugin store).
// investment declares writes: [] deliberately — its only mutators are trades,
// which is not a support operator's authority; abercrombie-fitch's store
// exposes no mutators at all. Neither registers a write route.
//
// Queue rules moved into the manifests too. A projection over each vertical's
// existing slices, not a new store — every row traces to a record really in
// that state. banking and investment declare no rules deliberately: banking's
// store is the global accounts/transactions one with no open states in its
// seed; investment's trades are all 'Settled' or 'Posted'. Inventing flags to
// fill those queues would mean fabricating demo data.

// queueRule.title is a declared projection { field, fallback } evaluated here —
// the manifest stays plain data and never ships executable code.
function queueTitle(rule, row) {
  return row[rule.title.field] || rule.fallback || rule.title.field;
}

for (const v of verticalManifest.listAll()) {
  const seed = verticalManifest.loader.get(v.id);
  const ops = seed?.manifest?.capabilities?.adminOps;
  if (!ops) continue;
  const id = v.id;

  router.post(`/${id}/verify/initiate`, ...ADMIN_WRITE, verifyInitiate);
  router.post(`/${id}/verify/otp`, ...ADMIN_WRITE, verifyOtp);
  router.get(`/${id}/verify/status`, ...ADMIN_WRITE, verifyStatus);
  router.get(`/${id}/permissions`, ...ADMIN_WRITE, permissionsFor);
  router.get(`/${id}/audit`, auditFor);
  router.get(`/${id}/queue`, requireAdmin, (req, res, next) => {
    req.queueVertical = id;
    return queueFor(req, res, next);
  });

  if (ops.lookupMode === 'banking') {
    router.get(`/${id}/lookup`, requireAdmin, bankingLookup);
  } else if (ops.lookupSlices) {
    const plugin = pluginFor(id);
    if (plugin) {
      router.get(`/${id}/lookup`, requireAdmin, lookupAction(plugin, id, ops.lookupSlices));
      for (const w of ops.writes || []) {
        router[`${w.method}`](`/${id}/${w.route}`, ...ADMIN_WRITE,
          writeAction(plugin, id, w.mutator, w.noun, w.sliceKey));
      }
    }
  }
}

// ── Support queue ─────────────────────────────────────────────────────────────
// Rules now come from each vertical's manifest (capabilities.adminOps.queueRules);
// the projection logic lives here. See the registration block above for why
// banking and investment intentionally declare none.

// GET /<vertical>/queue — open work across the demo customers this vertical lists.
function queueFor(req, res) {
  const vertical = req.baseUrl.split('/').pop() || req.params.vertical;
  const seed = verticalManifest.loader.get(req.queueVertical || vertical);
  const rules = seed?.manifest?.capabilities?.adminOps?.queueRules || [];
  const plugin = pluginFor(req.queueVertical || vertical);
  if (!plugin || rules.length === 0) {
    return res.json({ vertical: req.queueVertical || vertical, data: { rows: [] } });
  }

  const customers = dataStore.getAllUsers()
    .filter((u) => u.isActive !== false && u.role !== 'admin' && u.username);

  const rows = [];
  for (const u of customers) {
    const data = plugin.getDataStore().get(String(u.id)) || {};
    for (const rule of rules) {
      for (const row of data[rule.slice] || []) {
        if (!rule.open.includes(String(row.status || '').toLowerCase())) continue;
        rows.push({
          customerId: String(u.id),
          customerName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
          customerQuery: u.username,
          category: rule.slice,
          categoryLabel: rule.label,
          id: String(row.id),
          title: queueTitle(rule, row),
          status: row.status,
        });
      }
    }
  }
  res.json({ vertical: req.queueVertical || vertical, data: { rows } });
}

// ── Case notes ────────────────────────────────────────────────────────────────
// In-memory, keyed `<vertical>:<customerId>`. Not gated on verification: a note
// records what happened on the call, it does not change customer data, and
// gating it would push operators to keep notes somewhere else.
//
// Registered after the five per-vertical loops above — `/:vertical/...` is a
// wildcard and an earlier registration would shadow the explicit routes.
const caseNotes = new Map();

function notesKey(vertical, customerId) {
  return `${vertical}:${customerId}`;
}

function listNotes(req, res) {
  const vertical = req.params.vertical;
  const key = notesKey(vertical, req.params.customerId);
  res.json({ vertical, data: { notes: caseNotes.get(key) || [] } });
}

function addNote(req, res) {
  const vertical = req.params.vertical;
  const { customerId } = req.params;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'note body is required' });
  if (!isKnownUser(customerId)) return res.status(404).json({ error: 'unknown user' });

  const key = notesKey(vertical, customerId);
  if (!caseNotes.has(key)) caseNotes.set(key, []);
  const note = {
    id: `${key}:${caseNotes.get(key).length + 1}`,
    at: new Date().toISOString(),
    operator: req.user?.sub || req.user?.username || 'unknown',
    body,
  };
  caseNotes.get(key).push(note);
  res.json({ ok: true, note });
}

router.get('/:vertical/cases/:customerId/notes', requireAdmin, listNotes);
router.post('/:vertical/cases/:customerId/notes', requireAdmin, addNote);

module.exports = router;
// Exposed for the gated-write middleware and its tests without changing what
// server.js mounts.
module.exports.__verify = {
  markCustomerVerified,
  isCustomerVerified,
  verificationExpiry,
  SUPPORT_VERIFY_TTL_MS,
};
