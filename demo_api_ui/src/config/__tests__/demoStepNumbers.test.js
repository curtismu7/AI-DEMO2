import { describe, expect, it } from "vitest";
import { demoStepLabel, demoStepNumber, stepQueryMatches } from "../demoStepNumbers";

const step25 = { id: "UC46", number: 25, label: undefined };
const step25a = { id: "UC46A", number: 25, label: "25A" };
const step26 = { id: "UC47", number: 26, label: undefined };

describe("stepQueryMatches", () => {
  it("matches a step by its number, including its lettered sub-step", () => {
    expect(stepQueryMatches("25", step25)).toBe(true);
    expect(stepQueryMatches("25", step25a)).toBe(true);
    expect(stepQueryMatches("25", step26)).toBe(false);
  });

  it("matches a lettered label only on that step, in any case", () => {
    expect(stepQueryMatches("25a", step25a)).toBe(true);
    expect(stepQueryMatches("25A", step25a)).toBe(true);
    expect(stepQueryMatches("25a", step25)).toBe(false);
  });

  it("accepts the step / # prefix and ignores spaces in a use-case id", () => {
    expect(stepQueryMatches("step 26", step26)).toBe(true);
    expect(stepQueryMatches("Step26", step26)).toBe(true);
    expect(stepQueryMatches("#26", step26)).toBe(true);
    expect(stepQueryMatches("uc 46", step25)).toBe(true);
    expect(stepQueryMatches("uc46a", step25a)).toBe(true);
  });

  it("never matches an empty query", () => {
    expect(stepQueryMatches("", step25)).toBe(false);
    expect(stepQueryMatches("  ", step25)).toBe(false);
    expect(stepQueryMatches("step", step25)).toBe(false);
  });

  it("agrees with the numbering: 26A shares 26, Step 27 is untouched", () => {
    expect(demoStepNumber("UC46A")).toBe(26);
    expect(demoStepLabel("UC46A")).toBe("26A");
    expect(demoStepNumber("UC47")).toBe(27);
  });
});
