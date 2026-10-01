import { describe, it, expect } from "vitest";
import { parsePageCatalog } from "../parsePageCatalog";
import catalogMd from "../../data/pageCatalog.md?raw";

describe("parsePageCatalog", () => {
  it("parses groups, pages and the four fields", () => {
    const groups = parsePageCatalog(
      "intro\n## G\n\n### P\n- **Route:** `/p` · **Auth:** user\n- **What it does:** a\n- **What it teaches:** b\n- **What it demos:** c\n",
    );
    expect(groups).toEqual([
      { label: "G", pages: [{ label: "P", route: "/p · Auth: user", does: "a", teaches: "b", demos: "c" }] },
    ]);
  });

  it("parses the shipped catalog", () => {
    const pages = parsePageCatalog(catalogMd).flatMap((g) => g.pages);
    expect(pages.length).toBeGreaterThan(150);
    expect(pages.find((p) => p.label === "Weather MCP").route).toContain("/weather-mcp");
    expect(pages.every((p) => p.does && p.teaches && p.demos)).toBe(true);
  });
});
