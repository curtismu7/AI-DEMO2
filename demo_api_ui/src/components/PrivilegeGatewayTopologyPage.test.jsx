// Guards the diagram sources on the Privilege Gateway Topologies page: each must parse into
// something FlowDiagram can draw (a render smoke test in jsdom cannot judge layout).
import { describe, it, expect } from "vitest";
import { expectDrawable } from "../utils/__tests__/diagramSource";
import { TABS, SEQUENCE_SOURCE } from "./PrivilegeGatewayTopologyPage";

describe("PrivilegeGatewayTopologyPage diagram sources", () => {
  it("has both deployment variants and the agent-to-agent layout", () => {
    expect(TABS.map((t) => t.id)).toEqual(["agent", "agentless", "a2a"]);
  });

  it.each(TABS.map((t) => [t.id, t.source]))(
    "%s topology source parses into a drawable flowchart",
    (_id, source) => {
      expectDrawable(source);
    },
  );

  it("numbers every step badge named in the step lists", () => {
    for (const tab of TABS) {
      const numbered = tab.steps.filter((s) => s.n);
      for (const step of numbered) {
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
