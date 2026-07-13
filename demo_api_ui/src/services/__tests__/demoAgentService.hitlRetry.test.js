/**
 * Regression: createTransfer/createDeposit/createWithdrawal silently dropped
 * the caller's hitlChallengeId argument, so the isMcpHitl approval-retry path
 * (AIAgent.js runAction -> hitlRetryChallengeId) never echoed the approved
 * challenge back to the BFF gate. The gate (mcpToolAuthorizationService)
 * fails closed without params._hitl_challenge_id, so the retry re-issued the
 * same 428 instead of being permitted.
 */
import { createTransfer, createDeposit, createWithdrawal } from "../demoAgentService";

describe("HITL-approval retry echoes _hitl_challenge_id into MCP tool params", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const mockFetchOk = () =>
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ result: { ok: true } }),
    });

  const bodyOf = (fetchSpy) => JSON.parse(fetchSpy.mock.calls[0][1].body);

  it("createTransfer forwards hitlChallengeId as params._hitl_challenge_id", async () => {
    const fetchSpy = mockFetchOk();
    await createTransfer("acc-chk", "acc-sav", 500, "note", "chal-123");
    expect(bodyOf(fetchSpy).params._hitl_challenge_id).toBe("chal-123");
  });

  it("createTransfer omits _hitl_challenge_id when no challenge id given", async () => {
    const fetchSpy = mockFetchOk();
    await createTransfer("acc-chk", "acc-sav", 500, "note");
    expect(bodyOf(fetchSpy).params._hitl_challenge_id).toBeUndefined();
  });

  it("createDeposit forwards hitlChallengeId as params._hitl_challenge_id", async () => {
    const fetchSpy = mockFetchOk();
    await createDeposit("acc-chk", 500, "note", "chal-456");
    expect(bodyOf(fetchSpy).params._hitl_challenge_id).toBe("chal-456");
  });

  it("createWithdrawal forwards hitlChallengeId as params._hitl_challenge_id", async () => {
    const fetchSpy = mockFetchOk();
    await createWithdrawal("acc-chk", 500, "note", "chal-789");
    expect(bodyOf(fetchSpy).params._hitl_challenge_id).toBe("chal-789");
  });
});
