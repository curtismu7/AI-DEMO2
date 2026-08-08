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

// ── Mock auth: admin + scopes always pass ─────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
}));

// ── Mock the BFF user store: one deterministic non-admin demo user ────────────
const DEMO_USER = {
  id: 'u1', username: 'demo', firstName: 'Demo', lastName: 'User',
  email: 'demo@example.com', role: 'customer', isActive: true,
};
jest.mock('../../data/store', () => ({
  getAllUsers: () => [DEMO_USER],
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

  it.each(CASES)('%s: %s action mutates status then guards a settled item', async (vertical, slice, statusKey, terminal, pathFor, resolvedStatus) => {
    const look = await request(app).get(`/api/admin/${vertical}/lookup?q=demo`);
    const item = actionable(look.body.data[slice], statusKey, terminal);
    expect(item).toBeTruthy();

    const ok = await request(app).post(`/api/admin/${vertical}/${pathFor(item.id)}`).send({ userId: 'u1' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.item[statusKey]).toBe(resolvedStatus);

    // Re-running the same action on the now-settled item is a no-op → 404.
    const again = await request(app).post(`/api/admin/${vertical}/${pathFor(item.id)}`).send({ userId: 'u1' });
    expect(again.status).toBe(404);
  });

  it('workforce: deny expense sets Denied status', async () => {
    const look = await request(app).get('/api/admin/workforce/lookup?q=demo');
    const exp = actionable(look.body.data.expenses, 'status', ['Approved', 'Denied', 'Reimbursed']);
    expect(exp).toBeTruthy();
    const r = await request(app).post(`/api/admin/workforce/expenses/${exp.id}/deny`).send({ userId: 'u1' });
    expect(r.status).toBe(200);
    expect(r.body.item.status).toBe('Denied');
  });

  it('rejects a missing userId with 400', async () => {
    const r = await request(app).post('/api/admin/retail/orders/1001/cancel').send({});
    expect(r.status).toBe(400);
  });

  it('rejects an unknown userId with 404', async () => {
    const r = await request(app).post('/api/admin/retail/orders/1001/cancel').send({ userId: 'ghost' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown user');
  });

  it('returns 404 when the target item id does not exist', async () => {
    const r = await request(app).post('/api/admin/retail/orders/does-not-exist/cancel').send({ userId: 'u1' });
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
