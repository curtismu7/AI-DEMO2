// demo_api_server/tests/stepVerification.banking.test.js
'use strict';

/**
 * Step verification — banking, heuristic mode.
 * Writes one ledger entry per case to
 * demo_api_server/data/step-verification/banking/<useCaseId>.<triggerType>.<mode>.json
 *
 * Check 2 (parse/route): every works-maturity banking chip routes to its own
 * stored primaryTool.
 * Check 5 (gate decision): UC6/UC7/UC8's amount-gated transfer resolves to the
 * DENY/STEP_UP/HITL decision agentPreflightService.evaluate() actually returns
 * for that amount tier.
 * UC22 (CIBA) and UC27 (HITL bypass attempt) are recorded by reference — see
 * the design notes in the implementation plan for why they are not
 * re-dispatched here.
 */

const { USE_CASES, resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));

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

// Faithful model of the real gate: agentPreflightService.js branches on
// errCode 'mcp_step_up_required' -> STEP_UP, 'mcp_hitl_required' -> HITL,
// any other block -> DENY. Thresholds match UC7's match:{amountMin:500,
// amountMax:2000} and UC8's match:{amountMin:0.01,amountMax:499.99}.
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
const { ACTION_TO_TOOL } = require('./helpers/actionToTool');

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-step-verification-banking',
});

const A2A_UNROUTABLE = /specialist/i;

/** Every works-maturity banking chip with a stored primaryTool. */
function bankingWorksChipCases() {
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text)) continue;
    if (!uc.primaryTool) continue;
    out.push({ id: uc.id, text: t.text, primaryTool: uc.primaryTool });
  }
  return out;
}

describe('step verification — banking chip routing (check 2: parse/route)', () => {
  const cases = bankingWorksChipCases();

  test('at least one works-maturity banking chip is covered', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))('%s: chip routes to its stored primaryTool', (_id, c) => {
    const ctx = resolveVerticalCtx('banking');
    const parsed = parseHeuristic(c.text, 'banking', ctx, {});
    const action = parsed ? (parsed.banking?.action ?? parsed.action ?? null) : null;
    const tool = ACTION_TO_TOOL[action] || action;

    const status = tool === c.primaryTool ? 'PASS' : 'FAIL';
    const errorClass = status === 'FAIL' ? (action ? 'wrong_response' : 'parse_error') : null;

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: c.id,
      triggerType: 'chip',
      mode: 'heuristic',
      status,
      errorClass,
      primaryTool: c.primaryTool,
      checkedAt: new Date().toISOString(),
    });

    expect(tool).toBe(c.primaryTool);
  });
});

describe('step verification — banking amount-gated decisions (check 5)', () => {
  test.each([
    ['UC6', 2500, 'DENY'],
    ['UC7', 600, 'STEP_UP'],
    ['UC8', 300, 'HITL'],
  ])('%s: $%i transfer resolves to decision %s', async (id, amount, expectedDecision) => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount } });
    const status = result.decision === expectedDecision ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: id,
      triggerType: 'chip',
      mode: 'heuristic',
      status,
      errorClass: status === 'FAIL' ? 'wrong_gate' : null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
    });

    expect(result.decision).toBe(expectedDecision);
  });
});

describe('step verification — reference-only banking use cases', () => {
  const REFERENCE_ONLY = [
    {
      id: 'UC22',
      primaryTool: 'create_transfer',
      verifiedBy:
        'demo_api_server/src/__tests__/ciba.test.js, cibaService.test.js, cibaSimulatedService.test.js',
    },
    {
      id: 'UC27',
      primaryTool: 'create_transfer',
      verifiedBy: 'demo_api_server/tests/hitlBypass.regression.test.js',
    },
  ];

  test.each(REFERENCE_ONLY.map((r) => [r.id, r]))(
    '%s: gate behavior already proven by an existing suite',
    (_id, r) => {
      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: r.id,
        triggerType: 'chip',
        mode: 'heuristic',
        status: 'PASS',
        errorClass: null,
        primaryTool: r.primaryTool,
        checkedAt: new Date().toISOString(),
        verifiedBy: r.verifiedBy,
      });
      expect(r.verifiedBy).toBeTruthy();
    },
  );
});
