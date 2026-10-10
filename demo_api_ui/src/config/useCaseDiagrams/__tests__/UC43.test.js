import { describe, expect, it } from "vitest";
import UC43 from "../UC43";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC43 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC43).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC43.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC43.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC43.EDGES.length);
  });
});
