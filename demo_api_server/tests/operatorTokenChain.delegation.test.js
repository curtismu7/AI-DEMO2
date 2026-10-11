'use strict';
// tests/operatorTokenChain.delegation.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { sub: 'admin-operator-1', username: 'demoAdmin', role: 'admin' };
    next();
  },
}));
jest.mock('../services/supportDelegationService', () => ({
  openCustomerSignon: jest.fn(),
  submitCustomerOtp: jest.fn(),
  exchangeForWrite: jest.fn(),
  liveSupportSession: jest.fn(),
  buildSignonEvents: jest.fn(() => [{ id: 'customer-signon', label: 'Customer sign-on', status: 'done', claims: {} }]),
  buildCustomerTokenEvent: jest.fn(() => ({ id: 'customer-token-issued', label: 'Customer token issued', status: 'done', claims: { sub: '1583af47' } })),
  buildExchangeEvents: jest.fn(() => [{ id: 'exchange', label: 'RFC 8693 exchange', status: 'done', claims: { 'act.sub': 'admin-cid' } }]),
  SUPPORT_VERIFY_TTL_MS: 15 * 60 * 1000,
}));

jest.mock('../services/demoTrackService', () => ({
  observeSupportEvent: jest.fn(),
  observeToolCall: jest.fn(),
  observeDecision: jest.fn(),
}));

const svc = require('../services/supportDelegationService');

function buildApp() {
  // The global setup's afterEach jest.resetModules() re-arms every mock factory
  // per test — re-require here so `svc` and the router share one module registry.
  const adminVerticals = require('../routes/adminVerticals');
  const app = express();
  app.use(express.json());
  const session = {};
  app.use((req, _res, next) => { req.session = session; req.sessionID = 'sess-test'; next(); });
  app.use('/api/admin', adminVerticals);
  return { app, session };
}

function workforceFixture() {
  const { verticalManifest } = require('../services/verticalManifest');
  verticalManifest.init();
  const dataStore = require('../data/store');
  const user = dataStore.getAllUsers().find((u) => u.role !== 'admin' && u.username);
  const store = verticalManifest.plugins.get('workforce').getDataStore();
  const pending = (store.get(String(user.id)).expenses || []).find(
    (e) => !['Approved', 'Denied', 'Reimbursed'].includes(e.status),
  );
  return { user, store, pending };
}

// Task 4: the ADMIN_WRITE gate still reads the legacy session flag (Task 5
// rewires it to liveSupportSession), so preset it on the shared session before
// the request. session.support is the ceremony's product — the subject token
// the exchange consumes.
function markVerifiedSession(session, user) {
  session.supportVerified = { [String(user.id)]: Date.now() + 900000 };
  session.support = {
    customerId: String(user.id), customerUsername: user.username, pingOneUserId: '1583af47',
    subjectToken: 'subject.jwt.value', subjectClaims: { sub: '1583af47' },
    verifiedUntil: Date.now() + 900000,
  };
}

