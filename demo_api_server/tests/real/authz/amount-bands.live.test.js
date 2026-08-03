'use strict';

/**
 * LIVE amount-band gate — the four transfer bands, evaluated against the real
 * PingOne Authorize decision endpoint.
 *
 * WHY THIS EXISTS
 *
 * tests/stepVerification.amountGateBand.test.js already covers these bands, but
 * it MOCKS the PDP:
 *
 *   pingOneAuthorizeService.evaluateTransaction.mockResolvedValue(pdpResponseFor(c.gate))
 *
 * That proves the BFF maps a GIVEN answer to the right gate. It can never prove
 * the live policy returns different answers per amount — if the Transaction
 * policy were edited in the console, unlinked from the decision endpoint, or
 * stopped receiving the Amount attribute, every band would collapse to one
 * outcome and that suite would stay green. Mocked and unrun are both
 * indistinguishable from passing.
 *
 * That gap is not hypothetical. On 2026-08-03 a golden capture recorded UC6
 * (DENY), UC7 (STEP_UP) and UC22 (CIBA) all replying "Transaction requires human
 * approval (HITL consent)" — four distinct gates flattened into one. Deciding
 * whether the demo had regressed or the capture was bad took a manual probe of
 * exactly what this file now automates. (It was the capture: the live chain was
 * correct end to end.)
 *
 * WHAT IT ASSERTS, IN TWO LAYERS
 *
 *   1. the PDP itself   — the live decision endpoint returns a DIFFERENT outcome
 *                         per band, and specifically denies above the ceiling
 *   2. the BFF mapping  — _applyTransactionPolicy against that live response
 *                         produces the gate the demo actually enforces
 *
 * Layer 2 is the one the mocked suite covers; layer 1 is the one nothing did.
 * A band collapse fails layer 1 with the live payload in the message, so the
 * next person sees the policy's own answer rather than having to go probe it.
 *
 * RUN: live stack + PingOne credentials.
 *   RUN_REAL_TESTS=true npx jest --config jest.real.config.js tests/real/authz
 */

const pingOneAuthorizeService = require('../../../services/pingOneAuthorizeService');
const { _applyTransactionPolicy } = require('../../../services/mcpToolAuthorizationService');

/**
 * The demo's authored bands (snapshots/gen-authorize-snapshot.js):
 *   consent  when Amount > $250
 *   step-up  when Amount >= $500 on transfers/withdrawals
 *   deny     when Amount >= $2,000
 * step-up dominates consent via the BFF obligation classifier.
 */
const BANDS = [
  { amount: 150,  ucId: 'UC22', expect: 'none',    why: 'below the $250 consent threshold — CIBA fires on actor+action, not amount' },
  { amount: 300,  ucId: 'UC8',  expect: 'hitl',    why: 'over $250, under the $500 step-up threshold' },
  { amount: 600,  ucId: 'UC7',  expect: 'stepUp',  why: 'over $500 — step-up dominates the consent obligation that also applies' },
  { amount: 2500, ucId: 'UC6',  expect: 'deny',    why: 'over the $2,000 ceiling' },
];

/**
 * The policy's own applied-rule codes. evaluateTransaction() returns normalized
 * flags (stepUpRequired/hitlRequired/consentRequired) at the top level and keeps
 * PingOne's body under `raw` — so the statements live at raw.statements, not on
 * the result. Asserting the raw codes rather than the normalized flags is
 * deliberate: the flags are what the BFF concluded, the codes are what PingOne
 * actually said, and the whole point of this file is to check the second.
 */
function statementCodes(r) {
  const stmts = (r && ((r.raw && r.raw.statements) || r.statements)) || [];
  return stmts.map((s) => String(s.code || s.name || '')).filter(Boolean);
}

