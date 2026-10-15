// demo_api_ui/src/config/__tests__/navStructureCatalog.test.js
import { applyChildOrder, NAV_STRUCTURE_CATALOG } from "../navStructureCatalog";

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

describe("PingOne platform navigation", () => {
  const group = (label) => NAV_STRUCTURE_CATALOG.find((item) => item.label === label);

  it("keeps the DaVinci learning links in their product group", () => {
    expect(group("DaVinci").children).toEqual([
      "DaVinci Widget",
      "DaVinci Login",
      "DaVinci SDK Login",
      "DaVinci Orchestration",
      "DaVinci Orchestration SDK",
      "Orchestration SDK Guide",
      "DaVinci Orchestration Overview",
      "PingFederate DaVinci Integration Kit",
    ]);
  });

  it("places RAG in Exploring (E6) and treats Headless Identity as a product", () => {
    expect(group("Agent Privilege").children).toContain("AI Guard");
    expect(group("Exploring").children).toContain("Protected RAG");
    expect(group("Ping products").children).toContain("Headless Identity / PingCLI");
  });

  it("provides a utility group for test, debug, and setup tools", () => {
    expect(group("Utilities").children).toEqual([
      "PingOne Test",
      "MFA Test",
      "OAuth Debug",
      "Token Exchange Tester",
      "Management API Runner",
      "PingOne MCP Setup",
      "MCP Discovery",
      "Resource Server Checkpoint",
      "Scope Reference",
      "Snapshot Import",
      "Health Check",
    ]);
  });

  it("consolidates the four Exploring pages under the Exploring group (E6)", () => {
    expect(group("Exploring").children).toEqual([
      "Code Explorer",
      "OAuth Academy",
      "Protected RAG",
      "OAS Demo",
    ]);
    // none of them remain in their former groups
    expect(group("Identity Journeys").children).not.toContain("OAuth Academy");
    expect(group("Identity Journeys").children).not.toContain("OAS Demo");
    expect(group("Developer Tools").children).not.toContain("Code Explorer");
  });

  it("keeps reports, logs, traces, and service-flow diagrams under Observability", () => {
    expect(group("Observability").children).toEqual(expect.arrayContaining([
      "Run Reports",
      "Audit Trail",
      "Tracing",
      "System Flow",
      "Service Graph",
      "MCP Observability",
      "CI Queue Dashboard",
    ]));
  });

  it("places use-case diagrams with the groups they explain", () => {
    expect(group("Identity Journeys").children).toContain("Identity Journey Map");
    expect(group("AI Experiences").children).toEqual(expect.arrayContaining([
      "Agent Onboarding Flow (Node)",
      "Agent Onboarding Flow Subway (Node)",
    ]));
    expect(group("Observability").children).toContain("System Flow");
    expect(group("Architecture & Learning").children).not.toContain("System Flow (Live)");
    expect(group("Architecture & Learning").children).not.toContain("Agent Onboarding Flow (Node)");
  });
});
