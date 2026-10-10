import { describe, expect, it } from "vitest";
import UC44 from "../UC44";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC44 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC44).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC44.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC44.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC44.EDGES.length);
  });
});
