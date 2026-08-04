/**
 * The transport status of a step-up block is NOT stable, and the agent's
 * resume handlers used to assume it was.
 *
 * `ff_rfc9470_challenge` defaults ON, so transactionAuthorizationService's
 * buildStepUpBlock answers 401 + WWW-Authenticate (RFC 9470). Only with the
 * flag explicitly OFF does it answer the legacy 428. The post-consent resume
 * in AIAgent.js gated on `statusCode === 428`, so with the default flag a
 * step-up demanded after HITL consent fell through every branch and the agent
 * dead-ended silently.
 *
 * The code (`step_up_required` / `mcp_step_up_required`) is carried in BOTH
 * modes and is the stable signal — but the status still has to be checked, or
 * an unrelated error that happens to carry the code would be treated as a
 * live challenge.
 */
import { describe, expect, test } from "vitest";
import { isApprovalBlockError, isStepUpBlockError } from "../stepUpError";

describe("isStepUpBlockError", () => {
  test("accepts the RFC 9470 401 challenge (ff_rfc9470_challenge default ON)", () => {
    expect(
      isStepUpBlockError({ statusCode: 401, code: "step_up_required" }),
    ).toBe(true);
    expect(
      isStepUpBlockError({ statusCode: 401, code: "mcp_step_up_required" }),
    ).toBe(true);
  });

  test("still accepts the legacy 428 block (flag explicitly OFF)", () => {
    expect(
      isStepUpBlockError({ statusCode: 428, code: "step_up_required" }),
    ).toBe(true);
    expect(
      isStepUpBlockError({ statusCode: 428, code: "mcp_step_up_required" }),
    ).toBe(true);
  });

  test("reads an axios-shaped error as well as a thrown fetch error", () => {
    expect(
      isStepUpBlockError({
        response: { status: 401 },
        code: "step_up_required",
      }),
    ).toBe(true);
  });

  test("a plain 401 is NOT a step-up — session expiry must keep re-authenticating", () => {
    expect(isStepUpBlockError({ statusCode: 401 })).toBe(false);
    expect(
      isStepUpBlockError({ statusCode: 401, code: "authentication_required" }),
    ).toBe(false);
  });

  test("consent blocks are not step-up blocks", () => {
    expect(
      isStepUpBlockError({ statusCode: 428, code: "hitl_required" }),
    ).toBe(false);
  });

  test("no error, or no status, is not a block", () => {
    expect(isStepUpBlockError(null)).toBe(false);
    expect(isStepUpBlockError({ code: "step_up_required" })).toBe(false);
  });
});

describe("isApprovalBlockError", () => {
  test("covers consent and step-up in both spellings", () => {
    for (const code of [
      "hitl_required",
      "mcp_hitl_required",
      "step_up_required",
      "mcp_step_up_required",
    ]) {
      expect(isApprovalBlockError({ code })).toBe(true);
    }
  });

  test("a genuine session failure is not an approval block", () => {
    expect(isApprovalBlockError({ code: "authentication_required" })).toBe(
      false,
    );
    expect(isApprovalBlockError({ code: "session_not_hydrated" })).toBe(false);
    expect(isApprovalBlockError(null)).toBe(false);
  });
});
