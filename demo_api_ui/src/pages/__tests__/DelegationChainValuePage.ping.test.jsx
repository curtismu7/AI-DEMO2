import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DelegationChainValuePage from "../DelegationChainValuePage";

vi.mock("../../services/apiClient", () => ({ default: { post: vi.fn(), patch: vi.fn() } }));
vi.mock("../../services/demoAgentService", () => ({ sendAgentMessage: vi.fn() }));
vi.mock("../../components/TokenChainTraceRail", () => ({ default: () => <div data-testid="dcv-rail" /> }));

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node.
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 250 });
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 40 });
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

describe("DelegationChainValuePage diagram in the Ping style", () => {
  it("is drawn in the Ping style with Simulate, Reset and the speed selector", () => {
    render(<DelegationChainValuePage />);
    expect(document.querySelectorAll(".efd--ping").length).toBe(1);
    const region = screen.getByRole("region", { name: "Delegation chain diagram" });
    expect(within(region).getByRole("button", { name: "Simulate" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(within(region).getByTitle("Time each step takes during Simulate")).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Simulate" }));
    expect(within(region).getByText(/Step 1 of 8/)).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Reset" }));
    expect(within(region).getByRole("button", { name: "Simulate" })).toBeTruthy();
  });

  it("clicking the specialist shows the nested act chain as MOCK claims", async () => {
    render(<DelegationChainValuePage />);
    fireEvent.click(await screen.findByTestId("dcv-chain-diagram-flow-node-specialist"));
    const panel = screen.getByTestId("dcv-chain-diagram-flow-reel-detail");
    expect(panel.textContent).toContain("MOCK, teaching values only");
    expect(panel.textContent).toContain("A2A Protocol 1.0");
  });

  it("keeps both Run sections", () => {
    render(<DelegationChainValuePage />);
    expect(screen.getAllByText("Run").length).toBe(2);
  });
});
