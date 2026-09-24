import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

function topControls() {
  return within(screen.getByRole("group", { name: "Top diagram controls" }));
}

describe("PingFederate ID-JAG architecture", () => {
  it("shows standard PingFederate Authorization Code + PKCE login as a separate view", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "PingFederate login" }));

    expect(screen.getByRole("heading", { name: "PingFederate standard login" })).toBeTruthy();
    expect(DIAGRAMS.pingfederate.chain).toEqual(["Authorization request", "Authorization code", "BFF session"]);
    expect(DIAGRAMS.pingfederate.steps).toHaveLength(5);
    expect(DIAGRAMS.pingfederate.steps.some((step) => /ID-JAG|Side 1|Side 2|JWT bearer/.test(`${step.title} ${step.detail}`))).toBe(false);

    const panel = screen.getByText("Protocol details").closest("details");
    fireEvent.click(screen.getByText("Protocol details"));
    expect(panel.textContent).toContain("code_challenge_method");
    expect(panel.textContent).toContain("S256");

    fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate returns an authorization code" }));
    expect(panel.textContent).toContain("state matches the sign-in request");
    expect(panel.textContent).not.toContain("nonce");

    fireEvent.click(screen.getByRole("button", { name: "Step 4: BFF exchanges code for tokens" }));
    expect(panel.textContent).toContain("authorization_code");
    expect(panel.textContent).toContain("code_verifier");
    expect(panel.textContent).toContain("[MOCK REFRESH TOKEN]");
    expect(panel.textContent).toContain("configured PingFederate client-authentication method");
    expect(panel.textContent).toContain("validates the ID token nonce");

    fireEvent.click(screen.getByRole("button", { name: "Step 5: BFF establishes the application session" }));
    expect(panel.textContent).toContain("[HTTP-only session cookie]");
  });

  it("keeps the mid-page controls connected to the same playback state", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      const midControls = screen.getByRole("group", { name: "Mid-page diagram controls" });
      const topControls = screen.getByRole("group", { name: "Top diagram controls" });
      const midStepTime = within(midControls).getByLabelText("Step time:");

      fireEvent.change(midStepTime, { target: { value: "800" } });
      fireEvent.click(within(midControls).getByRole("button", { name: "Simulate" }));
      expect(within(topControls).getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(within(topControls).getByLabelText("Step time:")).toBeDisabled();

      act(() => vi.advanceTimersByTime(800));
      expect(within(topControls).getByText("Step 2 / 6")).toBeTruthy();
      fireEvent.click(within(midControls).getByRole("button", { name: "Pause" }));
      expect(within(topControls).getByRole("button", { name: "Resume" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders both interactive React Flow views", () => {
    const { container } = renderPage();
    expect(screen.getByRole("tab", { name: "ID-JAG flow" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("ID-JAG token journey")).toBeTruthy();
    expect(container.querySelector(".react-flow")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate login" }));
    expect(screen.getByRole("heading", { name: "PingFederate standard login" })).toBeTruthy();
    expect(screen.getByText(/OIDC · Authorization Code \+ PKCE/)).toBeTruthy();
    expect(screen.getByText("PingFederate")).toBeTruthy();
  });

  it("shows both ID-JAG sides: upstream validation and downstream assertion redemption", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the upstream token" }));
    expect(screen.getByText(/token-exchange policy validates the refresh token/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate issues the ID-JAG" }));
    expect(DIAGRAMS.jag.links).toContainEqual(expect.objectContaining({ id: "return", source: "jag", target: "bff" }));
    expect(DIAGRAMS.jag.steps[2].links).toContain("return");
    expect(DIAGRAMS.jag.steps[3].links).toContain("return");
    expect(screen.getByText(/returns a signed ID-JAG to the BFF/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · submit ID-JAG for validation" }));
    expect(screen.getAllByText(/JWT bearer assertion/).length).toBeGreaterThan(0);
    expect(screen.getByText(/issuer\/signature, audience, expiry/)).toBeTruthy();
  });

  it("shows step-synced mock claims and API exchanges in the ID-JAG view", () => {
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

  });

  it("plays, pauses, steps, resets, and uses the selected step timer", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      expect(topControls().getByText("Step 1 / 6")).toBeTruthy();
      const stepTime = topControls().getByLabelText("Step time:");
      fireEvent.change(stepTime, { target: { value: "800" } });
      fireEvent.click(topControls().getByRole("button", { name: "Simulate" }));
      expect(topControls().getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(stepTime.disabled).toBe(true);

      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 2 / 6")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Pause" }));
      fireEvent.click(topControls().getByRole("button", { name: "Next →" }));
      expect(topControls().getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "← Prev" }));
      expect(topControls().getByText("Step 2 / 6")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Resume" }));
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Stop" }));
      expect(topControls().getByRole("button", { name: "Simulate" })).toBeTruthy();
      expect(topControls().getByText("Step 3 / 6")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "↺ Reset" }));
      expect(topControls().getByText("Step 1 / 6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels playback when a presenter selects a guide step", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(topControls().getByLabelText("Step time:"), { target: { value: "800" } });
      fireEvent.click(topControls().getByRole("button", { name: "Simulate" }));
      fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate issues the ID-JAG" }));

      expect(topControls().getByText("Step 3 / 6")).toBeTruthy();
      expect(topControls().getByRole("button", { name: "Simulate" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 3 / 6")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels playback and resets when the presenter switches views", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(topControls().getByLabelText("Step time:"), { target: { value: "800" } });
      fireEvent.click(topControls().getByRole("button", { name: "Simulate" }));
      fireEvent.click(screen.getByRole("tab", { name: "PingFederate login" }));

      expect(topControls().getByText("Step 1 / 5")).toBeTruthy();
      expect(topControls().getByRole("button", { name: "Simulate" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 1 / 5")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

});
