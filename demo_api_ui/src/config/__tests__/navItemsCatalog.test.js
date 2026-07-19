import { describe, it, expect } from "vitest";
import { NAV_ITEM_CATALOG } from "../navItemsCatalog";

describe("NAV_ITEM_CATALOG", () => {
  it("has no duplicate labels", () => {
    expect(new Set(NAV_ITEM_CATALOG).size).toBe(NAV_ITEM_CATALOG.length);
  });

  it("does not include the Demo Config page's own link", () => {
    expect(NAV_ITEM_CATALOG).not.toContain("Demo Config");
  });

  it("includes core top-level sections", () => {
    expect(NAV_ITEM_CATALOG).toContain("Dashboard");
    expect(NAV_ITEM_CATALOG).toContain("Authorize");
    expect(NAV_ITEM_CATALOG).toContain("Learn & Present");
  });
});
