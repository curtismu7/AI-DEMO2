import { describe, expect, it } from "vitest";
import UC_MUSE2 from "../UC-MUSE2";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-MUSE2 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_MUSE2).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_MUSE2.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_MUSE2.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_MUSE2.EDGES.length);
  });
});
