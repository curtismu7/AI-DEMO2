import { describe, expect, it } from "vitest";
import UC23 from "../UC23";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC23 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC23).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC23.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC23.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC23.EDGES.length);
  });
});
