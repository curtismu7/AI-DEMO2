// Guards the mermaid sources on the Privilege Gateway Topologies page:
// mermaid.parse rejects invalid diagram syntax, which a render smoke test in
// jsdom cannot cover (mermaid.render needs real layout measurement).
import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { TABS, SEQUENCE_SOURCE } from "./PrivilegeGatewayTopologyPage";

// jsdom doesn't implement CSS.supports; mermaid's sequence "box" parser calls
// it to validate the box's color argument (e.g. "box rgb(240,240,255)").
if (!window.CSS.supports) window.CSS.supports = () => true;

describe("PrivilegeGatewayTopologyPage mermaid sources", () => {
  it("has both deployment variants", () => {
    expect(TABS.map((t) => t.id)).toEqual(["agent", "agentless"]);
  });

  it.each(TABS.map((t) => [t.id, t.source]))(
    "%s topology source parses as valid mermaid",
    async (_id, source) => {
      await expect(mermaid.parse(source)).resolves.toBeTruthy();
    },
  );

  it("numbers every step badge named in the step lists", () => {
    for (const tab of TABS) {
      const numbered = tab.steps.filter((s) => s.n);
      for (const step of numbered) {
        expect(tab.source).toContain(`s${step.n}(("${step.n}"))`);
      }
    }
  });

  it("request-flow sequence source parses as valid mermaid", async () => {
    await expect(mermaid.parse(SEQUENCE_SOURCE)).resolves.toBeTruthy();
  });
});
