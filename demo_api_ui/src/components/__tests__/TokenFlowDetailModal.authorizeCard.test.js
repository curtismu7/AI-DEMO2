import { describe, it, expect } from "vitest";
import { resolveAuthorizeCard } from "../TokenFlowDetailModal";

/**
 * The scope-flow strip's PingOne Authorize card used to read
 * `outcome === 'INDETERMINATE'` as a hard DENY. INDETERMINATE is the legacy
 * signal for an approval GATE, so a step-up/HITL run painted a red
 * "DENY — action blocked" card directly beneath a banner that correctly said
 * the run was paused waiting on a human — the same defect as the banner bug,
 * in a renderer that does not go through buildRunStory.
 */
const azStep = (outcome, status = "active") => ({
  id: "authorize", status, detail: { decision: { outcome } },
});

describe("resolveAuthorizeCard", () => {
  it("shows an approval gate as HELD, not DENY", () => {
    const trace = {
      outcome: "error",
      authorize: { decision: "INDETERMINATE", outcome: "STEP_UP" },
      mcpResult: { tool: "extend_rental", status: "error", error: "mcp_step_up_required" },
    };
    expect(resolveAuthorizeCard(trace, [azStep("INDETERMINATE")]))
      .toEqual({ tone: "gate", verdict: "HELD", note: "awaiting step-up MFA" });
  });

  it("names the gate the run is actually held on", () => {
    const trace = {
      outcome: "error",
      authorize: { decision: "PERMIT", response: { obligations: [{ type: "HITL_CONSENT" }] } },
    };
    expect(resolveAuthorizeCard(trace, [azStep("PERMIT")]).note).toBe("awaiting consent");
  });

  it("stops saying 'awaiting' once the human has refused", () => {
    const trace = {
      outcome: "error",
      approvalOutcome: "declined",
      authorize: { decision: "INDETERMINATE", outcome: "STEP_UP" },
    };
    expect(resolveAuthorizeCard(trace, [azStep("INDETERMINATE")]))
      .toEqual({ tone: "gate", verdict: "DECLINED", note: "step-up MFA refused" });
  });

  it("still shows a real DENY as DENY", () => {
    const trace = { outcome: "error", authorize: { decision: "DENY", outcome: "DENY" } };
    const card = resolveAuthorizeCard(trace, [azStep("DENY", "error")]);
    expect(card.tone).toBe("deny");
    expect(card.verdict).toBe("DENY");
  });

  it("still shows a PERMIT as PERMIT", () => {
    const trace = { outcome: "ok", authorize: { decision: "PERMIT" } };
    expect(resolveAuthorizeCard(trace, [azStep("PERMIT", "done")]))
      .toEqual({ tone: "permit", verdict: "PERMIT", note: null });
  });

  it("renders no card when Authorize was not in this run's path", () => {
    expect(resolveAuthorizeCard({ outcome: "ok" }, [])).toBeNull();
  });
});
