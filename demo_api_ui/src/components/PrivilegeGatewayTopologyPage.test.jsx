// Guards the diagram data on the Privilege Gateway Topologies page. Every tab is now a
// static React Flow graph (StaticFlowDiagram) — the Mermaid renderer is gone — so the
// guards are wiring checks: every edge endpoint declared, walk steps referencing real
// nodes/edges, and each tab's data complete enough to render.
import { describe, it, expect } from "vitest";
import {
  TABS,
  SEQUENCE_DIAGRAM,
  LB_NODES,
  LB_EDGES,
  A2A_NODES,
  A2A_EDGES,
  AGENT_NODES,
  AGENT_EDGES,
  AGENTLESS_NODES,
  AGENTLESS_EDGES,
} from "./PrivilegeGatewayTopologyPage";

describe("PrivilegeGatewayTopologyPage diagram data", () => {
  it("has the live LB tab plus both deployment variants and the agent-to-agent layout", () => {
    expect(TABS.map((t) => t.id)).toEqual(["lb", "agent", "agentless", "a2a"]);
  });

  it("every tab is a complete static graph: nodes, edges, groups, walk, details, ariaLabel", () => {
    for (const tab of TABS) {
      expect(tab.static, `${tab.id} is static`).toBe(true);
      expect(tab.nodes.length, `${tab.id} nodes`).toBeGreaterThan(0);
      expect(tab.edges.length, `${tab.id} edges`).toBeGreaterThan(0);
      expect(Object.keys(tab.groups).length, `${tab.id} groups`).toBeGreaterThan(0);
      expect(tab.walk.length, `${tab.id} walk`).toBeGreaterThan(0);
      expect(tab.ariaLabel, `${tab.id} ariaLabel`).toBeTruthy();
    }
  });

  it("wires every edge endpoint to a declared node and walks its edges in order", () => {
    for (const tab of TABS) {
      const ids = new Set(tab.nodes.map((n) => n.id));
      for (const [src, tgt] of tab.edges) {
        expect(ids.has(src), `${tab.id} edge source ${src}`).toBe(true);
        expect(ids.has(tgt), `${tab.id} edge target ${tgt}`).toBe(true);
      }
      for (const w of tab.walk) {
        for (const id of w.nodes) expect(ids.has(id), `${tab.id} walk node ${id}`).toBe(true);
        for (const i of w.edges) expect(i, `${tab.id} walk edge ${i}`).toBeLessThan(tab.edges.length);
      }
    }
  });

  it("numbers every step in the step lists (no badge nodes on static tabs — the number leads the edge label)", () => {
    for (const tab of TABS) {
      for (const step of tab.steps.filter((s) => s.n)) {
        const onEdge = tab.edges.some(([src, tgt, label]) =>
          `${label}`.startsWith(`${step.n} ·`) || `${label}`.startsWith(`${step.n}·`));
        const inWalk = tab.walk.some((w) => w.title.includes(String(step.n)) || (w.label || "").includes(String(step.n)));
        expect(onEdge || inWalk, `${tab.id} step ${step.n} appears on an edge or walk step`).toBe(true);
      }
    }
  });

  it("no Mermaid source remains on the page (ReactFlow-only convention)", () => {
    // The request-flow figure is a static graph too.
    expect(SEQUENCE_DIAGRAM.NODES.length).toBeGreaterThan(0);
    expect(SEQUENCE_DIAGRAM.EDGES.length).toBeGreaterThan(0);
    const ids = new Set(SEQUENCE_DIAGRAM.NODES.map((n) => n.id));
    for (const [src, tgt] of SEQUENCE_DIAGRAM.EDGES) {
      expect(ids.has(src), `sequence edge source ${src}`).toBe(true);
      expect(ids.has(tgt), `sequence edge target ${tgt}`).toBe(true);
    }
    for (const w of SEQUENCE_DIAGRAM.walk) {
      for (const id of w.nodes) expect(ids.has(id), `sequence walk node ${id}`).toBe(true);
      for (const i of w.edges) expect(i, `sequence walk edge ${i}`).toBeLessThan(SEQUENCE_DIAGRAM.EDGES.length);
    }
  });
});
