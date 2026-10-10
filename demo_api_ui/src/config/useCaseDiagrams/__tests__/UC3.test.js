import { describe, expect, it } from "vitest";
import UC3 from "../UC3";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC3 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC3).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC3.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC3.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC3.EDGES.length);
  });
});