/** The single enforcement outcome the BFF derived, as one word. */
function gateOf(out) {
  if (!out) return 'none';
  if (String(out.decision).toUpperCase() === 'DENY') return 'deny';
  if (out.stepUpRequired) return 'stepUp';
  if (out.consentRequired || out.hitlRequired) return 'hitl';
  return 'none';
}

const isConfigured = () => {
  try {
    return !!(process.env.PINGONE_ENVIRONMENT_ID || process.env.PINGONE_ENV_ID);
  } catch (_e) {
    return false;
  }
};

const maybe = isConfigured() ? describe : describe.skip;

maybe('LIVE PingOne Authorize — the amount bands are really distinct', () => {
  /** @type {Map<number, any>} raw PDP response per amount */
  const pdp = new Map();

  beforeAll(async () => {
    for (const b of BANDS) {
      // eslint-disable-next-line no-await-in-loop
      pdp.set(b.amount, await pingOneAuthorizeService.evaluateTransaction({
        userId: 'demoUser', amount: b.amount, type: 'transfer', acr: 'Password',
      }));
    }
  }, 60_000);

  test('the PDP does not answer the same thing for every amount', () => {
    const shapes = BANDS.map((b) => {
      const r = pdp.get(b.amount) || {};
      return `${String(r.decision)}:${statementCodes(r).sort().join('+')}`;
    });
    if (new Set(shapes).size === 1) {
      throw new Error(
        `Every amount got the SAME decision from the live policy: ${shapes[0]}. The bands have ` +
          `collapsed — the Transaction policy is unlinked from the decision endpoint, disabled, ` +
          `or no longer receiving the Amount attribute. The mocked band suite cannot see this.`,
      );
    }
  });

  test('the ceiling really denies', () => {
    const r = pdp.get(2500) || {};
    if (String(r.decision).toUpperCase() !== 'DENY') {
      throw new Error(
        `$2500 returned ${JSON.stringify(r.decision)}, not DENY. The $2,000 ceiling is not being ` +
          `enforced by the live policy, so UC6 demos a permit. Statements: ` +
          `${JSON.stringify(statementCodes(r))}`,
      );
    }
  });

  test('$600 carries a step-up obligation, not only consent', () => {
    // The specific flattening seen on 2026-08-03: consent present, step-up absent,
    // so UC7 demoed UC8's gate.
    const codes = statementCodes(pdp.get(600)).map((c) => c.toUpperCase());
    const hasStepUp = codes.some((c) => c.replace(/[^A-Z0-9]/g, '').includes('STEPUP'));
    if (!hasStepUp) {
      throw new Error(
        `$600 came back without a step-up statement (got ${JSON.stringify(codes)}). UC7 would ` +
          `demonstrate consent instead of step-up — the two look alike in the UI and only ` +
          `differ in the reply text.`,
      );
    }
  });

  test.each(BANDS.map((b) => [`$${b.amount} (${b.ucId}) → ${b.expect}`, b]))(
    'BFF maps %s',
    async (_label, b) => {
      const out = await _applyTransactionPolicy(
        { decision: 'PERMIT', permit: true },
        { amount: b.amount, transactionType: 'transfer', userId: 'demoUser', acr: 'Password' },
      );
      const gate = gateOf(out);
      if (gate !== b.expect) {
        const r = pdp.get(b.amount) || {};
        throw new Error(
          `$${b.amount} (${b.ucId}) enforced "${gate}", expected "${b.expect}" — ${b.why}. ` +
            `Live PDP said decision=${r.decision} statements=` +
            `${JSON.stringify(statementCodes(r))}. If the PDP payload is ` +
            `right, the drift is in the BFF classifier; if it is wrong, the policy changed.`,
        );
      }
      // Provenance: the gate must come from the Transaction policy, never be
      // synthesized locally — a locally-invented gate would pass the assertion
      // above while proving nothing about PingOne.
      if (b.expect !== 'none') {
        expect(out.secondaryEvaluation && out.secondaryEvaluation.source).toBe('transaction-policy');
      }
    },
    30_000,
  );
});
