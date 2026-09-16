import { describe, expect, it } from "vitest";
import { clampDetailPaneHeight } from "../detailPaneResize";

describe("detail pane resize", () => {
  it("keeps the detail height within the usable viewport bounds", () => {
    expect(clampDetailPaneHeight(80, 1000)).toBe(180);
    expect(clampDetailPaneHeight(500, 1000)).toBe(500);
    expect(clampDetailPaneHeight(900, 1000)).toBe(750);
  });
});
