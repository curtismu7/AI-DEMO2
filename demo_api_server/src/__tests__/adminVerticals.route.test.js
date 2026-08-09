/**
 * @file adminVerticals.route.test.js
 * HTTP-level tests for the per-vertical admin Ops back-office endpoints in
 * routes/adminVerticals.js — lookup + write actions for retail, sporting-goods,
 * and workforce. Auth + the BFF user store are mocked; the vertical plugin
 * stores (seed.json singletons) are exercised for real.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Mock auth: admin passes unless a case flips mockAdminAllowed ──────────────
// `var` (not const/let) so the hoisted jest.mock factory can close over it.
var mockAdminAllowed = true;
jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => (
    mockAdminAllowed ? next() : res.status(403).json({ error: 'admin required' })
  ),
  requireScopes: () => (req, res, next) => next(),
}));
afterEach(() => { mockAdminAllowed = true; });

// ── Mock the BFF user store: one deterministic non-admin demo user ────────────
const DEMO_USER = {
  id: 'u1', username: 'demo', firstName: 'Demo', lastName: 'User',
  email: 'demo@example.com', role: 'customer', isActive: true,
};
// A second known customer, so a cross-customer denial can be told apart from
// "no such user". Nothing about casey matches the substring 'demo', so
// resolveUser('demo') still returns u1 and every lookup case is unaffected.
const SECOND_USER = {
  id: 'u2', username: 'casey', firstName: 'Casey', lastName: 'Stone',
  email: 'casey@example.com', role: 'customer', isActive: true,
};
jest.mock('../../data/store', () => ({
  getAllUsers: () => [DEMO_USER, SECOND_USER],
}));

const adminVerticals = require('../../routes/adminVerticals');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminVerticals);
  return app;
}

const app = makeApp();

// Find the first row in `items` whose status is NOT one of `terminal` (i.e. an
// item the matching write action will still act on), so tests are robust to the
// shared store accumulating mutations across cases.
function actionable(items, statusKey, terminal) {
  return (items || []).find((x) => !terminal.includes(x[statusKey]));
}

describe('admin vertical Ops — lookup', () => {
  it.each([
    ['retail', ['orders', 'returns', 'subscriptions', 'support_tickets', 'rewards']],
    ['sporting-goods', ['orders', 'rentals', 'support_tickets', 'coaching_sessions', 'loyalty']],
    ['workforce', ['expenses', 'tickets', 'trainings', 'pto', 'benefits']],
  ])('GET /%s/lookup resolves the user and returns the expected slices', async (vertical, slices) => {
    const r = await request(app).get(`/api/admin/${vertical}/lookup?q=demo`);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 'u1', username: 'demo' });
    expect(r.body.vertical).toBe(vertical);
    for (const key of slices) expect(r.body.data).toHaveProperty(key);
  });

  it('returns user:null when nothing matches', async () => {
    const r = await request(app).get('/api/admin/retail/lookup?q=nobody-here');
    expect(r.status).toBe(200);
    expect(r.body.user).toBeNull();
  });
});

describe('admin vertical Ops — write actions', () => {
  // [vertical, sliceKey, statusKey, terminalStatuses, actionPath(id), resolvedStatus]
  const CASES = [
    ['retail', 'orders', 'status', ['Cancelled', 'Delivered'], (id) => `orders/${id}/cancel`, 'Cancelled'],
    ['retail', 'returns', 'status', ['Refunded'], (id) => `returns/${id}/approve`, 'Refunded'],
    ['retail', 'subscriptions', 'status', ['Cancelled'], (id) => `subscriptions/${id}/cancel`, 'Cancelled'],
    ['retail', 'support_tickets', 'status', ['Resolved', 'Closed'], (id) => `tickets/${id}/resolve`, 'Resolved'],
    ['sporting-goods', 'orders', 'status', ['Cancelled', 'Delivered'], (id) => `orders/${id}/cancel`, 'Cancelled'],
    ['sporting-goods', 'rentals', 'status', ['Returned'], (id) => `rentals/${id}/return`, 'Returned'],
    ['sporting-goods', 'support_tickets', 'status', ['resolved', 'closed'], (id) => `tickets/${id}/resolve`, 'resolved'],
    ['sporting-goods', 'coaching_sessions', 'status', ['cancelled', 'completed'], (id) => `coaching/${id}/cancel`, 'cancelled'],
    ['workforce', 'expenses', 'status', ['Approved', 'Denied', 'Reimbursed'], (id) => `expenses/${id}/approve`, 'Approved'],
    ['workforce', 'tickets', 'status', ['Resolved', 'Closed'], (id) => `tickets/${id}/resolve`, 'Resolved'],
    ['workforce', 'trainings', 'status', ['Completed'], (id) => `trainings/${id}/complete`, 'Completed'],
  ];

  // Writes are gated on a live customer verification (see 'verification is
  // enforced on writes'), so each case verifies u1 first and then exercises the
  // action itself.
  it.each(CASES)('%s: %s action mutates status then guards a settled item', async (vertical, slice, statusKey, terminal, pathFor, resolvedStatus) => {
    const agent = makeSessionApp();
    await request(agent).post(`/api/admin/${vertical}/verify/initiate`).send({ customerId: 'u1' });

    const look = await request(agent).get(`/api/admin/${vertical}/lookup?q=demo`);
    const item = actionable(look.body.data[slice], statusKey, terminal);
    expect(item).toBeTruthy();

    const ok = await request(agent).post(`/api/admin/${vertical}/${pathFor(item.id)}`).send({ userId: 'u1' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.item[statusKey]).toBe(resolvedStatus);

    // Re-running the same action on the now-settled item is a no-op → 404.
    const again = await request(agent).post(`/api/admin/${vertical}/${pathFor(item.id)}`).send({ userId: 'u1' });
    expect(again.status).toBe(404);
  });

  it('workforce: deny expense sets Denied status', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/workforce/verify/initiate').send({ customerId: 'u1' });

    const look = await request(agent).get('/api/admin/workforce/lookup?q=demo');
    const exp = actionable(look.body.data.expenses, 'status', ['Approved', 'Denied', 'Reimbursed']);
    expect(exp).toBeTruthy();
    const r = await request(agent).post(`/api/admin/workforce/expenses/${exp.id}/deny`).send({ userId: 'u1' });
    expect(r.status).toBe(200);
    expect(r.body.item.status).toBe('Denied');
  });

  it('rejects a missing userId with 400', async () => {
    // No customer id to check, so the gate passes through and the route's own
    // 400 fires.
    const r = await request(makeSessionApp()).post('/api/admin/retail/orders/1001/cancel').send({});
    expect(r.status).toBe(400);
  });

  it('rejects an unknown userId with 404', async () => {
    // Seeded past the gate — verify/initiate would 404 on 'ghost' before the
    // route's own unknown-user check could be reached.
    const agent = makeSessionApp({ supportVerified: { ghost: Date.now() + 60_000 } });
    const r = await request(agent).post('/api/admin/retail/orders/1001/cancel').send({ userId: 'ghost' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });

  it('returns 404 when the target item id does not exist', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/retail/verify/initiate').send({ customerId: 'u1' });
    const r = await request(agent).post('/api/admin/retail/orders/does-not-exist/cancel').send({ userId: 'u1' });
    expect(r.status).toBe(404);
  });
});

// ── Customer verification + operator permissions ──────────────────────────────
// A minimal session shim: one object shared across requests from one agent.
function makeSessionApp(seed = {}) {
  const app = express();
  app.use(express.json());
  const session = { ...seed };
  app.use((req, _res, next) => { req.session = session; next(); });
  // Credits the OPERATOR's own MFA, the way routes/mfa.js does. The customer
  // gate must not honour it.
  app.use((req, _res, next) => {
    if (req.get('x-test-stepup')) req.session.stepUpVerified = Date.now() + 60_000;
    next();
  });
  app.use('/api/admin', adminVerticals);
  return app;
}

describe('customer verification', () => {
  it('starts unverified', async () => {
    const a = makeSessionApp();
    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u1');
    expect(r.status).toBe(200);
    expect(r.body.verified).toBe(false);
  });

  it('initiate then status reports verified', async () => {
    const a = makeSessionApp();
    const init = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({ customerId: 'u1' });
    expect(init.status).toBe(200);
    expect(init.body.ok).toBe(true);

    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u1');
    expect(r.body.verified).toBe(true);
    expect(r.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('verifying one customer does not verify another', async () => {
    const a = makeSessionApp();
    await request(a).post('/api/admin/sporting-goods/verify/initiate').send({ customerId: 'u1' });
    const r = await request(a).get('/api/admin/sporting-goods/verify/status?customerId=u2');
    expect(r.body.verified).toBe(false);
  });

  it('rejects an unknown customerId with 404', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({ customerId: 'ghost' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });

  it('rejects a missing customerId with 400', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('customerId is required');
  });
});

describe('operator permissions', () => {
  it('reports scopes from loginIntrospection when present', async () => {
    const a = makeSessionApp({
      loginIntrospection: { scopes: ['general:read', 'general:write'] },
    });
    const r = await request(a).get('/api/admin/sporting-goods/permissions');
    expect(r.status).toBe(200);
    expect(r.body.scopes).toEqual(['general:read', 'general:write']);
    expect(r.body.source).toBe('introspection');
  });

  it('falls back to the access token scope claim', async () => {
    // An unsigned JWT carrying the scope claim. decodeJwt parses the header too,
    // so it has to be real base64url JSON — not a placeholder character.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64({ alg: 'none', typ: 'JWT' });
    const payload = b64({ scope: 'general:read transactions:write' });
    const a = makeSessionApp({ oauthTokens: { accessToken: `${header}.${payload}.sig` } });

    const r = await request(a).get('/api/admin/sporting-goods/permissions');
    expect(r.body.scopes).toEqual(['general:read', 'transactions:write']);
    expect(r.body.source).toBe('token');
  });

  it('reports source none rather than pretending the operator has no scopes', async () => {
    const a = makeSessionApp();
    const r = await request(a).get('/api/admin/sporting-goods/permissions');
    expect(r.body.scopes).toEqual([]);
    expect(r.body.source).toBe('none');
  });
});

describe('verification is enforced on writes', () => {
  // Healthcare appointments, because no other case in this file mutates them —
  // the vertical stores are module singletons shared across the whole suite, and
  // the retail/sporting-goods rows are already spent by the write-action cases.
  async function firstActionableAppointment(agentApp) {
    const look = await request(agentApp).get('/api/admin/healthcare/lookup?q=demo');
    return actionable(look.body.data.appointments, 'status', ['Cancelled', 'Completed']);
  }

  it('rejects a gated write when the customer is not verified', async () => {
    const a = makeSessionApp();
    const appt = await firstActionableAppointment(a);
    expect(appt).toBeTruthy();

    const r = await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .send({ userId: 'u1' });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
    expect(r.body.need_verification).toBe(true);
  });

  it('allows the same write once the customer is verified', async () => {
    const a = makeSessionApp();
    const appt = await firstActionableAppointment(a);
    expect(appt).toBeTruthy();

    await request(a).post('/api/admin/healthcare/verify/initiate').send({ customerId: 'u1' });

    const r = await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .send({ userId: 'u1' });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('verifying customer A does not unlock writes against customer B', async () => {
    const a = makeSessionApp();
    const appt = await firstActionableAppointment(a);
    expect(appt).toBeTruthy();

    await request(a).post('/api/admin/healthcare/verify/initiate').send({ customerId: 'u1' });

    const r = await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .send({ userId: 'u2' });

    // u2 IS a known demo user (see the store mock), so a 404 here would mean the
    // gate never ran. It must be the gate's own 403, naming u2.
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
    expect(r.body.customerId).toBe('u2');
  });

  it('the operator own step-up does not satisfy the customer gate', async () => {
    const a = makeSessionApp();
    const appt = await firstActionableAppointment(a);
    expect(appt).toBeTruthy();

    const r = await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .set('x-test-stepup', '1')
      .send({ userId: 'u1' });

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('customer_not_verified');
  });

  it('records both the denial and the success in the audit', async () => {
    const a = makeSessionApp();
    const appt = await firstActionableAppointment(a);

    await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .send({ userId: 'u1' });
    await request(a).post('/api/admin/healthcare/verify/initiate').send({ customerId: 'u1' });
    await request(a)
      .post(`/api/admin/healthcare/appointments/${appt.id}/cancel`)
      .send({ userId: 'u1' });

    const r = await request(a).get('/api/admin/healthcare/audit?customerId=u1');
    expect(r.status).toBe(200);
    const outcomes = r.body.data.entries.map((e) => e.outcome);
    expect(outcomes).toContain('denied');
    expect(outcomes).toContain('ok');
  });
});

describe('case notes', () => {
  it('starts empty, accepts a note, and returns it', async () => {
    const a = makeSessionApp();

    const empty = await request(a).get('/api/admin/sporting-goods/cases/u1/notes');
    expect(empty.status).toBe(200);
    expect(empty.body.data.notes).toEqual([]);

    const post = await request(a)
      .post('/api/admin/sporting-goods/cases/u1/notes')
      .send({ body: 'Verified via OTP. Photos received.' });
    expect(post.status).toBe(200);
    expect(post.body.note.body).toBe('Verified via OTP. Photos received.');
    expect(post.body.note.at).toEqual(expect.any(String));

    const after = await request(a).get('/api/admin/sporting-goods/cases/u1/notes');
    expect(after.body.data.notes).toHaveLength(1);
  });

  it('rejects an empty note body with 400', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/cases/u1/notes')
      .send({ body: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('note body is required');
  });

  it('rejects a note against an unknown customer with 404', async () => {
    const a = makeSessionApp();
    const r = await request(a)
      .post('/api/admin/sporting-goods/cases/ghost/notes')
      .send({ body: 'hello' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });
});

describe('admin gate', () => {
  // The /api/admin mount applies authenticateToken only (server.js), so without
  // requireAdmin on each route ANY authenticated user — including a customer —
  // could self-serve verify/initiate for a known customer id and then write to
  // that customer's records. The verification gate is not an authorization
  // boundary on its own.
  it('refuses a non-admin on verify/initiate', async () => {
    mockAdminAllowed = false;
    const r = await request(makeSessionApp())
      .post('/api/admin/sporting-goods/verify/initiate')
      .send({ customerId: 'u1' });
    expect(r.status).toBe(403);
  });

  it('refuses a non-admin on a write', async () => {
    mockAdminAllowed = false;
    const r = await request(makeSessionApp())
      .post('/api/admin/healthcare/appointments/201/cancel')
      .send({ userId: 'u1' });
    expect(r.status).toBe(403);
  });

  it('refuses a non-admin on lookup, notes and the user list', async () => {
    mockAdminAllowed = false;
    const a = makeSessionApp();
    for (const call of [
      request(a).get('/api/admin/sporting-goods/lookup?q=demo'),
      request(a).get('/api/admin/sporting-goods/users'),
      request(a).get('/api/admin/sporting-goods/cases/u1/notes'),
      request(a).post('/api/admin/sporting-goods/cases/u1/notes').send({ body: 'x' }),
    ]) {
      const r = await call;
      expect(r.status).toBe(403);
    }
  });
});

describe('Phase 2 verticals', () => {
  const PHASE2 = [
    ['university', ['courses', 'billing', 'holds', 'financial_aid', 'enrollmentHistory']],
    ['government', ['permits', 'payments', 'filings', 'inspections', 'recordsRequests']],
    ['manufacturing', ['workOrders', 'maintenanceTickets', 'shipments', 'qualityInspections', 'purchaseOrders']],
    ['investment', ['portfolios', 'holdings', 'trades', 'dividends']],
    ['abercrombie-fitch', ['orders', 'returns', 'support_tickets', 'rewards', 'gift_cards']],
  ];

  // A card whose slice key does not exist in the store renders empty and says
  // nothing about why — the likeliest mistake in a change shaped like this, so
  // assert the payload is actually populated rather than merely present.
  it.each(PHASE2)('GET /%s/lookup returns the declared slices', async (vertical, slices) => {
    const r = await request(makeSessionApp()).get(`/api/admin/${vertical}/lookup?q=demo`);
    expect(r.status).toBe(200);
    expect(r.body.vertical).toBe(vertical);
    expect(r.body.user).toMatchObject({ id: 'u1' });
    for (const key of slices) {
      expect(r.body.data).toHaveProperty(key);
      expect(r.body.data[key]).not.toBeNull();
    }
  });

  it.each(PHASE2)('%s lookup requires admin', async (vertical) => {
    mockAdminAllowed = false;
    const r = await request(makeSessionApp()).get(`/api/admin/${vertical}/lookup?q=demo`);
    expect(r.status).toBe(403);
  });

  it('the read-only verticals register no write route', async () => {
    const agent = makeSessionApp();
    // Verified for u1, so a 404 here is "no such route", not the gate refusing.
    await request(agent).post('/api/admin/investment/verify/initiate').send({ customerId: 'u1' });
    for (const path of [
      '/api/admin/investment/trades/t1/buy',
      '/api/admin/investment/portfolios/p1/withdraw',
      '/api/admin/abercrombie-fitch/orders/o1/cancel',
    ]) {
      const r = await request(agent).post(path).send({ userId: 'u1' });
      expect(r.status).toBe(404);
    }
  });

  it('a gated write on a Phase 2 vertical is refused until the customer is verified', async () => {
    const agent = makeSessionApp();
    const look = await request(agent).get('/api/admin/government/lookup?q=demo');
    const permit = actionable(look.body.data.permits, 'status', ['Released']);
    expect(permit).toBeTruthy();

    const denied = await request(agent).post(`/api/admin/government/permits/${permit.id}/release`).send({ userId: 'u1' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('customer_not_verified');

    await request(agent).post('/api/admin/government/verify/initiate').send({ customerId: 'u1' });
    const ok = await request(agent).post(`/api/admin/government/permits/${permit.id}/release`).send({ userId: 'u1' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.item.status).toBe('Released');
  });

  // manufacturing's releaseWorkOrder falls back to "the first order not yet
  // released" when the id does not match. Without a guard, a stale or repeated
  // request silently releases a DIFFERENT order and reports success — the exact
  // failure this phase refused to ship for the other mutators.
  it('a write against an unknown row id does not act on a different row', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/manufacturing/verify/initiate').send({ customerId: 'u1' });

    const before = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    const openOrders = before.body.data.workOrders.filter((w) => w.status !== 'Released');
    expect(openOrders.length).toBeGreaterThan(0);

    const r = await request(agent)
      .post('/api/admin/manufacturing/work-orders/WO-does-not-exist/release')
      .send({ userId: 'u1' });
    expect(r.status).toBe(404);

    const after = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    const stillOpen = after.body.data.workOrders.filter((w) => w.status !== 'Released');
    expect(stillOpen.map((w) => w.id)).toEqual(openOrders.map((w) => w.id));
  });

  // An id from a DIFFERENT slice of the same customer must not satisfy the
  // existence check — the mutator's fallback would then release the first open
  // work order and the store would be written before any id comparison ran.
  it('an id from another slice does not release a work order', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/manufacturing/verify/initiate').send({ customerId: 'u1' });

    const before = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    const openBefore = before.body.data.workOrders.filter((w) => w.status !== 'Released').map((w) => w.id);
    const shipmentId = before.body.data.shipments[0].id;
    expect(shipmentId).toBeTruthy();

    const r = await request(agent)
      .post(`/api/admin/manufacturing/work-orders/${shipmentId}/release`)
      .send({ userId: 'u1' });
    expect(r.status).toBe(404);

    const after = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    const openAfter = after.body.data.workOrders.filter((w) => w.status !== 'Released').map((w) => w.id);
    expect(openAfter).toEqual(openBefore);
  });

  it('releasing a real work order still works and targets that order', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/manufacturing/verify/initiate').send({ customerId: 'u1' });
    const look = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    const wo = actionable(look.body.data.workOrders, 'status', ['Released']);
    expect(wo).toBeTruthy();

    const r = await request(agent).post(`/api/admin/manufacturing/work-orders/${wo.id}/release`).send({ userId: 'u1' });
    expect(r.status).toBe(200);
    expect(r.body.item.id).toBe(wo.id);
    expect(r.body.item.status).toBe('Released');
  });

  // writeAction calls store[method](userId, rowId). Only mutators shaped
  // (userId, itemId) honour the row the operator clicked; the (data, {...})
  // ones fall back to a default row and report success anyway. Exposing one
  // would be worse than not offering it, so assert they stay unexposed.
  it('mutators that cannot honour a row id are not exposed as routes', async () => {
    const agent = makeSessionApp();
    await request(agent).post('/api/admin/university/verify/initiate').send({ customerId: 'u1' });
    for (const path of [
      '/api/admin/university/courses/C-1/register',
      '/api/admin/university/transcripts/T-1/release',
      '/api/admin/government/fees/F-1/pay',
      '/api/admin/manufacturing/work-orders/WO-1/schedule',
    ]) {
      const r = await request(agent).post(path).send({ userId: 'u1' });
      expect(r.status).toBe(404);
    }
  });

});

describe('support queue', () => {
  // The queue is a projection over slices, so every row must trace to a record
  // really in that state. Asserting only "rows.length > 0" would pass on
  // fabricated rows.
  it('returns only records whose status is genuinely open', async () => {
    const agent = makeSessionApp();
    const q = await request(agent).get('/api/admin/manufacturing/queue');
    expect(q.status).toBe(200);
    expect(q.body.vertical).toBe('manufacturing');
    expect(q.body.data.rows.length).toBeGreaterThan(0);

    const look = await request(agent).get('/api/admin/manufacturing/lookup?q=demo');
    for (const row of q.body.data.rows.filter((r) => r.customerId === 'u1')) {
      const source = (look.body.data[row.category] || []).find((r) => String(r.id) === row.id);
      // jest's expect takes no message argument (that is vitest); the row
      // identifiers are in the failure output via the toBe below.
      expect(source).toBeTruthy();
      expect(String(source.status).toLowerCase()).toBe(String(row.status).toLowerCase());
    }
  });

  it('matches status case-insensitively', async () => {
    // sporting-goods seeds 'open'/'in_progress'; retail seeds 'Open'/'In Progress'.
    const agent = makeSessionApp();
    for (const vertical of ['sporting-goods', 'retail']) {
      const r = await request(agent).get(`/api/admin/${vertical}/queue`);
      expect(r.status).toBe(200);
      expect(r.body.data.rows.length).toBeGreaterThan(0);
    }
  });

  it('renders an honest empty queue where nothing is open', async () => {
    // banking's seed has null account statuses and only 'completed'
    // transactions; investment's trades are all settled. Neither declares
    // rules, and neither should invent rows.
    for (const vertical of ['banking', 'investment']) {
      const r = await request(makeSessionApp()).get(`/api/admin/${vertical}/queue`);
      expect(r.status).toBe(200);
      expect(r.body.data.rows).toEqual([]);
    }
  });

  it('requires admin', async () => {
    mockAdminAllowed = false;
    const r = await request(makeSessionApp()).get('/api/admin/workforce/queue');
    expect(r.status).toBe(403);
  });

  it('carries what the console needs to open the customer', async () => {
    const r = await request(makeSessionApp()).get('/api/admin/university/queue');
    expect(r.body.data.rows.length).toBeGreaterThan(0);
    for (const row of r.body.data.rows) {
      expect(row.customerId).toBeTruthy();
      expect(row.customerQuery).toBeTruthy();
      expect(row.title).toBeTruthy();
      expect(row.categoryLabel).toBeTruthy();
    }
  });
});
