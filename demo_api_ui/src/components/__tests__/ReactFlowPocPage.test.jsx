import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReactFlowPocPage from "../ReactFlowPocPage";
import EducationRoutes from "../../routes/EducationRoutes";

// AppShell pulls in TopNav → SessionTokenContext; stub it out — the POC test
// only needs the routed page content, not the shell chrome.
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
    <MemoryRouter initialEntries={["/architecture/reactflow-poc"]}>
      <Routes>
        <Route path="/architecture/*" element={<EducationRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("ReactFlowPocPage", () => {
  it("renders the canvas, legend, and idle explanation panel", () => {
    renderPage();
    expect(screen.getByTestId("reactflow-poc-page")).toBeTruthy();
    expect(screen.getByTestId("rfp-explain-panel")).toBeTruthy();
    expect(screen.getByText("Guided tour")).toBeTruthy();
    expect(screen.getByText("React UI (demo_api_ui)")).toBeTruthy();
    expect(screen.getByText("MCP Gateway")).toBeTruthy();
    expect(screen.getByText("PingOne Authorize")).toBeTruthy();
    expect(screen.getByText("Reservation Data (PNR store)")).toBeTruthy();
  });

  it("renders the shared DiagramControls with step counter and speed selector", () => {
    renderPage();
    expect(screen.getByText("Step 0 / 9")).toBeTruthy();
    expect(screen.getByText("Simulate")).toBeTruthy();
    expect(screen.getByText("↺ Reset")).toBeTruthy();
  });

  it("renders the layer and outcome legends", () => {
    renderPage();
    expect(screen.getAllByText("PingOne / Identity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vault").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MCP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PERMIT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DENY").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HITL").length).toBeGreaterThan(0);
  });

  /* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
  it("diagram rule: flow nodes are draggable, with Simulate, Reset and step-time speed", () => {
    const { container } = renderPage();
    const nodes = container.querySelectorAll(".react-flow__node");
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((n) => expect(n.classList.contains("draggable")).toBe(true));
    expect(screen.getByText("Simulate")).toBeTruthy();
    expect(screen.getByText("↺ Reset")).toBeTruthy();
    expect(container.querySelector(".dc-steptime-select")).toBeTruthy();
  });
  /* eslint-enable testing-library/no-node-access, testing-library/no-container */

  it("has a scenario picker with all four outcomes", () => {
    renderPage();
    const select = screen.getByTestId("rfp-scenario-select");
    const options = [...select.options].map((o) => o.value);
    expect(options).toEqual(["permit", "deny", "indeterminate", "hitl"]);
  });

  it("switching to the HITL scenario extends the step list to 10", async () => {
    renderPage();
    fireEvent.change(screen.getByTestId("rfp-scenario-select"), {
      target: { value: "hitl" },
    });
    await waitFor(() => {
      expect(screen.getByText("Step 0 / 10")).toBeTruthy();
    });
  });

  it("switching to the DENY scenario shortens the step list to 6", async () => {
    renderPage();
    fireEvent.change(screen.getByTestId("rfp-scenario-select"), {
      target: { value: "deny" },
    });
    await waitFor(() => {
      expect(screen.getByText("Step 0 / 6")).toBeTruthy();
    });
  });

  it("toggles to the sequence-diagram view and back", () => {
    renderPage();
    fireEvent.click(screen.getByText("Sequence"));
    expect(screen.getByTestId("rfps-diagram")).toBeTruthy();
    expect(screen.getByText("MCP Gateway")).toBeTruthy();
    expect(screen.getByText("Reservation Data")).toBeTruthy();
    fireEvent.click(screen.getByText("Flow"));
    expect(screen.queryByTestId("rfps-diagram")).toBeNull();
  });

  it("sequence view keeps Simulate, Reset and step-time controls and highlights the simulated step", () => {
    renderPage();
    fireEvent.click(screen.getByText("Sequence"));
    expect(screen.getByText("Simulate")).toBeTruthy();
    expect(screen.getByText("↺ Reset")).toBeTruthy();
    expect(screen.getByText("Step time:")).toBeTruthy();
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.getByText(/^▶ Step/)).toBeTruthy();
    fireEvent.click(screen.getByText("↺ Reset"));
    expect(screen.queryByText(/^▶ Step/)).toBeNull();
  });

  it("shows a sample token card for the active step", () => {
    renderPage();
    // No token before the tour starts.
    expect(screen.queryByTestId("rfp-sample-token")).toBeNull();
    // Prev/Next only render while simulating — start the tour first.
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.getByTestId("rfp-sample-token")).toBeTruthy();
    expect(screen.getByText("Session cookie")).toBeTruthy();
    expect(screen.getByText("user_maya_chen")).toBeTruthy();
  });

  it("shows wire-level HTTP request/response detail for the active step", () => {
    renderPage();
    fireEvent.click(screen.getByText("Simulate"));
    expect(screen.getByTestId("rfp-wire")).toBeTruthy();
    expect(screen.getAllByText("POST", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/code_challenge/).length).toBeGreaterThan(0);
  });
});
