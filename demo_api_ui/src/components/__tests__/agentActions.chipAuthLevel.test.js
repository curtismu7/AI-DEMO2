// SoT for chip auth levels — the "and we have SoT" half of the product rule
// "show all actions, then authenticate when the UC requires it".
//
// Chips are not use cases, so they carry no server-side `uc.auth`; their levels
// are declared in agentActions.js and read through chipAuthLevel(). This pins
// the FAIL-CLOSED default, because the failure mode of getting it wrong is
// showing a guest a chip that 401s instead of offering sign-in.

import {
  ACTION_GROUPS,
  ACTIONS,
  chipAuthLevel,
  PUBLIC_CHIP_IDS,
  ADMIN_CHIP_IDS,
} from "../agentActions";

describe("chipAuthLevel — declared SoT for chip dispatch auth", () => {
  it("defaults to 'user' for anything not explicitly declared (fail-closed)", () => {
    expect(chipAuthLevel({ id: "some-chip-added-tomorrow" })).toBe("user");
    // A missing/blank id must not fall through to public either.
    expect(chipAuthLevel({})).toBe("user");
    expect(chipAuthLevel(null)).toBe("user");
  });

  it("returns 'public' only for the declared public ids", () => {
    for (const id of PUBLIC_CHIP_IDS) {
      expect(chipAuthLevel({ id })).toBe("public");
    }
  });

  it("returns 'admin' for the declared admin ids", () => {
    for (const id of ADMIN_CHIP_IDS) {
      expect(chipAuthLevel({ id })).toBe("admin");
    }
  });

  it("every money-moving and account-data chip requires at least a session", () => {
    // The chips whose whole point is user context — none may be public.
    const mustNotBePublic = [
      ...ACTION_GROUPS.account.map((a) => a.id).filter((id) => id !== "sequential_think"),
      ...ACTION_GROUPS.transaction.map((a) => a.id),
    ];
    for (const id of mustNotBePublic) {
      expect(chipAuthLevel({ id })).not.toBe("public");
    }
  });

  it("declared ids all correspond to real chips (no stale entries)", () => {
    const realIds = new Set(ACTIONS.map((a) => a.id));
    for (const id of [...PUBLIC_CHIP_IDS, ...ADMIN_CHIP_IDS]) {
      expect(realIds.has(id)).toBe(true);
    }
  });

  it("every chip resolves to exactly one of the three levels", () => {
    for (const action of ACTIONS) {
      expect(["public", "user", "admin"]).toContain(chipAuthLevel(action));
    }
  });
});
