// demo_api_ui/src/utils/__tests__/agentHitlIntentFromResponse.test.js
import {
  buildBankingHitlPendingFromAgentResponse,
  buildBankingStepUpReplayFromAgentResponse,
  isBankingStepUpAgentResponse,
} from "../agentHitlIntentFromResponse";

describe("buildBankingHitlPendingFromAgentResponse", () => {
  it("populates form fromId/toId/amount so consent replay can call createTransferWithConsent", () => {
    const pending = buildBankingHitlPendingFromAgentResponse({
      error: "hitl_required",
      transactionType: "transfer",
      transactionAmount: 300,
      fromAccountId: "acc-checking",
      toAccountId: "acc-savings",
      hitl_threshold_usd: 250,
      hitlChallengeId: "chal-1",
    });
    expect(pending).toEqual({
      actionId: "transfer",
      form: {
        fromId: "acc-checking",
        toId: "acc-savings",
        amount: "300",
        accountId: "acc-checking",
        note: "Agent transfer",
      },
      intentPayload: {
        type: "transfer",
        fromAccountId: "acc-checking",
        toAccountId: "acc-savings",
        amount: 300,
        description: "Agent transfer",
      },
      threshold: 250,
      hitlChallengeId: "chal-1",
    });
    // Regression: empty form {} made createTransferWithConsent(undefined, undefined, NaN) fail.
    expect(pending.form.fromId).toBeTruthy();
    expect(pending.form.toId).toBeTruthy();
    expect(Number(pending.form.amount)).toBe(300);
  });

  it("returns null when transactionAmount is missing (vertical HITL uses a different path)", () => {
    expect(
      buildBankingHitlPendingFromAgentResponse({
        error: "hitl_required",
        action: "release_records",
        hitlChallengeId: "chal-v",
      }),
    ).toBeNull();
  });
});

describe("buildBankingStepUpReplayFromAgentResponse", () => {
  it("builds a runAction-compatible replay for Demo Steps UC7 ($600 step-up)", () => {
    expect(isBankingStepUpAgentResponse({
      error: "step_up_required",
      transactionAmount: 600,
      transactionType: "transfer",
      fromAccountId: "a1",
      toAccountId: "a2",
      hitlChallengeId: "chal-su",
    })).toBe(true);

    const replay = buildBankingStepUpReplayFromAgentResponse({
      error: "mcp_step_up_required",
      transactionAmount: 600,
      transactionType: "transfer",
      fromAccountId: "a1",
      toAccountId: "a2",
      hitlChallengeId: "chal-su",
    });
    expect(replay.actionId).toBe("transfer");
    expect(replay.form).toEqual({
      fromId: "a1",
      toId: "a2",
      amount: "600",
      accountId: "a1",
      note: "Agent transfer",
    });
    expect(replay.hitlRetryChallengeId).toBe("chal-su");
  });
});
