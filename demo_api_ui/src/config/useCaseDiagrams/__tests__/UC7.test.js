import { describe, expect, it } from "vitest";
import UC7 from "../UC7";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC7 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC7).errors).toEqual([]);
  });

  it("is a real demo step with guide data to import", () => {
    expect(DEMO_STEP_GUIDES[UC7.id]).toBeTruthy();
    expect(demoStepNumber(UC7.id)).toBeGreaterThan(0);
    expect(UC7.result.tone).toBe("warn");
  });

  it("only uses palette groups and covers every edge", () => {
    for (const n of UC7.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    expect(new Set(UC7.walk.flatMap((w) => w.edges)).size).toBe(UC7.EDGES.length);
  });

  it("every node carries a detail sentence (click-to-inspect contract)", () => {
    for (const n of UC7.NODES) expect(n.detail).toBeTruthy();
  });
});
