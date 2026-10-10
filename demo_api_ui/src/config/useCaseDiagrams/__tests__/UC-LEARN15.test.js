import { describe, expect, it } from "vitest";
import UC_LEARN15 from "../UC-LEARN15";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-LEARN15 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_LEARN15).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_LEARN15.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_LEARN15.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_LEARN15.EDGES.length);
  });
});
