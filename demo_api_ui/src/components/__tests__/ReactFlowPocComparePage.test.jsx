import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import ReactFlowPocComparePage from "../ReactFlowPocComparePage";
import EducationRoutes from "../../routes/EducationRoutes";

// AppShell pulls in TopNav → SessionTokenContext; stub it out — the test only
// needs the routed page content, not the shell chrome.
vi.mock("../../routes/AppShell", () => ({ default: ({ children }) => children }));

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/architecture/poc-compare"]}>
      <Routes>
        <Route path="/architecture/*" element={<EducationRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ReactFlowPocComparePage", () => {
  it("embeds the live React Flow POC page", () => {
    renderPage();
    expect(screen.getByTestId("rfpc-page")).toBeTruthy();
    expect(screen.getByTestId("reactflow-poc-page")).toBeTruthy();
    expect(screen.getByTestId("rfp-explain-panel")).toBeTruthy();
  });

  it("narrates the executing flow instead of showing a scorecard", () => {
    renderPage();
    expect(screen.getByTestId("reactflow-poc-page")).toBeTruthy();
    expect(screen.getByTestId("rfp-explain-panel")).toBeTruthy();
    expect(screen.queryByTestId("rfpc-scorecard")).toBeNull();
    expect(screen.queryByText(/Why React Flow \(POC scorecard\)/)).toBeNull();
  });

  it("no longer renders the Penpot frame player", () => {
    renderPage();
    expect(screen.queryByTestId("rfpc-player")).toBeNull();
    expect(screen.queryByTestId("rfpc-frame")).toBeNull();
  });

  /* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
  it("diagram rule: both tabs have Simulate, Reset and speed; Flow nodes are draggable", () => {
    const { container } = renderPage();
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((n) => expect(n.classList.contains("draggable")).toBe(true));
    for (const tab of ["Flow", "Sequence"]) {
      fireEvent.click(screen.getAllByRole("tab", { name: tab })[0]);
      expect(screen.getByText("Simulate")).toBeTruthy();
      expect(screen.getByText("↺ Reset")).toBeTruthy();
      expect(container.querySelector(".dc-steptime-select")).toBeTruthy();
    }
    expect(screen.getByTestId("rfps-diagram")).toBeTruthy();
  });
  /* eslint-enable testing-library/no-node-access, testing-library/no-container */
});
