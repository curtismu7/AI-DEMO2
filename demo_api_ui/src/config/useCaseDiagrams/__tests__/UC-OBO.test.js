import { describe, expect, it } from "vitest";
import UC_OBO from "../UC-OBO";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-OBO config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_OBO).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_OBO.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_OBO.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_OBO.EDGES.length);
  });
});
