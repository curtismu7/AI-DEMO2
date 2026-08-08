const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
// The healthcare vertical's live, in-memory per-user store (module singleton).
// Reading/writing through this same instance keeps the admin ops view coherent
// with the data the healthcare tools mutate. Note: the agent path keys this
// store by req.user.sub, whereas admin ops keys by the selected demo user's
// local id — so admin ops is its own internally-consistent surface, not a
// mirror of a given user's live chat session.
const healthcare = require('../config/verticals/healthcare');
const retail = require('../config/verticals/retail');
const sportingGoods = require('../config/verticals/sporting-goods');
const workforce = require('../config/verticals/workforce');
// Reads this session's own record of what it was granted — no signature check
// needed, and none performed.
const { decodeJwt } = require('../utils/tokenUtils');

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

for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']) {
  router.get(`/${vertical}/users`, listLookupUsers(vertical));
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
function writeAction(plugin, method, noun) {
  return (req, res) => {
    const userId = req.body?.userId;
    const id = req.params.id;
    if (!userId) return res.status(400).json({ ok: false, error: 'userId is required' });
    if (!isKnownUser(userId)) return res.status(404).json({ ok: false, error: 'unknown user' });
    const item = plugin.getDataStore()[method](String(userId), id);
    if (!item) return res.status(404).json({ ok: false, error: `${noun} not found` });
    res.json({ ok: true, item });
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
    console.error('banking lookup error:', error);
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

// POST /<vertical>/verify/initiate — start a challenge against the customer's
// registered device. The demo completes it synchronously; a deployment wired to
// a real CIBA channel would flip `ok` to false and let the client poll /status.
function verifyInitiate(req, res) {
  const customerId = req.body?.customerId;
  if (!customerId) return res.status(400).json({ ok: false, error: 'customerId is required' });
  if (!isKnownUser(customerId)) return res.status(404).json({ ok: false, error: 'unknown user' });
  const expiresAt = markCustomerVerified(req, customerId);
  res.json({
    ok: true,
    customerId: String(customerId),
    channel: 'device-otp',
    expiresIn: SUPPORT_VERIFY_TTL_MS,
    expiresAt,
  });
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

// Vertical Ops are open to any authenticated user. The /api/admin mount applies
// authenticateToken upstream, so req.user is populated; no admin role/scope gate
// is required here. (Spreads to no extra middleware.)
const ADMIN_WRITE = [];

for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']) {
  router.post(`/${vertical}/verify/initiate`, ...ADMIN_WRITE, verifyInitiate);
  router.get(`/${vertical}/verify/status`, ...ADMIN_WRITE, verifyStatus);
  router.get(`/${vertical}/permissions`, ...ADMIN_WRITE, permissionsFor);
}

router.get('/banking/lookup', ...ADMIN_WRITE, bankingLookup);

router.get('/healthcare/lookup', ...ADMIN_WRITE, lookupAction(healthcare, 'healthcare', {
  patientRecords: 'patientRecords', appointments: 'appointments', billingHistory: 'billingHistory',
  medications: 'medications', referrals: 'referrals', coverage: 'coverage',
}));
router.post('/healthcare/appointments/:id/cancel', ...ADMIN_WRITE, writeAction(healthcare, 'cancelAppointment', 'appointment'));
router.post('/healthcare/bills/:id/pay', ...ADMIN_WRITE, writeAction(healthcare, 'payBill', 'bill'));
router.post('/healthcare/medications/:id/refill', ...ADMIN_WRITE, writeAction(healthcare, 'refillPrescription', 'medication'));
router.post('/healthcare/records/:id/release', ...ADMIN_WRITE, writeAction(healthcare, 'markRecordReleased', 'record'));
router.post('/healthcare/referrals/:id/cancel', ...ADMIN_WRITE, writeAction(healthcare, 'cancelReferral', 'referral'));

router.get('/retail/lookup', ...ADMIN_WRITE, lookupAction(retail, 'retail', {
  orders: 'orders', returns: 'returns', subscriptions: 'subscriptions',
  support_tickets: 'support_tickets', rewards: 'rewards',
}));
router.post('/retail/orders/:id/cancel', ...ADMIN_WRITE, writeAction(retail, 'cancelOrder', 'order'));
router.post('/retail/subscriptions/:id/cancel', ...ADMIN_WRITE, writeAction(retail, 'cancelSubscription', 'subscription'));
router.post('/retail/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(retail, 'resolveTicket', 'ticket'));
router.post('/retail/returns/:id/approve', ...ADMIN_WRITE, writeAction(retail, 'approveReturn', 'return'));

router.get('/sporting-goods/lookup', ...ADMIN_WRITE, lookupAction(sportingGoods, 'sporting-goods', {
  orders: 'orders', rentals: 'rentals', support_tickets: 'support_tickets',
  coaching_sessions: 'coaching_sessions', loyalty: 'loyalty',
}));
router.post('/sporting-goods/orders/:id/cancel', ...ADMIN_WRITE, writeAction(sportingGoods, 'cancelOrder', 'order'));
router.post('/sporting-goods/rentals/:id/return', ...ADMIN_WRITE, writeAction(sportingGoods, 'returnRental', 'rental'));
router.post('/sporting-goods/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(sportingGoods, 'resolveTicket', 'ticket'));
router.post('/sporting-goods/coaching/:id/cancel', ...ADMIN_WRITE, writeAction(sportingGoods, 'cancelCoaching', 'coaching session'));

router.get('/workforce/lookup', ...ADMIN_WRITE, lookupAction(workforce, 'workforce', {
  expenses: 'expenses', tickets: 'tickets', trainings: 'trainings', pto: 'pto', benefits: 'benefits',
}));
router.post('/workforce/expenses/:id/approve', ...ADMIN_WRITE, writeAction(workforce, 'approveExpense', 'expense'));
router.post('/workforce/expenses/:id/deny', ...ADMIN_WRITE, writeAction(workforce, 'denyExpense', 'expense'));
router.post('/workforce/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(workforce, 'resolveTicket', 'ticket'));
router.post('/workforce/trainings/:id/complete', ...ADMIN_WRITE, writeAction(workforce, 'completeTraining', 'training'));

module.exports = router;
// Exposed for the gated-write middleware and its tests without changing what
// server.js mounts.
module.exports.__verify = {
  markCustomerVerified,
  isCustomerVerified,
  verificationExpiry,
  SUPPORT_VERIFY_TTL_MS,
};
