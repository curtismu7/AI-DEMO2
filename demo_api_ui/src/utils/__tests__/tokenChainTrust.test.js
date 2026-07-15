import { deriveTrustPosture, isFlagOn, shouldShowTrustTab } from "../tokenChainTrust";

describe("isFlagOn", () => {
  it("accepts boolean and string true", () => {
    expect(isFlagOn(true)).toBe(true);
    expect(isFlagOn("true")).toBe(true);
    expect(isFlagOn(false)).toBe(false);
    expect(isFlagOn("false")).toBe(false);
    expect(isFlagOn(undefined)).toBe(false);
  });
});

describe("deriveTrustPosture", () => {
  it("detects DPoP cnf.jkt and RAR authorization_details", () => {
    const posture = deriveTrustPosture([
      { id: "dpop-binding", claims: { cnf: { jkt: "abc1234567890xyz" } } },
      { id: "rar-authorization", claims: { authorization_details: [{ tool: "create_transfer", amount: 50 }] } },
    ]);
    expect(posture.dpopBound).toBe(true);
    expect(posture.jkt).toBe("abc1234567890xyz");
    expect(posture.rarScoped).toBe(true);
    expect(posture.details.tool).toBe("create_transfer");
  });

  it("treats intent-binding-verified as RAR-scoped without details", () => {
    const posture = deriveTrustPosture([{ id: "intent-binding-verified", status: "active" }]);
    expect(posture.rarScoped).toBe(true);
    expect(posture.details).toBeNull();
  });
});

describe("shouldShowTrustTab", () => {
  it("shows when ff_dpop or ff_rar is armed", () => {
    expect(shouldShowTrustTab({ ffDpop: true })).toBe(true);
    expect(shouldShowTrustTab({ ffRar: true })).toBe(true);
    expect(shouldShowTrustTab({})).toBe(false);
  });

  it("shows when live evidence exists even if flags unread", () => {
    expect(shouldShowTrustTab({
      events: [{ id: "dpop-binding", cnf: { jkt: "thumb" } }],
    })).toBe(true);
  });
});
