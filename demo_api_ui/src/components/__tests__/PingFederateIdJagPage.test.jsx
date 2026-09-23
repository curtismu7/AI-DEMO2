import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EducationRoutes from "../../routes/EducationRoutes";

vi.mock("../../routes/AppShell", () => ({ default: ({ children }) => children }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/architecture/pingfederate-id-jag"]}>
      <Routes>
        <Route path="/architecture/*" element={<EducationRoutes />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PingFederate ID-JAG architecture", () => {
  it("renders both interactive React Flow views", () => {
    const { container } = renderPage();
    expect(screen.getByRole("tab", { name: "ID-JAG flow" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("ID-JAG token journey")).toBeTruthy();
    expect(container.querySelector(".react-flow")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate architecture" }));
    expect(screen.getByText("PingFederate in the system")).toBeTruthy();
    expect(screen.getByText("Generalist agent")).toBeTruthy();
  });

  it("steps through the ID-JAG issuance and exchange narrative", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Exchange 1 issues an ID-JAG" }));
    expect(screen.getByText("Exchange 1 issues an ID-JAG")).toBeTruthy();
    expect(screen.getByText(/user remains sub/)).toBeTruthy();
  });

  it("shows step-synced mock claims and API exchanges in both architecture views", () => {
    renderPage();
    const panel = screen.getByText("Protocol details").closest("details");
    expect(panel).toBeTruthy();
    fireEvent.click(screen.getByText("Protocol details"));
    expect(screen.getByText(/MOCK DATA — NOT A REAL TOKEN/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Step 2: Exchange 1 issues an ID-JAG" }));
    expect(panel.textContent).toContain("requested_token_type");
    expect(panel.textContent).toContain("oauth:token-type:id-jag");
    fireEvent.click(screen.getByRole("button", { name: "Step 5: PingOne Authorize permits the action" }));
    expect(panel.textContent).toContain('"decision": "PERMIT"');
    fireEvent.click(screen.getByRole("button", { name: "Step 6: Exchange 3 reaches the investment resource" }));
    expect(panel.textContent).toContain("Exchange 3 + investment MCP call");
    expect(panel.textContent).toContain('"method": "tools/call"');

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate architecture" }));
    expect(screen.getByText("PingFederate in the system")).toBeTruthy();
    expect(panel.textContent).toContain("MOCK DATA — NOT A REAL TOKEN");
    expect(panel.textContent).toContain("Browser sign-in redirect");
    fireEvent.click(screen.getByRole("button", { name: "Step 2: PingFederate issues delegated identity" }));
    expect(panel.textContent).toContain("Exchange 1 · issue ID-JAG");
    fireEvent.click(screen.getByRole("button", { name: "Step 5: PingOne Authorize makes the decision" }));
    expect(panel.textContent).toContain('"decision": "PERMIT"');
    fireEvent.click(screen.getByRole("button", { name: "Step 6: Investment MCP returns the result" }));
    expect(panel.textContent).toContain('"method": "tools/call"');
  });

  it("plays, pauses, steps, resets, and uses the selected step timer", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      expect(screen.getByText("Step 1 / 6")).toBeTruthy();
      const stepTime = screen.getByLabelText("Step time:");
      fireEvent.change(stepTime, { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
      expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(stepTime.disabled).toBe(true);

      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByText("Step 2 / 6")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      fireEvent.click(screen.getByRole("button", { name: "Next →" }));
      expect(screen.getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
      expect(screen.getByText("Step 2 / 6")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
      expect(screen.getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "↺ Reset" }));
      expect(screen.getByText("Step 1 / 6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels playback when a presenter selects a guide step", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(screen.getByLabelText("Step time:"), { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
      fireEvent.click(screen.getByRole("button", { name: "Step 3: Carry the ID-JAG to PingGateway" }));

      expect(screen.getByText("Step 3 / 6")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByText("Step 3 / 6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels playback and resets when the presenter switches views", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(screen.getByLabelText("Step time:"), { target: { value: "800" } });
      fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
      fireEvent.click(screen.getByRole("tab", { name: "PingFederate architecture" }));

      expect(screen.getByText("Step 1 / 6")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Simulate" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByText("Step 1 / 6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

});
