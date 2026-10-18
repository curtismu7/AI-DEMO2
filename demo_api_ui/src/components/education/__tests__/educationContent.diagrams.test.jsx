import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("CIBA + token exchange together (11 steps) is a sequence diagram", async () => {
    render(<CibaMcpFlowContent />);
    const scope = screen.getByRole("group", { name: "CIBA plus token exchange sequence diagram" });
    expect(within(scope).getByTestId("sequence-flow-canvas")).toBeInTheDocument();
    for (const p of ["Agent", "BFF", "PingOne", "User", "MCP server", "Banking API"]) {
      expect(within(scope).getAllByText(new RegExp(`^${p}`)).length).toBeGreaterThan(0);
    }
    for (let n = 1; n <= 11; n++) {
      expect(within(scope).getAllByText(new RegExp(`^${n}\\. `)).length).toBeGreaterThan(0);
    }
    await expectDiagramControls(scope, { draggable: false });
    fireEvent.click(within(scope).getAllByRole("button", { name: "Simulate" })[0]);
    expect(within(scope).getAllByText(/Step 1 of \d+/).length).toBeGreaterThan(0);
  });

  it("gateway ingress pipeline is a draggable flow diagram with three outcomes", async () => {
    render(<AgentGatewayContent />);
    const scope = screen.getByRole("group", { name: "Gateway ingress pipeline" });
    for (const id of ["introspect", "validate", "authorize", "permit", "deny", "indeterminate"]) {
      expect(within(scope).getByTestId(`agent-gateway-ingress-diagram-node-${id}`)).toBeInTheDocument();
    }
    await expectDiagramControls(scope);
    fireEvent.click(within(scope).getByRole("button", { name: "Simulate" }));
    expect(within(scope).getByText(/Step 1 of 5/)).toBeInTheDocument();
  });
});
