'use strict';

/**
 * Operator writes mint token-chain evidence.
 *
 * The support-console rail on /admin/<vertical> used to read from a store only
 * agent runs feed — so an operator's own verified, scoped write drew nothing.
 * Every ADMIN_WRITE mutator now returns the chain of what actually happened
 * (session → customer verification → customer token → RFC 8693 exchange →
 * store write → audit), and a verification refusal returns the denial chain
 * instead. The ceremony hops carry real claims from the real customer sign-on
 * and real exchange; this suite mocks the delegation service so it tests the
 * route's wiring, not PingOne.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { sub: 'admin-operator-1', username: 'demoAdmin', role: 'admin' };
    next();
  },
}));

// The ceremony service is mocked: these tests cover writeAction's wiring
// (exchange before the mutator, chain shape), not the pi.flow ceremony itself
// — that's operatorTokenChain.delegation.test.js and the piFlow suite.
jest.mock('../services/supportDelegationService', () => ({
  openCustomerSignon: jest.fn(),
  submitCustomerOtp: jest.fn(),
  exchangeForWrite: jest.fn(),
  liveSupportSession: jest.fn(),
  buildSignonEvents: jest.fn(() => []),
  buildCustomerTokenEvent: jest.fn(() => ({
    id: 'customer-token-issued', label: 'Customer token issued', status: 'done', claims: { sub: 'customer-1' },
  })),
  buildExchangeEvents: jest.fn(() => [{
    id: 'exchange', label: 'RFC 8693 exchange — act on behalf of', status: 'done',
    claims: { sub: 'customer-1', 'act.sub': 'admin-client', scope: 'write', jti: 'j-test' },
  }]),
  SUPPORT_VERIFY_TTL_MS: 15 * 60 * 1000,
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
  return { app, session };
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
  test('a verified write returns the delegated chain: session, verification, customer token, exchange, write, audit', async () => {
    const { user, pending } = workforceFixture();
    const { app, session } = buildApp();
    const svc = require('../services/supportDelegationService');
    // Live verified ceremony session (the old session flag satisfies the
    // Task 4 gate; Task 5 rewires it to svc.liveSupportSession) whose subject
    // token exchanges successfully.
    session.supportVerified = { [String(user.id)]: Date.now() + 900000 };
    session.support = {
      customerId: String(user.id), customerUsername: user.username,
      subjectToken: 'subject.jwt.value', subjectClaims: { sub: 'customer-1' },
      verifiedUntil: Date.now() + 900000,
    };
    svc.exchangeForWrite.mockResolvedValue({
      delegatedToken: 'delegated.jwt.value',
      delegatedClaims: { sub: 'customer-1', act: { sub: 'admin-client' }, scope: 'write', jti: 'j-test' },
      request: { audience: 'enduser.ping.demo', scope: 'write', hasActor: true },
    });

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.item.status).toBe('Approved');
    expect(res.body.delegated).toMatchObject({ actSub: 'admin-client', jti: 'j-test', scope: 'write' });
    expect(svc.exchangeForWrite).toHaveBeenCalledWith(expect.anything(), { scope: 'write' });

    const chain = res.body.tokenChain;
    expect(Array.isArray(chain)).toBe(true);
    expect(chain.map((e) => e.id)).toEqual([
      'operator-session',
      'operator-verification',
      'customer-token-issued',
      'exchange',
      'operator-write',
      'operator-audit',
    ]);
    // Every hop is tagged with its vertical so a console only ever shows the
    // chain of the vertical it belongs to.
    expect(chain.every((e) => e.vertical === 'workforce')).toBe(true);

    const sessionEvent = chain[0];
    expect(sessionEvent.status).toBe('done');
    expect(sessionEvent.claims.operator).toBe('admin-operator-1');
    expect(sessionEvent.claims.role).toBe('admin');

    const verification = chain[1];
    expect(verification.status).toBe('done');
    expect(verification.claims.customerId).toBe(String(user.id));
    expect(typeof verification.verifiedUntil).toBe('string');

    const customerToken = chain[2];
    expect(customerToken.status).toBe('done');
    expect(customerToken.claims.sub).toBe('customer-1');

    const exchange = chain[3];
    expect(exchange.status).toBe('done');
    expect(exchange.claims['act.sub']).toBe('admin-client');

    const write = chain[4];
    expect(write.claims.row).toBe(String(pending.id));
    expect(write.claims.beforeStatus).toBe(pending.status);
    expect(write.claims.afterStatus).toBe('Approved');
    expect(write.request).toEqual({
      method: 'POST',
      url: `/api/admin/workforce/expenses/${pending.id}/approve`,
    });
    expect(write.result).toMatchObject({ id: String(pending.id), status: 'Approved' });

    expect(chain[5].claims.operator).toBe('admin-operator-1');
    expect(chain[5].claims.action).toContain('/approve');
    // The audit hop records the delegated token's provenance.
    expect(chain[5].claims.actSub).toBe('admin-client');
    expect(chain[5].claims.jti).toBe('j-test');
  });

  test('a write without verification returns 403 with the denial chain and mutates nothing', async () => {
    const { user, store, pending } = workforceFixture();
    const { app } = buildApp();

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
