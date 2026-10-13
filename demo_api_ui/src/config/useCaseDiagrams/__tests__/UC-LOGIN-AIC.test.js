import { describe, expect, it } from "vitest";
import UC_LOGIN_AIC from "../UC-LOGIN-AIC";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-LOGIN-AIC config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_LOGIN_AIC).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_LOGIN_AIC.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_LOGIN_AIC.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_LOGIN_AIC.EDGES.length);
  });
});
