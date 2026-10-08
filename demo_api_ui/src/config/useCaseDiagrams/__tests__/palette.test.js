import { describe, expect, it } from "vitest";
import { PARTICIPANT_GROUPS } from "../palette";

describe("PARTICIPANT_GROUPS", () => {
  it("covers the six standard roles", () => {
    expect(Object.keys(PARTICIPANT_GROUPS).sort()).toEqual(
      ["agent", "external", "gateway", "pingone", "resource", "user"],
    );
  });

  it("uses theme tokens, never literal colors (light/dark safe)", () => {
    for (const g of Object.values(PARTICIPANT_GROUPS)) {
      expect(g.label).toBeTruthy();
      expect(g.bg).toMatch(/^var\(--/);
      expect(g.bg).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb/);
    }
  });
});