describe('delegated operator write', () => {
  test('write performs the exchange, runs the mutator, returns the delegated chain', async () => {
    const { user, pending } = workforceFixture();
    const { app, session } = buildApp();
    const svc = require('../services/supportDelegationService');
    markVerifiedSession(session, user);
    svc.exchangeForWrite.mockResolvedValue({
      delegatedToken: 'delegated.jwt.value',
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', jti: 'j-1' },
      request: { audience: 'enduser.ping.demo', scope: 'write', hasActor: true },
    });

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.delegated).toMatchObject({ actSub: 'admin-cid', jti: 'j-1', scope: 'write' });
    const ids = res.body.tokenChain.map((e) => e.id);
    expect(ids).toEqual([
      'operator-session', 'operator-verification', 'customer-token-issued', 'exchange', 'operator-write', 'operator-audit',
    ]);
    expect(svc.exchangeForWrite).toHaveBeenCalledWith(expect.anything(), { scope: 'write' });
    // the audit hop records the act chain
    const audit = res.body.tokenChain.find((e) => e.id === 'operator-audit');
    expect(audit.claims.actSub).toBe('admin-cid');
    expect(audit.claims.jti).toBe('j-1');
  });

  test('exchange failure → 502, mutator NOT run, row unchanged', async () => {
    const { user, store, pending } = workforceFixture();
    const { app, session } = buildApp();
    const svc = require('../services/supportDelegationService');
    markVerifiedSession(session, user);
    svc.exchangeForWrite.mockRejectedValue(Object.assign(new Error('down'), { status: 502, code: 'exchange_failed' }));
    const before = store.get(String(user.id)).expenses.find((e) => e.id === pending.id).status;

    const res = await request(app)
      .post(`/api/admin/workforce/expenses/${pending.id}/approve`)
      .send({ userId: String(user.id) });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('exchange_failed');
    expect(res.body.tokenChain.map((e) => e.id)).toEqual(['operator-session', 'operator-verification', 'exchange']);
    expect(res.body.tokenChain[2].status).toBe('error');
    const after = store.get(String(user.id)).expenses.find((e) => e.id === pending.id).status;
    expect(after).toBe(before);
  });

  test('verify/otp returns the sign-on + token chain', async () => {
    const { user } = workforceFixture();
    const { app } = buildApp();
    const svc = require('../services/supportDelegationService');
    svc.submitCustomerOtp.mockImplementation((req) => {
      req.session.support = { customerId: String(user.id), verifiedUntil: Date.now() + 900000 };
      return Promise.resolve({ verified: true, expiresAt: Date.now() + 900000, tokenEvent: { id: 'customer-token-issued', label: 'Customer token issued', status: 'done', claims: {} } });
    });
    const res = await request(app).post('/api/admin/workforce/verify/otp').send({ otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.tokenChain.map((e) => e.id)).toEqual(['customer-signon', 'customer-token-issued']);
  });
});

// Task 8: the real ceremony's outcomes stamp the support demo track via
// demoTrackService.observeSupportEvent(event, req.sessionID). Kinds are the
// SUPPORT_EVENT_SLOTS keys (services/demoTrackService.js) — nothing else.
describe('support track observations from the ceremony', () => {
  const demoTrack = () => require('../services/demoTrackService');

  test('a successful write stamps write-ok and exchange-ok', async () => {
    const { user, pending } = workforceFixture();
    const { app } = buildApp();
    const svc = require('../services/supportDelegationService');
    svc.liveSupportSession.mockImplementation((req) => {
      req.session.support = { customerId: String(user.id), subjectToken: 's.j.v', verifiedUntil: Date.now() + 900000 };
      return req.session.support;
    });
    svc.exchangeForWrite.mockResolvedValue({
      delegatedToken: 'd.j.v',
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', jti: 'j-1' },
      request: { audience: 'a', scope: 'write', hasActor: true },
    });
    const track = demoTrack();
    await request(app).post(`/api/admin/workforce/expenses/${pending.id}/approve`).send({ userId: String(user.id) });
    const kinds = track.observeSupportEvent.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain('exchange-ok');
    expect(kinds).toContain('write-ok');
    // exactly once each — a double stamp or an extra kind on the success path is a regression
    const count = (kind) => track.observeSupportEvent.mock.calls.filter((c) => c[0].kind === kind).length;
    expect(count('exchange-ok')).toBe(1);
    expect(count('write-ok')).toBe(1);
    // the exchange-ok stamp carries the delegated act chain
    const exchangeOk = track.observeSupportEvent.mock.calls.find((c) => c[0].kind === 'exchange-ok');
    expect(exchangeOk[0].detail).toEqual({ actSub: 'admin-cid' });
  });

  test('a 403 denial stamps write-denied', async () => {
    const { user, pending } = workforceFixture();
    const { app } = buildApp();
    const svc = require('../services/supportDelegationService');
    svc.liveSupportSession.mockReturnValue(null);
    const track = demoTrack();
    await request(app).post(`/api/admin/workforce/expenses/${pending.id}/approve`).send({ userId: String(user.id) });
    expect(track.observeSupportEvent).toHaveBeenCalledWith({ kind: 'write-denied' }, expect.anything());
  });
});
