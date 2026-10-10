import { describe, expect, it } from "vitest";
import UC_LOGIN from "../UC-LOGIN";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-LOGIN config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_LOGIN).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_LOGIN.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_LOGIN.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_LOGIN.EDGES.length);
  });
});
