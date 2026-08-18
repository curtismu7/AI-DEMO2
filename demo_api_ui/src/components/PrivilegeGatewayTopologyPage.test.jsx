// Guards the mermaid sources on the Privilege Gateway Topologies page:
// mermaid.parse rejects invalid diagram syntax, which a render smoke test in
// jsdom cannot cover (mermaid.render needs real layout measurement).
import { describe, it, expect } from "vitest";
import mermaid from "mermaid";
import { TABS } from "./PrivilegeGatewayTopologyPage";

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
});
