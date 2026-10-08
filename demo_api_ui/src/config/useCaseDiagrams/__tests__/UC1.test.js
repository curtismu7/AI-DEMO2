import { describe, expect, it } from "vitest";
import UC1 from "../UC1";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC1 config", () => {
  it("passes structural validation", () => {
    const res = validateConfig(UC1);
    expect(res.errors).toEqual([]);
  });

  it("is a real demo step with guide data to import (never duplicated)", () => {
    expect(DEMO_STEP_GUIDES[UC1.id]).toBeTruthy();
    expect(demoStepNumber(UC1.id)).toBeGreaterThan(0);
    expect(UC1.result.tone).toMatch(/^(ok|warn|err|info)$/);
  });

  it("only uses palette groups", () => {
    for (const n of UC1.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });

  it("walk covers every edge with tech rows per step", () => {
    const covered = new Set(UC1.walk.flatMap((w) => w.edges));
    expect(covered.size).toBe(UC1.EDGES.length);
    for (const w of UC1.walk) {
      expect(w.tech.length).toBeGreaterThan(0);
      for (const row of w.tech) expect(row.t).toMatch(/^(API|TOKEN|A2A|POLICY)$/);
    }
  });

  it("every node carries a detail sentence (click-to-inspect contract)", () => {
    for (const n of UC1.NODES) expect(n.detail).toBeTruthy();
  });
});
