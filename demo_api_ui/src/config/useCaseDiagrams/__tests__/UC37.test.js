import { describe, expect, it } from "vitest";
import UC37 from "../UC37";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC37 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC37).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC37.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC37.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC37.EDGES.length);
  });
});
