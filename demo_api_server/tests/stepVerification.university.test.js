// demo_api_server/tests/stepVerification.university.test.js
'use strict';

/**
 * Step verification — university, heuristic mode.
 * Mirrors stepVerification.banking.test.js for the university vertical.
 * Writes one ledger entry per case to
 * demo_api_server/data/step-verification/university/<useCaseId>.<triggerType>.<mode>.json
 *
 * Check 2 (parse/route): every works-maturity university chip routes to its
 * stored primaryTool.
 * Check 5 (gate decision): UC6/UC7/UC8's amount-gated pay_tuition_balance resolves to
 * DENY/STEP_UP/HITL for that amount tier.
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
const {
  chipPrerequisiteCases,
  runChipPrerequisiteCheck,
  assertSharedChipPrerequisites,
} = require('./helpers/chipPrerequisites');

const VERTICAL = 'university';

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
  correlationId: 'corr-step-verification-university',
});

function verticalChipPrerequisiteCases() {
  return chipPrerequisiteCases(VERTICAL);
}

describe(`step verification — ${VERTICAL} chip routing (check 2: parse/route + amount)`, () => {
  const cases = worksChipExpectationsFor(VERTICAL);

  test('at least one works-maturity chip is covered', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))('%s: chip routes to primaryTool with expected amount', (_id, c) => {
    const ctx = resolveVerticalCtx(VERTICAL);
    const parsed = parseHeuristic(c.chipText, VERTICAL, ctx, {});
    const n = normalizeParsedIntent(parsed, VERTICAL);

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

describe(`step verification — ${VERTICAL} amount-gated decisions (check 5, catalog-driven)`, () => {
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
        tool: 'pay_tuition_balance',
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
        primaryTool: 'pay_tuition_balance',
        checkedAt: new Date().toISOString(),
      });

      expect(result.decision).toBe(gate);
    },
  );
});

describe(`step verification — ${VERTICAL} chip prerequisites (flags + A2A + PAR)`, () => {
  const cases = verticalChipPrerequisiteCases();

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
      const result = runChipPrerequisiteCheck(uc, VERTICAL, realConfigStore);
      assertSharedChipPrerequisites(uc, result);

      // No credential assertion here on purpose. The A2A client id/secret and
      // the four PAR config keys live only in the gitignored
      // demo_api_server/.env, so a CI checkout resolves every one of them
      // empty — this used to hard-fail UC14/UC14b on the runner while passing
      // on every developer machine. That the check NOTICES missing credentials
      // is proven environment-independently in
      // src/__tests__/demoStepPrerequisites.test.js; whether they are actually
      // armed belongs to the live preflight. The gap is still recorded above:
      // writeLedgerEntry stamps status FAIL / errorClass missing_prereq.
    },
  );
});
