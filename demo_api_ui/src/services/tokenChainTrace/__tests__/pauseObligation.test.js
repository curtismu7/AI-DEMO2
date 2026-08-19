import { describe, test, expect } from "vitest";
import { classifyPauseObligation, pauseObligationKind, isPause } from "../pauseObligation";

/**
 * Phase 3c of the INDETERMINATE rework — the token-chain trace must recognise a
 * pause from its OBLIGATION, not only from the decision value, so that phase 4
 * (which stops the PDP emitting INDETERMINATE for pauses) does not turn every
 * step-up into a hard DENY on the trace. UC7/UC8 are REGRESSION_PLAN §1.
 *
 * The pivotal case is `isPause` returning the SAME answer for the pre-flip and
 * post-flip wire shapes. If that ever diverges, phase 4 breaks the trace.
 */

describe("classifyPauseObligation — vocabulary parity with the other three classifiers", () => {
  // Identical patterns to demo_api_server/services/authorizeObligations.js,
  // demo_mcp_gateway/src/auth/authorizeObligations.ts and the Groovy
  // p1az-decision classifier. Drift here is the bug that produced #2133 and
  // #2137, so it is pinned rather than trusted.
  test.each([
    ["STEP_UP", "stepUp"],
    ["step-up-required", "stepUp"],
    ["HITL_CONSENT", "consent"],
    ["HITL", "hitl"],
    ["HUMAN_APPROVAL", "hitl"],
    ["ELICITATION", "elicitation"],
  ])("classifies %s as %s", (id, expected) => {
    expect(classifyPauseObligation({ type: id })).toBe(expected);
  });

  test("HITL_CONSENT is consent, never generic hitl (most specific wins)", () => {
    expect(classifyPauseObligation({ type: "HITL_CONSENT" })).toBe("consent");
  });

  test.each(["type", "id", "code", "name"])(
    "reads the identifier from %s — all four, like the gateway classifier",
    (field) => {
      expect(classifyPauseObligation({ [field]: "STEP_UP" })).toBe("stepUp");
    },
  );

  test("returns null for a non-pause obligation", () => {
    expect(classifyPauseObligation({ type: "LOG_ONLY" })).toBeNull();
    expect(classifyPauseObligation({})).toBeNull();
    expect(classifyPauseObligation(null)).toBeNull();
  });
});

describe("pauseObligationKind — finds obligations wherever the trace carries them", () => {
  test.each([
    ["on the evaluation itself", { obligations: [{ type: "STEP_UP" }] }],
    ["under response", { response: { obligations: [{ type: "STEP_UP" }] } }],
    ["under raw", { raw: { obligations: [{ type: "STEP_UP" }] } }],
    ["under statements (PingOne rule effects)", { response: { statements: [{ code: "step-up-required" }] } }],
    ["under advice", { response: { advice: [{ type: "STEP_UP" }] } }],
    ["under details.obligations", { response: { details: { obligations: [{ type: "STEP_UP" }] } } }],
  ])("%s", (_label, evalObj) => {
    expect(pauseObligationKind(evalObj)).toBe("stepUp");
  });

  test("returns null when nothing pause-shaped is present", () => {
    expect(pauseObligationKind({ decision: "PERMIT", response: { obligations: [] } })).toBeNull();
    expect(pauseObligationKind(null)).toBeNull();
  });
});

describe("isPause — the phase-4 equivalence that makes the flip safe", () => {
  // BEFORE the flip: pause arrived as INDETERMINATE (+ obligation since phase 2).
  const preFlip = {
    decision: "INDETERMINATE",
    response: { decision: "INDETERMINATE", obligations: [{ id: "STEP_UP", type: "STEP_UP", obligatory: true, fulfilled: false }] },
  };
  // AFTER the flip (phase 4, shipped): the same pause arrives as PERMIT
  // carrying the obligation — cloud parity, and the only shape that does not
  // silently break the Node gateway or Groovy consumers (a DENY-with-
  // obligation is dropped by both; see routes/decision.js's pausePermit() doc
  // comment for the full rationale). decision.js can no longer emit anything
  // else for these three pauses.
  const postFlip = {
    decision: "PERMIT",
    response: { decision: "PERMIT", obligations: [{ id: "STEP_UP", type: "STEP_UP", obligatory: true, fulfilled: false }] },
  };
  // isPause() is deliberately decision-value-agnostic (obligation checked
  // first, decision value only as a legacy fallback) — proven here with a
  // shape that should never occur on the wire but would be a worse failure
  // mode if it somehow did.
  const hypotheticalDenyShape = {
    decision: "DENY",
    response: { decision: "DENY", obligations: [{ id: "STEP_UP", type: "STEP_UP", obligatory: true, fulfilled: false }] },
  };

  test("both real wire shapes (pre- and post-flip) read as a pause", () => {
    expect(isPause("INDETERMINATE", preFlip)).toBe(true);
    expect(isPause("PERMIT", postFlip)).toBe(true);
  });

  test("a REAL deny — DENY with no pause obligation — is not a pause", () => {
    const realDeny = { decision: "DENY", response: { decision: "DENY", statements: [{ code: "transaction-denied" }] } };
    expect(isPause("DENY", realDeny)).toBe(false);
  });

  test("a DENY carrying an obligation is still read as a pause (defensive — should never occur on the wire)", () => {
    expect(isPause("DENY", hypotheticalDenyShape)).toBe(true);
  });

  // demo_authz_server's phase-5 guard (routes/decision.js can no longer emit a
  // bare INDETERMINATE at all — see decision.indeterminateBaseline.test.js's
  // "phase 5 (mock half)") and its two direct consumers already fail closed on
  // one (PingOneAuthorizeClient.ts:468-478, p1az-decision.groovy ~1053). This
  // UI reader stays deliberately generous: a bare INDETERMINATE with no
  // obligation still reads as a pause here, on purpose. Unlike the gateway,
  // this function is display-only — it never gates a real authorization
  // decision, only how the trace renders one — and the transfer flow (which
  // DOES call live cloud P1AZ, the one engine that can legitimately return a
  // genuine eval-failure INDETERMINATE, per #1310) reads no decision field
  // from the BFF at all, so this fallback is unreachable from that path today.
  // Tightening it to render a bare INDETERMINATE as an error card instead is
  // real, separately-scoped display-correctness work, not required by phase
  // 4/5 as scoped to demo_authz_server and its direct consumers.
  test("a bare INDETERMINATE with no obligation still reads as a pause (deliberate, UI display only)", () => {
    expect(isPause("INDETERMINATE", { decision: "INDETERMINATE" })).toBe(true);
  });

  test("legacy STEP_UP / HITL_REQUIRED decision values keep working", () => {
    expect(isPause("STEP_UP", null)).toBe(true);
    expect(isPause("HITL_REQUIRED", null)).toBe(true);
  });

  test("PERMIT is never a pause", () => {
    expect(isPause("PERMIT", { decision: "PERMIT" })).toBe(false);
  });
});
