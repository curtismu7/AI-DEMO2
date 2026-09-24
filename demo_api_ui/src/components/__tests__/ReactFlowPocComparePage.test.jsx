import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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
});
