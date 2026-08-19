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
  // BEFORE the flip: pause arrives as INDETERMINATE (+ obligation since phase 2).
  const preFlip = {
    decision: "INDETERMINATE",
    response: { decision: "INDETERMINATE", obligations: [{ id: "STEP_UP", type: "STEP_UP", obligatory: true, fulfilled: false }] },
  };
  // AFTER the flip: the same pause arrives as DENY carrying the obligation.
  const postFlip = {
    decision: "DENY",
    response: { decision: "DENY", obligations: [{ id: "STEP_UP", type: "STEP_UP", obligatory: true, fulfilled: false }] },
  };

  test("both wire shapes read as a pause", () => {
    expect(isPause("INDETERMINATE", preFlip)).toBe(true);
    expect(isPause("DENY", postFlip)).toBe(true);
  });

  test("a REAL deny — DENY with no pause obligation — is not a pause", () => {
    const realDeny = { decision: "DENY", response: { decision: "DENY", statements: [{ code: "transaction-denied" }] } };
    expect(isPause("DENY", realDeny)).toBe(false);
  });

  // Phase 5 will make a bare INDETERMINATE an error. Until then it must keep
  // reading as a pause, or the flip's intermediate state breaks UC7/UC8.
  test("a bare INDETERMINATE with no obligation still reads as a pause pre-phase-5", () => {
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
