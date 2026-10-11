'use strict';

/**
 * Operator writes mint token-chain evidence.
 *
 * The support-console rail on /admin/<vertical> used to read from a store only
 * agent runs feed — so an operator's own verified, scoped write drew nothing.
 * Every ADMIN_WRITE mutator now returns the chain of what actually happened
 * (session → customer verification → store write → audit), and a verification
 * refusal returns the denial chain instead. The events carry what happened, no
 * more: no authorize hop (the console's scope table is advisory — nothing on
 * this path evaluates policy), no token claims (no token is minted).
 */

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { sub: 'admin-operator-1', username: 'demoAdmin', role: 'admin' };
    next();
  },
}));

function buildApp() {
  const adminVerticals = require('../routes/adminVerticals');
  const app = express();
  app.use(express.json());
  // One shared session object across requests, like the cookie store does:
  // verify/initiate marks it, the write reads it.
  const session = {};
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/admin', adminVerticals);
  return app;
}

function workforceFixture() {
  const { verticalManifest } = require('../services/verticalManifest');
  verticalManifest.init();
  const dataStore = require('../data/store');
  const user = dataStore.getAllUsers().find((u) => u.role !== 'admin' && u.username);
  expect(user).toBeTruthy();
  const store = verticalManifest.plugins.get('workforce').getDataStore();
  const data = store.get(String(user.id));
  const pending = (data.expenses || []).find(
    (e) => !['Approved', 'Denied', 'Reimbursed'].includes(e.status),
  );
  expect(pending).toBeTruthy();
  return { user, store, pending };
}

describe('POST /api/admin/workforce/expenses/:id/approve', () => {
  test('a verified write returns the operator chain: session, verification, write, audit', async () => {
    const { user, pending } = workforceFixture();
    const app = buildApp();

    const verify = await request(app)
      .post('/api/admin/workforce/verify/initiate')
      .send({ customerId: String(user.id) });
    expect(verify.status).toBe(200);

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.item.status).toBe('Approved');

    const chain = res.body.tokenChain;
    expect(Array.isArray(chain)).toBe(true);
    expect(chain.map((e) => e.id)).toEqual([
      'operator-session',
      'operator-verification',
      'operator-write',
      'operator-audit',
    ]);
    // Every hop is tagged with its vertical so a console only ever shows the
    // chain of the vertical it belongs to.
    expect(chain.every((e) => e.vertical === 'workforce')).toBe(true);

    const session = chain[0];
    expect(session.status).toBe('done');
    expect(session.claims.operator).toBe('admin-operator-1');
    expect(session.claims.role).toBe('admin');

    const verification = chain[1];
    expect(verification.status).toBe('done');
    expect(verification.claims.customerId).toBe(String(user.id));
    expect(typeof verification.verifiedUntil).toBe('string');

    const write = chain[2];
    expect(write.claims.row).toBe(String(pending.id));
    expect(write.claims.beforeStatus).toBe(pending.status);
    expect(write.claims.afterStatus).toBe('Approved');
    expect(write.request).toEqual({
      method: 'POST',
      url: `/api/admin/workforce/expenses/${pending.id}/approve`,
    });
    expect(write.result).toMatchObject({ id: String(pending.id), status: 'Approved' });

    expect(chain[3].claims.operator).toBe('admin-operator-1');
    expect(chain[3].claims.action).toContain('/approve');
  });

  test('a write without verification returns 403 with the denial chain and mutates nothing', async () => {
    const { user, store, pending } = workforceFixture();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('customer_not_verified');

    const chain = res.body.tokenChain;
    // The audit hop is included: the route records denials too ("a denial that
    // leaves no trace is worse than no audit at all").
    expect(chain.map((e) => e.id)).toEqual(['operator-session', 'operator-verification', 'operator-audit']);
    expect(chain.every((e) => e.vertical === 'workforce')).toBe(true);
    expect(chain[1].status).toBe('error');
    expect(chain[1].claims.customerId).toBe(String(user.id));

    const after = store.get(String(user.id)).expenses.find((e) => e.id === pending.id);
    expect(after.status).toBe(pending.status);
  });
});
