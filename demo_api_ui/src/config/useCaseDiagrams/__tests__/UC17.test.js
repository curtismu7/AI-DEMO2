import { describe, expect, it } from "vitest";
import UC17 from "../UC17";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC17 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC17).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC17.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC17.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC17.EDGES.length);
  });
});
