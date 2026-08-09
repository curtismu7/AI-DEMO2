'use strict';
const request = require('supertest');
const express = require('express');

jest.mock('../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize' },
}));
// The route (routes/authorize.js) actually destructures `evaluateTransaction`
// and `isConfigured` from this module — not `evaluatePingOneTransaction` /
// `isPingOneConfigured`. Alias them to the same jest.fn so the test's
// `p1az.evaluatePingOneTransaction.mockResolvedValue(...)` below controls what
// the route really calls. `isConfigured` is also required transitively:
// transactionAuthorizationService.getAuthorizationStatusSummary() (called
// unconditionally at the top of the handler) calls it directly.
jest.mock('../services/pingOneAuthorizeService', () => {
  const evaluatePingOneTransaction = jest.fn();
  const isPingOneConfigured = jest.fn(() => true);
  return {
    evaluatePingOneTransaction,
    evaluateTransaction: evaluatePingOneTransaction,
    isPingOneConfigured,
    isConfigured: isPingOneConfigured,
  };
});

const appEventService = require('../services/appEventService');
const p1az = require('../services/pingOneAuthorizeService');
const authorizeRouter = require('../routes/authorize');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authorize', authorizeRouter);
  return app;
}

// Mirrors a real PingOne response — see the plan header for the captured body.
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NR_LICENSE_KEY = '';
  p1az.evaluatePingOneTransaction.mockResolvedValue({
    decision: 'DENY',
    stepUpRequired: true,
    decisionId: '48c67322-351e-45b4-8614-ce5208b2651f',
    policyEvalMs: 2.885,
    ruleName: 'Transaction Denied',
    ruleCode: 'transaction-denied',
    path: 'decision-endpoint',
    raw: {},
  });
});

function metaFromLastEvent() {
  const call = appEventService.logEvent.mock.calls.find((c) => c[0] === 'authorize');
  expect(call).toBeDefined();
  return call[3].metadata;
}

async function evaluate() {
  await request(makeApp())
    .post('/api/authorize/test-evaluate')
    .send({ amount: 60000, type: 'transfer', acr: 'pwd', userId: 'probe' });
}

// Selects the `forceLive` branch in routes/authorize.js (~line 385):
// `const forceLive = req.body?.live === true || req.body?.forceLive === true;`
// `live: true` is the field/value used here.
async function evaluateForceLive() {
  await request(makeApp())
    .post('/api/authorize/test-evaluate')
    .send({ amount: 60000, type: 'transfer', acr: 'pwd', userId: 'probe', live: true });
}

describe('authorize live evaluate metadata', () => {
  it('emits a numeric wall-clock latencyMs', async () => {
    await evaluate();
    const meta = metaFromLastEvent();
    expect(typeof meta.latencyMs).toBe('number');
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('passes through the rule name and code', async () => {
    await evaluate();
    const meta = metaFromLastEvent();
    expect(meta.ruleName).toBe('Transaction Denied');
    expect(meta.ruleCode).toBe('transaction-denied');
  });

  it("passes through PingOne's own policy evaluation time", async () => {
    await evaluate();
    expect(metaFromLastEvent().policyEvalMs).toBe(2.885);
  });

  it('passes through the decisionId', async () => {
    await evaluate();
    expect(metaFromLastEvent().decisionId).toBe('48c67322-351e-45b4-8614-ce5208b2651f');
  });

  it('still carries the decision', async () => {
    await evaluate();
    expect(metaFromLastEvent().decision).toBe('DENY');
  });
});

// routes/authorize.js has two call sites for these fields: the `forceLive`
// branch (~line 385, selected by `live: true` / `forceLive: true` in the
// body) and the general non-forced PingOne branch covered above. Both were
// field-threaded identically; this proves the forceLive one independently
// rather than trusting identical-by-inspection.
describe('authorize live evaluate metadata — forceLive branch', () => {
  it('carries decisionId, ruleName, ruleCode, policyEvalMs and latencyMs', async () => {
    await evaluateForceLive();
    const meta = metaFromLastEvent();
    expect(meta.decisionId).toBe('48c67322-351e-45b4-8614-ce5208b2651f');
    expect(meta.ruleName).toBe('Transaction Denied');
    expect(meta.ruleCode).toBe('transaction-denied');
    expect(meta.policyEvalMs).toBe(2.885);
    expect(typeof meta.latencyMs).toBe('number');
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('decision field extraction from a real PingOne body', () => {
  // Real module, not the mock above — this is what proves the extraction
  // itself is correct rather than a hand-copied expression.
  const { _mapDecisionFields } = jest.requireActual('../services/pingOneAuthorizeService');

  // Captured verbatim from a live PERMIT on 2026-08-09.
  const RAW = {
    correlationId: '48c67322-351e-45b4-8614-ce5208b2651f',
    timestamp: '2026-08-09T13:06:03.967328809Z',
    elapsedMicroseconds: 2885,
    status: { code: 'OKAY' },
    decision: 'PERMIT',
    statements: [{ name: 'Transaction Approved', code: 'transaction-approved' }],
  };

  it('reads decisionId from correlationId, not id', () => {
    expect(_mapDecisionFields(RAW).decisionId).toBe('48c67322-351e-45b4-8614-ce5208b2651f');
    expect(RAW.id).toBeUndefined();
  });

  it('converts elapsedMicroseconds to milliseconds', () => {
    expect(_mapDecisionFields(RAW).policyEvalMs).toBeCloseTo(2.885, 3);
  });

  it('reads the rule name and code from the first statement', () => {
    const mapped = _mapDecisionFields(RAW);
    expect(mapped.ruleName).toBe('Transaction Approved');
    expect(mapped.ruleCode).toBe('transaction-approved');
  });

  it('yields nulls, not a throw or NaN, when statements and elapsedMicroseconds are absent', () => {
    const mapped = _mapDecisionFields({ decision: 'PERMIT' });
    expect(mapped.decisionId).toBeNull();
    expect(mapped.policyEvalMs).toBeNull();
    expect(mapped.ruleName).toBeNull();
    expect(mapped.ruleCode).toBeNull();
  });
});
