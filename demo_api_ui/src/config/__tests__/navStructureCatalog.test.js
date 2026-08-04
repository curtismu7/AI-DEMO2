// demo_api_ui/src/config/__tests__/navStructureCatalog.test.js
import { applyChildOrder } from "../navStructureCatalog";

const GROUPS = [
  { label: "Demos", children: ["Use Cases", "Demo Script"] },
  { label: "PingOne MCP", children: ["MCP Inspector", "PingOne MCP Setup"] },
  { label: "Home" },
];

describe("applyChildOrder", () => {
  it("returns groups unchanged for null/empty childOrder", () => {
    expect(applyChildOrder(GROUPS, null)).toBe(GROUPS);
    expect(applyChildOrder(GROUPS, {})).toEqual(GROUPS);
  });

  it("reorders children within a group", () => {
    const out = applyChildOrder(GROUPS, { Demos: ["Demo Script", "Use Cases"] });
    expect(out[0].children).toEqual(["Demo Script", "Use Cases"]);
    expect(out[1].children).toEqual(GROUPS[1].children);
  });

  it("moves a child claimed by another group out of its original group", () => {
    const out = applyChildOrder(GROUPS, {
      "PingOne MCP": ["Demo Script", "MCP Inspector", "PingOne MCP Setup"],
    });
    expect(out[0].children).toEqual(["Use Cases"]);
    expect(out[1].children).toEqual(["Demo Script", "MCP Inspector", "PingOne MCP Setup"]);
  });

  it("appends unclaimed children (added to the sidebar later) after the ordered ones", () => {
    const withNew = [
      { label: "Demos", children: ["Use Cases", "Demo Script", "Brand New Page"] },
      ...GROUPS.slice(1),
    ];
    const out = applyChildOrder(withNew, { Demos: ["Demo Script", "Use Cases"] });
    expect(out[0].children).toEqual(["Demo Script", "Use Cases", "Brand New Page"]);
  });

  it("drops saved labels that no longer exist anywhere", () => {
    const out = applyChildOrder(GROUPS, { Demos: ["Removed Page", "Use Cases", "Demo Script"] });
    expect(out[0].children).toEqual(["Use Cases", "Demo Script"]);
  });

  it("leaves flat entries and works with object children (sidebar items)", () => {
    const items = [
      { label: "Demos", children: [{ label: "Use Cases", path: "/use-cases" }] },
      { label: "PingOne MCP", children: [{ label: "MCP Inspector", path: "/pingone-mcp-inspector" }] },
      { label: "Home", path: "/" },
    ];
    const out = applyChildOrder(items, { "PingOne MCP": ["Use Cases", "MCP Inspector"] });
    expect(out[0].children).toEqual([]);
    expect(out[1].children.map((c) => c.label)).toEqual(["Use Cases", "MCP Inspector"]);
    expect(out[1].children[0].path).toBe("/use-cases");
    expect(out[2]).toBe(items[2]);
  });
});
