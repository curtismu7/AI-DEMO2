// Guards the diagram sources on this page: each must parse into something FlowDiagram can draw
// (a render smoke test in jsdom cannot judge layout, so the parse is what is checked).
import { describe, it } from "vitest";
import { expectDrawable } from "../utils/__tests__/diagramSource";
import { ARCHITECTURE_SOURCE } from "./McpGatewayOauthFlowPage";

describe("McpGatewayOauthFlowPage diagram sources", () => {
  it("architecture source parses into a drawable flowchart", () => {
    expectDrawable(ARCHITECTURE_SOURCE);
  });
});
