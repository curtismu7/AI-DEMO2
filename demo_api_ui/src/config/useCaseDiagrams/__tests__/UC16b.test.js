import { describe, expect, it } from "vitest";
import UC16b from "../UC16b";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC16b config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC16b).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC16b.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC16b.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC16b.EDGES.length);
  });
});
