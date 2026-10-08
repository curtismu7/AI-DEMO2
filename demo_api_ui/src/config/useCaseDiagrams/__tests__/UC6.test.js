import { describe, expect, it } from "vitest";
import UC6 from "../UC6";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC6 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC6).errors).toEqual([]);
  });

  it("is a real demo step with guide data to import", () => {
    expect(DEMO_STEP_GUIDES[UC6.id]).toBeTruthy();
    expect(demoStepNumber(UC6.id)).toBeGreaterThan(0);
    expect(UC6.result).toEqual({ label: "DENY", tone: "err" });
  });

  it("only uses palette groups and covers every edge", () => {
    for (const n of UC6.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    expect(new Set(UC6.walk.flatMap((w) => w.edges)).size).toBe(UC6.EDGES.length);
  });

  it("every node carries a detail sentence (click-to-inspect contract)", () => {
    for (const n of UC6.NODES) expect(n.detail).toBeTruthy();
  });
});
