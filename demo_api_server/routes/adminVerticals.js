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
const university = require('../config/verticals/university');
const government = require('../config/verticals/government');
const manufacturing = require('../config/verticals/manufacturing');
const investment = require('../config/verticals/investment');
const abercrombieFitch = require('../config/verticals/abercrombie-fitch');
// Reads this session's own record of what it was granted — no signature check
// needed, and none performed.
const { decodeJwt } = require('../utils/tokenUtils');
// Applied PER ROUTE, never as router.use(): other routers share the
// /api/admin mount, and a router-level guard would 403 their traffic before
// Express could fall through to them.
const { requireAdmin } = require('../middleware/auth');

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

for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce',
  'university', 'government', 'manufacturing', 'investment', 'abercrombie-fitch']) {
  router.get(`/${vertical}/users`, requireAdmin, listLookupUsers(vertical));
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
function writeAction(plugin, method, noun, sliceKey) {
  return (req, res) => {
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
    const rowExists = searchable.some(
      (slice) => Array.isArray(slice) && slice.some((row) => String(row?.id) === String(id)),
    );
    if (!rowExists) return res.status(404).json({ ok: false, error: `${noun} not found` });

    const item = store[method](String(userId), id);
    if (!item) return res.status(404).json({ ok: false, error: `${noun} not found` });
    // Second layer: the id existed, but the mutator still returned a different
    // row than the one asked for.
    if (item.id !== undefined && String(item.id) !== String(id)) {
      return res.status(404).json({ ok: false, error: `${noun} not found` });
    }
    recordAudit(req, {
      action: `${req.method} ${req.originalUrl}`,
      customerId: String(userId),
      outcome: 'ok',
    });
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
const ADMIN_WRITE = [requireAdmin, makeRequireCustomerVerified({ isCustomerVerified, recordAudit })];

for (const vertical of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce',
  'university', 'government', 'manufacturing', 'investment', 'abercrombie-fitch']) {
  router.post(`/${vertical}/verify/initiate`, ...ADMIN_WRITE, verifyInitiate);
  router.get(`/${vertical}/verify/status`, ...ADMIN_WRITE, verifyStatus);
  router.get(`/${vertical}/permissions`, ...ADMIN_WRITE, permissionsFor);
  router.get(`/${vertical}/audit`, auditFor);
  router.get(`/${vertical}/queue`, requireAdmin, (req, res, next) => {
    req.queueVertical = vertical;
    return queueFor(req, res, next);
  });
}

// Lookups stay open: an operator has to find the customer before verifying
// them. Only the writes below carry the gate.
router.get('/banking/lookup', requireAdmin, bankingLookup);

router.get('/healthcare/lookup', requireAdmin, lookupAction(healthcare, 'healthcare', {
  patientRecords: 'patientRecords', appointments: 'appointments', billingHistory: 'billingHistory',
  medications: 'medications', referrals: 'referrals', coverage: 'coverage',
}));
router.post('/healthcare/appointments/:id/cancel', ...ADMIN_WRITE, writeAction(healthcare, 'cancelAppointment', 'appointment'));
router.post('/healthcare/bills/:id/pay', ...ADMIN_WRITE, writeAction(healthcare, 'payBill', 'bill'));
router.post('/healthcare/medications/:id/refill', ...ADMIN_WRITE, writeAction(healthcare, 'refillPrescription', 'medication'));
router.post('/healthcare/records/:id/release', ...ADMIN_WRITE, writeAction(healthcare, 'markRecordReleased', 'record'));
router.post('/healthcare/referrals/:id/cancel', ...ADMIN_WRITE, writeAction(healthcare, 'cancelReferral', 'referral'));

router.get('/retail/lookup', requireAdmin, lookupAction(retail, 'retail', {
  orders: 'orders', returns: 'returns', subscriptions: 'subscriptions',
  support_tickets: 'support_tickets', rewards: 'rewards',
}));
router.post('/retail/orders/:id/cancel', ...ADMIN_WRITE, writeAction(retail, 'cancelOrder', 'order'));
router.post('/retail/subscriptions/:id/cancel', ...ADMIN_WRITE, writeAction(retail, 'cancelSubscription', 'subscription'));
router.post('/retail/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(retail, 'resolveTicket', 'ticket'));
router.post('/retail/returns/:id/approve', ...ADMIN_WRITE, writeAction(retail, 'approveReturn', 'return'));

router.get('/sporting-goods/lookup', requireAdmin, lookupAction(sportingGoods, 'sporting-goods', {
  orders: 'orders', rentals: 'rentals', support_tickets: 'support_tickets',
  coaching_sessions: 'coaching_sessions', loyalty: 'loyalty',
}));
router.post('/sporting-goods/orders/:id/cancel', ...ADMIN_WRITE, writeAction(sportingGoods, 'cancelOrder', 'order'));
router.post('/sporting-goods/rentals/:id/return', ...ADMIN_WRITE, writeAction(sportingGoods, 'returnRental', 'rental'));
router.post('/sporting-goods/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(sportingGoods, 'resolveTicket', 'ticket'));
router.post('/sporting-goods/coaching/:id/cancel', ...ADMIN_WRITE, writeAction(sportingGoods, 'cancelCoaching', 'coaching session'));

router.get('/workforce/lookup', requireAdmin, lookupAction(workforce, 'workforce', {
  expenses: 'expenses', tickets: 'tickets', trainings: 'trainings', pto: 'pto', benefits: 'benefits',
}));
router.post('/workforce/expenses/:id/approve', ...ADMIN_WRITE, writeAction(workforce, 'approveExpense', 'expense'));
router.post('/workforce/expenses/:id/deny', ...ADMIN_WRITE, writeAction(workforce, 'denyExpense', 'expense'));
router.post('/workforce/tickets/:id/resolve', ...ADMIN_WRITE, writeAction(workforce, 'resolveTicket', 'ticket'));
router.post('/workforce/trainings/:id/complete', ...ADMIN_WRITE, writeAction(workforce, 'completeTraining', 'training'));

// ── Phase 2 verticals ─────────────────────────────────────────────────────────
// Cards are curated from each seed rather than dumped: university and
// government seed 14 slices each, and a console showing all of them is noise.
// Only array-valued slices are cards — government's `fees` and manufacturing's
// `inventory` are objects and render nothing useful in a row list.
//
// Write actions are limited to mutators whose signature is (userId, itemId),
// which is what writeAction passes. The createSeedStore mutators shaped
// (data, {...}) — registerCourse, releaseTranscript, payFee, scheduleRun —
// would receive the row id where they expect an options object, silently fall
// back to a default row, and report success for an action the operator did not
// ask for. They stay unexposed until there is a parameter contract for them.

router.get('/university/lookup', requireAdmin, lookupAction(university, 'university', {
  courses: 'courses', billing: 'billing', holds: 'holds',
  financial_aid: 'financial_aid', enrollmentHistory: 'enrollmentHistory',
}));

router.get('/government/lookup', requireAdmin, lookupAction(government, 'government', {
  permits: 'permits', payments: 'payments', filings: 'filings',
  inspections: 'inspections', recordsRequests: 'recordsRequests',
}));
router.post('/government/permits/:id/release', ...ADMIN_WRITE, writeAction(government, 'releaseRecord', 'permit', 'permits'));

router.get('/manufacturing/lookup', requireAdmin, lookupAction(manufacturing, 'manufacturing', {
  workOrders: 'workOrders', maintenanceTickets: 'maintenanceTickets', shipments: 'shipments',
  qualityInspections: 'qualityInspections', purchaseOrders: 'purchaseOrders',
}));
router.post('/manufacturing/work-orders/:id/release', ...ADMIN_WRITE, writeAction(manufacturing, 'releaseWorkOrder', 'work order', 'workOrders'));

// Read-only. investment's only mutators are trades (buy/sell/deposit/withdraw),
// which is not a support operator's authority; abercrombie-fitch's store
// exposes no mutators at all. Neither registers a write route — not a disabled
// one, none.
router.get('/investment/lookup', requireAdmin, lookupAction(investment, 'investment', {
  portfolios: 'portfolios', holdings: 'holdings', trades: 'trades', dividends: 'dividends',
}));
router.get('/abercrombie-fitch/lookup', requireAdmin, lookupAction(abercrombieFitch, 'abercrombie-fitch', {
  orders: 'orders', returns: 'returns', support_tickets: 'support_tickets',
  rewards: 'rewards', gift_cards: 'gift_cards',
}));

// ── Support queue ─────────────────────────────────────────────────────────────
// A projection over each vertical's existing slices, not a new store. Every row
// traces to a record that is really in that state, so the queue cannot drift
// from the data and a vertical with nothing open renders an honest empty queue.
//
// Statuses are compared case-insensitively: sporting-goods seeds 'open' /
// 'in_progress' where retail seeds 'Open' / 'In Progress'.
//
// banking and investment declare no rules deliberately. Banking's store is the
// global accounts/transactions one rather than per-user slices, and its seed
// carries no open states at all — every account status is null and every
// transaction is 'completed'. Investment's trades are all 'Settled' or
// 'Posted'. Inventing flags to fill those queues would mean fabricating demo
// data; they stay empty until the seeds carry real open work.
const QUEUE_RULES = {
  banking: [],
  healthcare: [
    { slice: 'billingHistory', label: 'Billing', open: ['due', 'overdue'], title: (r) => r.description || 'Bill' },
    { slice: 'medications', label: 'Medications', open: ['on hold'], title: (r) => r.name || 'Medication' },
    { slice: 'referrals', label: 'Referrals', open: ['pending'], title: (r) => r.specialty || 'Referral' },
  ],
  retail: [
    { slice: 'returns', label: 'Returns', open: ['pending'], title: (r) => r.product || 'Return' },
    { slice: 'support_tickets', label: 'Support', open: ['open', 'in progress'], title: (r) => r.subject || 'Ticket' },
  ],
  'sporting-goods': [
    { slice: 'orders', label: 'Orders', open: ['processing'], title: (r) => r.product || 'Order' },
    { slice: 'support_tickets', label: 'Support', open: ['open', 'in_progress'], title: (r) => r.subject || 'Ticket' },
  ],
  workforce: [
    { slice: 'expenses', label: 'Expenses', open: ['pending', 'submitted'], title: (r) => r.description || 'Expense' },
    { slice: 'tickets', label: 'IT tickets', open: ['open', 'pending approval'], title: (r) => r.subject || 'Ticket' },
  ],
  university: [
    { slice: 'holds', label: 'Holds', open: ['active'], title: (r) => `${r.holdType || 'Hold'} hold` },
    { slice: 'billing', label: 'Billing', open: ['unpaid'], title: (r) => r.description || 'Charge' },
  ],
  government: [
    { slice: 'recordsRequests', label: 'Records requests', open: ['in review'], title: (r) => r.requestType || 'Request' },
    { slice: 'inspections', label: 'Inspections', open: ['failed'], title: (r) => r.type || 'Inspection' },
  ],
  manufacturing: [
    { slice: 'maintenanceTickets', label: 'Maintenance', open: ['open'], title: (r) => r.issue || 'Ticket' },
    { slice: 'purchaseOrders', label: 'Purchase orders', open: ['pending approval'], title: (r) => r.material || 'Purchase order' },
  ],
  investment: [],
  'abercrombie-fitch': [
    { slice: 'support_tickets', label: 'Support', open: ['open'], title: (r) => r.subject || 'Ticket' },
  ],
};

const VERTICAL_PLUGINS = {
  healthcare, retail, 'sporting-goods': sportingGoods, workforce,
  university, government, manufacturing, investment,
  'abercrombie-fitch': abercrombieFitch,
};

// GET /<vertical>/queue — open work across the demo customers this vertical lists.
function queueFor(req, res) {
  const vertical = req.baseUrl.split('/').pop() || req.params.vertical;
  const rules = QUEUE_RULES[req.queueVertical || vertical] || [];
  const plugin = VERTICAL_PLUGINS[req.queueVertical || vertical];
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
          title: rule.title(row),
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
