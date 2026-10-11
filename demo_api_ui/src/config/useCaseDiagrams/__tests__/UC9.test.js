import { describe, expect, it } from "vitest";
import UC9 from "../UC9";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC9 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC9).errors).toEqual([]);
  });

  it("is a real demo step with guide data to import", () => {
    expect(DEMO_STEP_GUIDES[UC9.id]).toBeTruthy();
    expect(demoStepNumber(UC9.id)).toBeGreaterThan(0);
    expect(UC9.result).toEqual({ label: "DENY", tone: "err" });
  });

  it("only uses palette groups and covers every edge", () => {
    for (const n of UC9.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    expect(new Set(UC9.walk.flatMap((w) => w.edges)).size).toBe(UC9.EDGES.length);
  });

  it("every node carries a detail sentence (click-to-inspect contract)", () => {
    for (const n of UC9.NODES) expect(n.detail).toBeTruthy();
  });

  it("names the group rule the story exists to prove", () => {
    // The diagram is the deny shape for MEMBERSHIP, not amount (that is UC6):
    // the walk must name the required privileged group and say the deny is
    // membership-based regardless of scopes, or it teaches nothing new.
    const walkText = UC9.walk.map((w) => `${w.title} ${w.label} ${w.lines.map((l) => l.text).join(" ")} ${w.tech.map((t) => t.c).join(" ")}`).join(" ");
    expect(walkText).toMatch(/privileged group/);
    expect(walkText).toMatch(/regardless of scopes|scopes insufficient/);
  });
});
