import { describe, expect, it } from "vitest";
import { CONFIGS } from "../index";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_PRIMARY_USE_CASE_IDS } from "../../demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

// UCs the demo script promises but whose diagrams are not authored yet.
// This list SHRINKS as diagrams are added; when it is empty, every primary
// step has a diagram and the "all covered" test goes live. A UC may only sit
// here if it is NOT in CONFIGS; the last two tests enforce both directions.
const PENDING = new Set([
  "UC24", "UC8", "UC14b", "UC14", "UC12", "UC2", "UC2.5", "UC2.7",
  "UC22", "UC5", "UC10", "UC13", "UC11", "UC20", "UC18",
  // later additions discovered by the ratchet on first run — real script ids
  // whose diagrams are not authored yet (spec: 3 pilots first, rest follow)
  "UC30", "UC31", "UC32", "UC40", "UC38", "UC-TOOL1", "UC46", "UC47",
]);

const byId = new Map(CONFIGS.map((c) => [c.id, c]));

describe("use-case diagram standard", () => {
  it("every authored config passes structural validation", () => {
    for (const c of CONFIGS) {
      const res = validateConfig(c);
      expect([c.id, res.errors]).toEqual([c.id, []]);
    }
  });

  it("every authored config is a real demo step with guide data and a presenter number", () => {
    for (const c of CONFIGS) {
      expect(DEMO_STEP_GUIDES[c.id]).toBeTruthy();
      expect(demoStepNumber(c.id)).toBeGreaterThan(0);
    }
  });

  it("every authored config uses the shared palette (no local colors)", () => {
    for (const c of CONFIGS) {
      for (const n of c.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    }
  });

  it("walk covers every edge exactly once per diagram", () => {
    for (const c of CONFIGS) {
      const flat = c.walk.flatMap((w) => w.edges);
      expect(new Set(flat).size).toBe(flat.length);
      expect(new Set(flat).size).toBe(c.EDGES.length);
    }
  });

  it("PENDING ids exist in the demo script and are not authored", () => {
    for (const id of PENDING) {
      expect(DEMO_PRIMARY_USE_CASE_IDS).toContain(id);
      expect(byId.has(id)).toBe(false);
    }
  });

  it("every primary UC is either authored or explicitly PENDING (the ratchet)", () => {
    const uncovered = DEMO_PRIMARY_USE_CASE_IDS.filter((id) => !byId.has(id) && !PENDING.has(id));
    expect(uncovered).toEqual([]);
  });

  it("authored configs are never PENDING", () => {
    for (const c of CONFIGS) expect([...PENDING]).not.toContain(c.id);
  });
});
