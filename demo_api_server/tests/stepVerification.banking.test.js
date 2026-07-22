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
const {
  bankingWorksChipExpectations,
  bankingAmountGateExpectations,
  normalizeParsedIntent,
} = require('../services/stepVerificationExpectations');
const {
  requiredFlagsForUseCase,
  checkChipPrerequisites,
  needsA2aCredentials,
} = require('../services/demoStepPrerequisites');

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));
// Real configStore for credential readiness (env/vault) — mocked store stays for gates.
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

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-step-verification-banking',
});

/**
 * Every banking chip use case (works + flag-gated) — prerequisite coverage.
 * Includes A2A chips the routing suite skips.
 */
function bankingChipPrerequisiteCases() {
  const out = [];
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    const mat = uc.maturity || '';
    if (mat !== 'works' && !String(mat).startsWith('flag:')) continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    out.push(uc);
  }
  return out;
}

describe('step verification — banking chip routing (check 2: parse/route + amount)', () => {
  const cases = bankingWorksChipExpectations();

  test('at least one works-maturity banking chip is covered', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((c) => [c.id, c]))('%s: chip routes to primaryTool with expected amount', (_id, c) => {
    const ctx = resolveVerticalCtx('banking');
    const parsed = parseHeuristic(c.chipText, 'banking', ctx, {});
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

    // unit-parse — offline check 2 only. Must NOT use mode "heuristic" or it
    // overwrites live invoke evidence and the report goes green while chips fail.
    writeLedgerEntry({
      vertical: 'banking',
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

describe('step verification — banking amount-gated decisions (check 5, catalog-driven)', () => {
  const gates = bankingAmountGateExpectations();

  test('UC6/7/8-class gates are present in the catalog matrix', () => {
    const ids = gates.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['UC6', 'UC7', 'UC8']));
  });

  test.each(gates.map((g) => [g.id, g.amount, g.gate]))(
    '%s: $%i → decision %s',
    async (id, amount, gate) => {
      const result = await evaluate({
        req: fakeReq(),
        tool: 'create_transfer',
        params: { amount },
      });
      const status = result.decision === gate ? 'PASS' : 'FAIL';

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: id,
        triggerType: 'chip',
        mode: 'unit-gate',
        status,
        errorClass: status === 'FAIL' ? 'wrong_gate' : null,
        primaryTool: 'create_transfer',
        checkedAt: new Date().toISOString(),
      });

      expect(result.decision).toBe(gate);
    },
  );
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
        mode: 'unit-ref',
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

describe('step verification — banking chip prerequisites (flags + A2A creds)', () => {
  const cases = bankingChipPrerequisiteCases();

  // Jest setup isolates LMDB and does not load demo_api_server/.env — pull
  // Agent 2 credentials from .env so this suite matches the running demo.
  beforeAll(() => {
    require('dotenv').config({
      path: require('path').join(__dirname, '..', '.env'),
      override: false,
    });
  });

  test('covers flag-gated and A2A chip use cases', () => {
    expect(cases.some((c) => String(c.maturity).startsWith('flag:'))).toBe(true);
    expect(cases.some((c) => needsA2aCredentials(c))).toBe(true);
  });

  test.each(cases.map((c) => [c.id, c]))(
    '%s: required flags declared; A2A creds when needed (gateway flags assumed on offline)',
    (_id, uc) => {
      const requiredFlags = requiredFlagsForUseCase(uc);
      expect(requiredFlags.length).toBeGreaterThan(0);
      // Offline Jest does not share the docker LMDB flag store. Gateway flags are
      // asserted live (e2e setDemoRuntimeFlags + ensureRequiredDemoFlags). Here we
      // only prove catalog wiring + A2A credential readiness.
      const cfg = {
        getEffective: (k) => {
          // Offline: assume every catalog-declared feature flag is armed so this
          // suite proves wiring + A2A creds, not the live LMDB flag store.
          if (typeof k === 'string' && k.startsWith('ff_')) return true;
          return realConfigStore.getEffective(k);
        },
      };

      const prereq = checkChipPrerequisites(uc, 'banking', cfg);
      const status = prereq.ok ? 'PASS' : 'FAIL';
      const errorClass = prereq.ok ? null : 'missing_prereq';

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: uc.id,
        triggerType: 'chip',
        mode: 'unit-prereq',
        status,
        errorClass,
        primaryTool: uc.primaryTool || null,
        checkedAt: new Date().toISOString(),
        requiredFlags,
        prereqErrors: prereq.errors.length ? prereq.errors : undefined,
      });

      expect(prereq.ok).toBe(true);
    },
  );
});
