import { describe, expect, it } from "vitest";
import UC_NHI2 from "../UC-NHI2";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-NHI2 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_NHI2).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_NHI2.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_NHI2.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_NHI2.EDGES.length);
  });
});
