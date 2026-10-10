import { describe, expect, it } from "vitest";
import UC46A from "../UC46A";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC46A config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC46A).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC46A.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC46A.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC46A.EDGES.length);
  });
});
