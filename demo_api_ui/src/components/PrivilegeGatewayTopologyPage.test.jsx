// Guards the diagram sources on the Privilege Gateway Topologies page: each must parse into
// something FlowDiagram can draw (a render smoke test in jsdom cannot judge layout).
// The "lb" tab is a static React Flow graph (StaticFlowDiagram) with no Mermaid source —
// its guards are the node/edge wiring checks below.
import { describe, it, expect } from "vitest";
import { expectDrawable } from "../utils/__tests__/diagramSource";
import { TABS, SEQUENCE_SOURCE, LB_NODES, LB_EDGES } from "./PrivilegeGatewayTopologyPage";

describe("PrivilegeGatewayTopologyPage diagram sources", () => {
  it("has the live LB tab plus both deployment variants and the agent-to-agent layout", () => {
    expect(TABS.map((t) => t.id)).toEqual(["lb", "agent", "agentless", "a2a"]);
  });

  it.each(TABS.filter((t) => t.source).map((t) => [t.id, t.source]))(
    "%s topology source parses into a drawable flowchart",
    (_id, source) => {
      expectDrawable(source);
    },
  );

  it("lb tab wires every edge endpoint to a declared node and walks its edges in order", () => {
    const ids = new Set(LB_NODES.map((n) => n.id));
    expect(LB_NODES.length).toBeGreaterThan(0);
    expect(LB_EDGES.length).toBeGreaterThan(0);
    for (const [src, tgt] of LB_EDGES) {
      expect(ids.has(src), `edge source ${src}`).toBe(true);
      expect(ids.has(tgt), `edge target ${tgt}`).toBe(true);
    }
    // every walk step references real node ids and in-range edge indexes
    for (const w of TABS.find((t) => t.id === "lb").walk) {
      for (const id of w.nodes) expect(ids.has(id), `walk node ${id}`).toBe(true);
      for (const i of w.edges) expect(i, `walk edge ${i}`).toBeLessThan(LB_EDGES.length);
    }
  });

  it("numbers every step badge named in the step lists", () => {
    for (const tab of TABS) {
      const numbered = tab.steps.filter((s) => s.n);
      for (const step of numbered) {
        if (tab.static) {
          // The static tab numbers its steps in the list only; no badge nodes exist.
          continue;
        }
        // A numbered badge node, or the number at the start of an arrow label.
        const badge = tab.source.includes(`s${step.n}(("${step.n}"))`);
        const onArrow = tab.source.includes(`"${step.n} · `);
        expect(badge || onArrow, `${tab.id} step ${step.n}`).toBe(true);
      }
    }
  });

  it("request-flow sequence source parses into a drawable sequence", () => {
    expectDrawable(SEQUENCE_SOURCE);
  });
});
