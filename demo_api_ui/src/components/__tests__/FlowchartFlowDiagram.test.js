import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutFlowchart } from "../FlowchartFlowDiagram";
import { buildFocusDiagram } from "../../utils/architectureFocus";
import { parseFlowchart } from "../../utils/parseFlowchart";

describe("layoutFlowchart", () => {
  it("lays the frontend slice of architecture.mmd out as nested React Flow nodes with one step per edge", async () => {
    const src = readFileSync(resolve(process.cwd(), "public/architecture/architecture.mmd"), "utf8");
    const flow = await layoutFlowchart(parseFlowchart(buildFocusDiagram(src, "frontend")));
    const ids = new Set(flow.nodes.map((n) => n.id));
    expect(flow.nodes.some((n) => n.type === "fgroup")).toBe(true);
    expect(flow.nodes.filter((n) => n.parentId).every((n) => ids.has(n.parentId))).toBe(true);
    // a parent is always listed before its children
    flow.nodes.forEach((n, i) => {
      if (n.parentId) expect(flow.nodes.findIndex((p) => p.id === n.parentId)).toBeLessThan(i);
    });
    expect(flow.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
    expect(flow.edges.length).toBeGreaterThan(5);
    expect(flow.steps).toHaveLength(flow.edges.length);
    expect(flow.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});
