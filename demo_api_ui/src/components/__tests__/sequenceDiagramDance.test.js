// demo_api_ui/src/components/__tests__/sequenceDiagramDance.test.js
import { SCENARIOS } from "../SequenceDiagramPage";

describe("401 discovery dance steps", () => {
  const ALL = SCENARIOS["full-flow"];
  const idx = (id) => ALL.findIndex((s) => String(s.step) === String(id));
  test("both dance legs exist exactly once, with lettered ids", () => {
    for (const id of ["5a", "5b", "25a", "25b"]) {
      expect(ALL.filter((s) => String(s.step) === id)).toHaveLength(1);
    }
  });
  test("5a/5b sit between the tool-list note and the credentialed tools/list", () => {
    expect(idx("5a")).toBeGreaterThan(0);
    expect(idx("5b")).toBe(idx("5a") + 1);
    expect(idx(5)).toBe(idx("5b") + 1);
  });
  test("25a/25b sit immediately before the credentialed tools/call (step 26)", () => {
    expect(idx("25b")).toBe(idx("25a") + 1);
    expect(idx(26)).toBe(idx("25b") + 1);
  });
  test("discovery-dance scenario contains both dances and the credentialed calls", () => {
    const steps = SCENARIOS["discovery-dance"];
    expect(steps.map((s) => String(s.step))).toEqual(expect.arrayContaining(["5a", "5b", "25a", "25b", "5", "26"]));
  });
  test("dance steps are not stripped by the authenticated filter (not in 18a-18d)", () => {
    const filtered = SCENARIOS["full-flow"].filter((s) => !["18a", "18b", "18c", "18d"].includes(String(s.step)));
    expect(filtered.map((s) => String(s.step))).toEqual(expect.arrayContaining(["5a", "25a"]));
  });
});
