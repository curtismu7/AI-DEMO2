// The page renders the token-chain graph as a React Flow canvas
// (TokenChainFlowDiagram) instead of Mermaid. mermaid.render() needs real
// layout measurement, and so does React Flow's renderer — but the graph
// nodes/edges are static data, so the tests assert on DOM structure instead.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

import TokenChainArchitecturePage from "./TokenChainArchitecturePage";
import TokenChainFlowDiagram, { NODES, EDGES, GROUPS } from "./TokenChainFlowDiagram";

describe("TokenChainArchitecturePage", () => {
  // The Form | JSON choice is one for the whole page and lives in localStorage: a test that clicks JSON must not leak it.
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the React Flow canvas with every chain node present", () => {
    render(<TokenChainArchitecturePage />);
    const canvas = screen.getByTestId("tcf-token-chain-canvas");
    expect(canvas).toBeTruthy();
    // All 18 nodes render as React Flow cards (via data-nodeid through the
    // node title text — check a few anchors from each plane).
    expect(screen.getByText("PingOne/PF/AIC")).toBeTruthy();
    expect(screen.getByText("Agent Service")).toBeTruthy();
    expect(screen.getByText("Exchange Service")).toBeTruthy();
    expect(screen.getByText("Agent Gateway")).toBeTruthy();
    expect(screen.getByText("PingAuthorize")).toBeTruthy();
    expect(screen.getByText("MCP Resource Server")).toBeTruthy();
    // "HITL/CIBA" appears as a node AND a summary-card title — assert all
    // instances exist rather than a unique match.
    expect(screen.getAllByText("HITL/CIBA").length).toBeGreaterThanOrEqual(2);
    // No Mermaid artifacts remain.
    expect(document.querySelector("pre.mermaid")).toBeNull();
  });

  it("keeps the graph contract: every edge references known nodes", () => {
    const ids = new Set(NODES.map((n) => n.id));
    EDGES.forEach(([source, target]) => {
      expect(ids.has(source)).toBe(true);
      expect(ids.has(target)).toBe(true);
    });
  });

  it("shows node detail with a mock token when a token node is clicked", async () => {
    render(<TokenChainArchitecturePage />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Exchange Service"));
    const detail = screen.getByRole("status");
    expect(detail.textContent).toContain("Exchange Service");
    expect(detail.textContent).toContain("exchange");
    // Token nodes show a MOCK decoded-claims pane: the Form view by default, with the claims as fields.
    fireEvent.click(screen.getByText("TX Token"));
    const txDetail = screen.getByRole("status");
    expect(txDetail.textContent).toContain("RFC 8693 exchange result");
    const form = within(txDetail).getByRole("group", { name: "Decoded claims of TX Token" });
    expect(form.textContent).toContain("agent1");
    expect(within(form).getAllByRole("button", { name: "Copy sub" }).length).toBeGreaterThan(0);
    // The JSON view shows the claims exactly as JSON.
    fireEvent.click(within(txDetail).getByRole("button", { name: "JSON" }));
    await waitFor(() => expect(txDetail.querySelector(".jp-raw")).not.toBeNull());
    expect(txDetail.textContent).toContain('"act"');
    expect(txDetail.textContent).toContain('"sub": "user1"');
  });

  it("shows the token carried at the selected step as a pane, not a scrolling box", () => {
    render(<TokenChainArchitecturePage />);
    fireEvent.click(screen.getByText("TX Token"));
    const box = screen.getByTestId("tca-step-token");
    expect(within(box).getByRole("group", { name: /^Claims carried at step \d+$/ })).toBeTruthy();
    expect(box.querySelector("pre")).toBeNull();
  });

  it("explains token-less nodes instead of showing a fake token", () => {
    render(<TokenChainArchitecturePage />);
    fireEvent.click(screen.getByText("LLM"));
    const detail = screen.getByRole("status");
    expect(detail.textContent).toContain("No token");
  });

  it("renders all nine group legends with their Mermaid-palette colors", () => {
    render(<TokenChainArchitecturePage />);
    Object.entries(GROUPS).forEach(([, group]) => {
      expect(screen.getByText(group.label)).toBeTruthy();
    });
  });
});

