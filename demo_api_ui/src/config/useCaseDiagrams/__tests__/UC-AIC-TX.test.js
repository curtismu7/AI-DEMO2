import { describe, expect, it } from "vitest";
import UC_AIC_TX from "../UC-AIC-TX";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-AIC-TX config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_AIC_TX).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_AIC_TX.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_AIC_TX.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_AIC_TX.EDGES.length);
  });
});
