import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it } from "vitest";
import McpGatewayOauthFlowPage from "../McpGatewayOauthFlowPage";
import { expectDiagramControls, ResizeObserverStub } from "./diagramControlsHelpers";

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

describe("McpGatewayOauthFlowPage diagram controls", () => {
  it("architecture flowchart: Simulate, Reset, speed, draggable", async () => {
    render(<McpGatewayOauthFlowPage />);
    await expectDiagramControls(screen.getByRole("group", { name: "Agent Gateway OAuth flow architecture diagram" }));
  });

  it("OAuth sequence: Simulate, Reset, speed (lifelines exempt from drag)", async () => {
    render(<McpGatewayOauthFlowPage />);
    await expectDiagramControls(screen.getByRole("group", { name: "Agent Gateway OAuth flow sequence diagram" }), { draggable: false });
  });
});
