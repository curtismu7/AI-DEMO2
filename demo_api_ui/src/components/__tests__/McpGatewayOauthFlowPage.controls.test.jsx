import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it } from "vitest";
import McpGatewayOauthFlowPage from "../McpGatewayOauthFlowPage";
import { expectDiagramControls, ResizeObserverStub } from "./diagramControlsHelpers";

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// Both figures are Ping-style EmbeddedFlowDiagram sections: the controls sit in the section, outside the canvas group.
describe("McpGatewayOauthFlowPage diagram controls", () => {
  it("architecture: Simulate, Reset, speed, draggable", async () => {
    render(<McpGatewayOauthFlowPage />);
    expect(screen.getByRole("group", { name: "Agent Gateway OAuth flow architecture diagram" })).toBeTruthy();
    await expectDiagramControls(screen.getByTestId("mgof-arch"));
  });

  it("OAuth sequence: Simulate, Reset, speed, draggable boxes", async () => {
    render(<McpGatewayOauthFlowPage />);
    expect(screen.getByRole("group", { name: "Agent Gateway OAuth flow sequence diagram" })).toBeTruthy();
    await expectDiagramControls(screen.getByTestId("mgof-seq"));
  });
});
