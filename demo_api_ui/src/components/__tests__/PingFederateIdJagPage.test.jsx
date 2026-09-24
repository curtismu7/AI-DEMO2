import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EducationRoutes from "../../routes/EducationRoutes";
import { DIAGRAMS } from "../PingFederateIdJagPage";

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
    expect(screen.getByText("MCP Authorization Server")).toBeTruthy();
  });

  it("shows both ID-JAG sides: upstream validation and downstream assertion redemption", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the upstream token" }));
    expect(screen.getByText(/token-exchange policy validates the refresh token/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate issues the ID-JAG" }));
    for (const diagram of Object.values(DIAGRAMS)) {
      expect(diagram.links).toContainEqual(expect.objectContaining({ id: "return", source: "jag", target: "bff" }));
      expect(diagram.steps[2].links).toContain("return");
      expect(diagram.steps[3].links).toContain("return");
    }
    expect(screen.getByText(/returns a signed ID-JAG to the BFF/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · submit ID-JAG for validation" }));
    expect(screen.getAllByText(/JWT bearer assertion/).length).toBeGreaterThan(0);
    expect(screen.getByText(/issuer\/signature, audience, expiry/)).toBeTruthy();
  });

  it("shows step-synced mock claims and API exchanges in both architecture views", () => {
    renderPage();
    const panel = screen.getByText("Protocol details").closest("details");
    expect(panel).toBeTruthy();
    fireEvent.click(screen.getByText("Protocol details"));
    expect(screen.getByText(/MOCK DATA — NOT A REAL TOKEN/)).toBeTruthy();
    expect(panel.textContent).toContain('"useCaseId": "enterprise-managed-mcp-authorization"');
    expect(panel.textContent).toContain('"threadId": "[MOCK THREAD ID]"');

    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the upstream token" }));
    expect(panel.textContent).toContain("requested_token_type");
    expect(panel.textContent).toContain("oauth:token-type:id-jag");
    expect(panel.textContent).toContain("subject_token_type");
    expect(panel.textContent).toContain("token-type:refresh_token");
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · submit ID-JAG for validation" }));
    expect(panel.textContent).toContain("jwt-bearer");
    expect(panel.textContent).toContain("MCP authorization server validates the ID-JAG");
    expect(panel.textContent).toContain("RS256 signature from trusted IdP JWKS");
    expect(panel.textContent).toContain("jti is present and not previously redeemed");
    fireEvent.click(screen.getByRole("button", { name: "Step 5: Downstream AS issues its local access token" }));
    expect(panel.textContent).toContain("MOCK LOCAL MCP ACCESS TOKEN");
    fireEvent.click(screen.getByRole("button", { name: "Step 6: Call the protected MCP tool" }));
    expect(panel.textContent).toContain('"method": "tools/call"');
    expect(panel.textContent).toContain("Bearer [MOCK LOCAL MCP ACCESS TOKEN]");

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate architecture" }));
    expect(screen.getByText("PingFederate in the system")).toBeTruthy();
    expect(panel.textContent).toContain("MOCK DATA — NOT A REAL TOKEN");
    expect(panel.textContent).toContain("PingFederate user sign-in");
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the refresh token" }));
    expect(panel.textContent).toContain("token-type:refresh_token");
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · MCP AS validates the ID-JAG" }));
    expect(panel.textContent).toContain("jwt-bearer");
    expect(panel.textContent).toContain("MCP authorization server validates the ID-JAG");
    fireEvent.click(screen.getByRole("button", { name: "Step 6: Gateway authorizes and forwards the call" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate issues the ID-JAG" }));

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
