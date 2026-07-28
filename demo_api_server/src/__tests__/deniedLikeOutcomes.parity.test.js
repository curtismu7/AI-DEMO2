'use strict';

/**
 * Drift gate: the UI's DENIED_LIKE_OUTCOMES / EXPECTED_OUTCOME_FAMILY (in
 * demo_api_ui/src/context/ProofOfEnforcementContext.js) must match the backend
 * mirror in services/stepVerificationExpectations.js, and between them they
 * must classify every deny-like expectedOutcome the catalog actually uses.
 *
 * Why: computeVerdict keys "was this run supposed to be refused" on
 * DENIED_LIKE_OUTCOMES membership. An outcome missing from the set falls
 * through to the `decision === 'PERMIT'` branch, so a use case whose entire
 * point is that the call is blocked renders as plain 'verified' (when no
 * decision was recorded) or 'mismatch' (when one was) — never
 * 'denied-as-expected'. DENY_503 (UC29) was missing exactly this way.
 *
 * The UI file is JSX with imports, so it cannot be vm-loaded like
 * requiredDemoFlags.js. Parse the two literals out of the source instead.
 */

const fs = require('fs');
const path = require('path');

const {
  DENIED_LIKE_OUTCOMES,
  EXPECTED_OUTCOME_FAMILY,
  OUTCOME_TO_GATE,
  isDeniedLikeOutcome,
  expectationFromUseCase,
} = require('../../services/stepVerificationExpectations');
const { USE_CASES } = require('../../config/useCases');

const UI_PATH = path.resolve(
  __dirname,
  '../../../demo_api_ui/src/context/ProofOfEnforcementContext.js',
);

const uiSrc = fs.readFileSync(UI_PATH, 'utf8');

/** Extract the string members of `const <name> = new Set([...])`. */
function parseUiSet(name) {
  const m = uiSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`could not find ${name} in ${UI_PATH}`);
  return new Set((m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
}

/** Extract the key→value pairs of `const <name> = { ... };`. */
function parseUiMap(name) {
  const m = uiSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) throw new Error(`could not find ${name} in ${UI_PATH}`);
  const out = {};
  for (const pair of m[1].match(/(\w+)\s*:\s*'([^']+)'/g) || []) {
    const [, k, v] = pair.match(/(\w+)\s*:\s*'([^']+)'/);
    out[k] = v;
  }
  return out;
}

describe('denied-like outcome parity (UI computeVerdict vs backend expectations)', () => {
  test('DENIED_LIKE_OUTCOMES is identical on both sides', () => {
    expect([...parseUiSet('DENIED_LIKE_OUTCOMES')].sort())
      .toEqual([...DENIED_LIKE_OUTCOMES].sort());
  });

  test('EXPECTED_OUTCOME_FAMILY is identical on both sides', () => {
    expect(parseUiMap('EXPECTED_OUTCOME_FAMILY')).toEqual(EXPECTED_OUTCOME_FAMILY);
  });

  test('every deny-like outcome has a family', () => {
    for (const outcome of DENIED_LIKE_OUTCOMES) {
      expect(EXPECTED_OUTCOME_FAMILY[outcome]).toBeTruthy();
    }
  });

  test('every DENY_* outcome the catalog uses is classified deny-like', () => {
    // The regression shape: a new DENY_<code> lands in the catalog, nobody adds
    // it to the set, and that use case silently renders as a success.
    const unclassified = [...new Set(USE_CASES.map((u) => u.expectedOutcome))]
      .filter((o) => typeof o === 'string' && /^DENY(_|$)/.test(o))
      .filter((o) => !isDeniedLikeOutcome(o));
    expect(unclassified).toEqual([]);
  });

  test('UC29 (DENY_503) is deny-like — the case this gate was written for', () => {
    const uc29 = USE_CASES.find((u) => u.id === 'UC29');
    expect(uc29.expectedOutcome).toBe('DENY_503');
    const exp = expectationFromUseCase(uc29);
    expect(exp.deniedLike).toBe(true);
    expect(exp.outcomeFamily).toBe('DENY');
  });

  test('OUTCOME_TO_GATE stays amount-gate-only', () => {
    // Guards the scope note on OUTCOME_TO_GATE. These are attack-trigger cases
    // with no amount and no primaryTool; adding them to the gate map would pull
    // them into amount-band assertions (DENY >= 2000 etc.) that cannot apply.
    for (const outcome of ['DENY_401', 'DENY_403', 'DENY_429', 'DENY_503']) {
      expect(OUTCOME_TO_GATE[outcome]).toBeUndefined();
      expect(isDeniedLikeOutcome(outcome)).toBe(true);
    }
    expect(Object.keys(OUTCOME_TO_GATE).sort()).toEqual(['DENY', 'HITL_REQUIRED', 'STEP_UP']);
  });

  test('PERMIT-family outcomes are not deny-like', () => {
    for (const outcome of ['PERMIT', 'GUIDED_DEMO', 'RANKED_RESULTS', 'DELEGATE_AND_EXECUTE']) {
      expect(isDeniedLikeOutcome(outcome)).toBe(false);
    }
  });
});
