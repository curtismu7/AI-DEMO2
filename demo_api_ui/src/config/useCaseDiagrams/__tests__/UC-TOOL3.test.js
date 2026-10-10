import { describe, expect, it } from "vitest";
import UC_TOOL3 from "../UC-TOOL3";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-TOOL3 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_TOOL3).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_TOOL3.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_TOOL3.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_TOOL3.EDGES.length);
  });
});
