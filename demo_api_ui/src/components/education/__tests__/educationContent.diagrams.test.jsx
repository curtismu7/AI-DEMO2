import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentGatewayContent,
  CibaFullStackContent,
  CibaMcpFlowContent,
  CibaWhatContent,
} from "../educationContent";
import { expectDiagramControls, ResizeObserverStub } from "../../__tests__/diagramControlsHelpers";

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// Box-drawing and arrow glyphs the old ASCII diagrams were drawn with.
const ASCII_ART = /[┌┐└┘│▶◀]/;

describe("educationContent diagrams are React Flow with Simulate, Reset, speed (and drag for non-sequences)", () => {
  it("CIBA flow (6 steps) is a sequence diagram", async () => {
    const { container } = render(<CibaWhatContent />);
    const scope = screen.getByRole("group", { name: "CIBA flow sequence diagram" });
    expect(within(scope).getByTestId("sequence-flow-canvas")).toBeInTheDocument();
    await expectDiagramControls(scope, { draggable: false });
    expect(container.textContent).not.toMatch(ASCII_ART);
  });

  it("CIBA full-stack architecture map is a draggable flow diagram", async () => {
    const { container } = render(<CibaFullStackContent />);
    const scope = screen.getByRole("group", { name: "Agent Gateway-style architecture map" });
    for (const id of ["spa", "agent", "ingress", "idp", "mcp", "rs"]) {
      expect(screen.getByTestId(`ciba-fullstack-diagram-node-${id}`)).toBeInTheDocument();
    }
    await expectDiagramControls(scope);
    expect(container.textContent).not.toMatch(ASCII_ART);
  });

  it("step-up with CIBA + MCP is a sequence diagram", async () => {
    const { container } = render(<CibaMcpFlowContent />);
    const scope = screen.getByRole("group", { name: "Step-up with CIBA and MCP sequence diagram" });
    expect(within(scope).getByTestId("sequence-flow-canvas")).toBeInTheDocument();
    await expectDiagramControls(scope, { draggable: false });
    expect(container.textContent).not.toMatch(ASCII_ART);
  });

  it("Agent Gateway swimlanes are a draggable flow diagram", async () => {
    const { container } = render(<AgentGatewayContent />);
    const scope = screen.getByRole("group", { name: "Agent Gateway full architecture" });
    for (const id of ["spa", "bff", "gw", "idp", "mcp", "rs"]) {
      expect(screen.getByTestId(`agent-gateway-arch-diagram-node-${id}`)).toBeInTheDocument();
    }
    await expectDiagramControls(scope);
    expect(container.textContent).not.toMatch(ASCII_ART);
  });
});
