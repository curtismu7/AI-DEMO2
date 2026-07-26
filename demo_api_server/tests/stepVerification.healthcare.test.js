// demo_api_server/tests/stepVerification.healthcare.test.js
'use strict';

/**
 * Step verification — healthcare, heuristic mode.
 * Mirrors stepVerification.banking.test.js for the healthcare vertical.
 * Writes one ledger entry per case to
 * demo_api_server/data/step-verification/healthcare/<useCaseId>.<triggerType>.<mode>.json
 *
 * Check 2 (parse/route): every works-maturity healthcare chip routes to its
 * stored primaryTool.
 * Check 5 (gate decision): UC6/UC7/UC8's amount-gated pay_bill resolves to the
 * DENY/STEP_UP/HITL decision agentPreflightService.evaluate() returns for that tier.
 */

const { USE_CASES, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');
const {
  worksChipExpectationsFor,
  amountGateExpectationsFor,
  normalizeParsedIntent,
} = require('../services/stepVerificationExpectations');
const {
  requiredFlagsForUseCase,
  checkChipPrerequisites,
  needsA2aCredentials,
  needsParConfig,
} = require('../services/demoStepPrerequisites');

const VERTICAL = 'healthcare';

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));
const realConfigStore = jest.requireActual('../services/configStore');

jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'fake-token',
    userSub: 'user-sub',
    tokenEvents: [],
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-sub' } })),
}));

jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({ challengeId: 'ch-test-001', expiresAt: '2099-01-01T00:00:00Z' })),
  getChallengeStatus: jest.fn(async () => {
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }),
  verifyHitlReceipt: jest.fn(() => ({ ok: false, message: 'not approved' })),
}));

jest.mock('../services/mcpToolAuthorizationService', () => ({
  evaluateMcpFirstToolGate: jest.fn(async ({ toolParams }) => {
    const amount = toolParams && toolParams.amount;
    if (typeof amount !== 'number') return { ran: false };
    if (amount >= 2000) return { ran: true, block: { body: { error: 'mcp_denied' } } };
    if (amount >= 500) return { ran: true, block: { body: { error: 'mcp_step_up_required' } } };
    return { ran: true, block: { body: { error: 'mcp_hitl_required' } } };
  }),
}));

const { evaluate } = require('../services/agentPreflightService');

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-step-verification-healthcare',
});

function healthcareChipPrerequisiteCases() {
  const out = [];
  const seen = new Set();
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, VERTICAL) || u;
    const mat = uc.maturity || '';
    if (mat !== 'works' && !String(mat).startsWith('flag:')) continue;
    const t = uc.trigger || {};
    const isChip = t.type === 'chip' && t.text;
    if (!isChip && !needsParConfig(uc)) continue;
    if (seen.has(uc.id)) continue;
    seen.add(uc.id);
    out.push(uc);
  }
  return out;
}

describe('step verification — healthcare chip routing (check 2: parse/route + amount)', () => {
  const cases = worksChipExpectationsFor(VERTICAL);

  test('at least one works-maturity healthcare chip is covered', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))('%s: chip routes to primaryTool with expected amount', (_id, c) => {
    const ctx = resolveVerticalCtx(VERTICAL);
    const parsed = parseHeuristic(c.chipText, VERTICAL, ctx, {});
    const n = normalizeParsedIntent(parsed);

    let status = 'PASS';
    let errorClass = null;
    if (!n || n.tool !== c.primaryTool) {
      status = 'FAIL';
      errorClass = n?.action ? 'wrong_response' : 'parse_error';
    } else if (c.amount != null && n.amount !== c.amount) {
      status = 'FAIL';
      errorClass = 'wrong_response';
    }

    writeLedgerEntry({
      vertical: VERTICAL,
      useCaseId: c.id,
      triggerType: 'chip',
      mode: 'unit-parse',
      status,
      errorClass,
      primaryTool: c.primaryTool,
      checkedAt: new Date().toISOString(),
    });

    expect(n?.tool).toBe(c.primaryTool);
    if (c.amount != null) {
      expect(n.amount).toBe(c.amount);
    }
  });
});

describe('step verification — healthcare amount-gated decisions (check 5, catalog-driven)', () => {
  const gates = amountGateExpectationsFor(VERTICAL);

  test('UC6/7/8-class gates are present in the catalog matrix', () => {
    const ids = gates.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['UC6', 'UC7', 'UC8']));
  });

  test.each(gates.map((g) => [g.id, g.amount, g.gate]))(
    '%s: $%i → decision %s',
    async (id, amount, gate) => {
      const result = await evaluate({
        req: fakeReq(),
        tool: 'pay_bill',
        params: { amount },
      });
      const status = result.decision === gate ? 'PASS' : 'FAIL';

      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: id,
        triggerType: 'chip',
        mode: 'unit-gate',
        status,
        errorClass: status === 'FAIL' ? 'wrong_gate' : null,
        primaryTool: 'pay_bill',
        checkedAt: new Date().toISOString(),
      });

      expect(result.decision).toBe(gate);
    },
  );
});

describe('step verification — healthcare chip prerequisites (flags + A2A + PAR)', () => {
  const cases = healthcareChipPrerequisiteCases();

  beforeAll(() => {
    require('dotenv').config({
      path: require('path').join(__dirname, '..', '.env'),
      override: false,
    });
  });

  test('covers flag-gated and works-maturity use cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))(
    '%s: required flags declared; creds when needed (gateway flags assumed on offline)',
    (_id, uc) => {
      const requiredFlags = requiredFlagsForUseCase(uc);
      expect(requiredFlags.length).toBeGreaterThan(0);

      const cfg = {
        getEffective: (k) => {
          if (typeof k === 'string' && k.startsWith('ff_')) return true;
          return realConfigStore.getEffective(k);
        },
      };

      const prereq = checkChipPrerequisites(uc, VERTICAL, cfg);
      const status = prereq.ok ? 'PASS' : 'FAIL';
      const errorClass = prereq.ok ? null : 'missing_prereq';
      const t = uc.trigger || {};
      const triggerType = t.type === 'chip' ? 'chip' : (t.type || 'chip');

      writeLedgerEntry({
        vertical: VERTICAL,
        useCaseId: uc.id,
        triggerType,
        mode: 'unit-prereq',
        status,
        errorClass,
        primaryTool: uc.primaryTool || null,
        checkedAt: new Date().toISOString(),
        requiredFlags,
        prereqErrors: prereq.errors.length ? prereq.errors : undefined,
      });

      // A2A credential failures are environment gaps, not catalog wiring errors —
      // record them in the ledger above but don't hard-fail offline CI.
      const nonCredErrors = prereq.errors.filter((e) => !/credentials missing/i.test(e));
      expect(nonCredErrors).toEqual([]);
    },
  );
});
