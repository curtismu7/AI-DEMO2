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
  it("provides flow education and official PingFederate docs in both open tabs", () => {
    renderPage();

    let details = screen.getByText("Protocol details").closest("details");
    expect(details.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Understand this flow" })).toBeTruthy();
    expect(screen.getByText(/PingFederate validates the refresh token and issues the ID-JAG/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Refresh token → ID-JAG setup" }).getAttribute("href")).toBe("https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_refresh_token_to_idjag_exchange.html");
    expect(screen.getByRole("link", { name: "JWT bearer assertion setup" }).getAttribute("href")).toBe("https://docs.pingidentity.com/pingfederate/13.1/administrators_reference_guide/pf_configuring_oauth_assertion_grant_idp_connection.html");

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate login, PF login + agent authorization" }));
    details = screen.getByText("Protocol details").closest("details");
    expect(details.open).toBe(true);
    expect(screen.getByText(/The two agent exchanges happen after login/)).toBeTruthy();
    expect(screen.getByText(/PingOne Authorize evaluates the action policy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "OAuth grant types" }).getAttribute("href")).toBe("https://docs.pingidentity.com/pingfederate/13.1/introduction_to_pingfederate/pf_grant_types.html");
    expect(screen.getByRole("link", { name: "OIDC authorization endpoint" }).getAttribute("href")).toBe("https://docs.pingidentity.com/pingfederate/13.1/developers_reference_guide/pf_authorization_endpoint.html");
  });

  it("shows PingFederate login followed by the complete AI request path", () => {
    renderPage();
    expect(screen.getByText("2 token exchanges")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "PingFederate login, PF login + agent authorization" }));

    expect(screen.getByRole("heading", { name: "PingFederate standard login" })).toBeTruthy();
    expect(DIAGRAMS.pingfederate.chain).toContain("Agent Service");
    expect(DIAGRAMS.pingfederate.steps).toHaveLength(9);
    expect(DIAGRAMS.pingfederate.flow.NODES.map(({ id }) => id)).toEqual(expect.arrayContaining(["agent", "gateway", "authorize", "mcp"]));
    expect(DIAGRAMS.pingfederate.steps.some((step) => /PingOne Authorize permits/.test(`${step.title} ${step.detail}`))).toBe(true);

    const panel = screen.getByText("Protocol details").closest("details");
    expect(panel.open).toBe(true);
    expect(screen.getByText("PF login + agent authorization")).toBeTruthy();
    expect(panel.textContent).toContain("code_challenge_method");
    expect(panel.textContent).toContain("S256");

    fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate returns an authorization code" }));
    expect(panel.textContent).toContain("state=<state>");
    expect(panel.textContent).not.toContain("code_verifier");

    fireEvent.click(screen.getByRole("button", { name: "Step 4: BFF exchanges code for tokens" }));
    expect(panel.textContent).toContain("authorization_code");
    expect(panel.textContent).toContain("code_verifier");
    expect(panel.textContent).toContain("refresh_token");
    expect(panel.textContent).toContain("Access token · issued by PingFederate at sign-in");
    expect(panel.textContent).toContain("ID token · issued by PingFederate at sign-in");
    expect(panel.textContent).toContain("Refresh token · issued by PingFederate");

    fireEvent.click(screen.getByRole("button", { name: "Step 5: BFF establishes the application session" }));
    expect(panel.textContent).toContain("Set-Cookie: <session cookie>; HttpOnly");

    fireEvent.click(screen.getByRole("button", { name: "Step 6: User sends an AI request" }));
    expect(panel.textContent).toContain("/api/agent/invoke");
    expect(panel.textContent).toContain('"prompt": "Show my account balance"');
    expect(panel.textContent).not.toContain('"message": "Show my account balance"');
    fireEvent.click(screen.getByRole("button", { name: "Step 7: Agent Service proposes a tool call" }));
    expect(panel.textContent).toContain("/api/agent/reason");
    expect(panel.textContent).toContain('"messages": [');
    expect(panel.textContent).toContain('"tools": [');
    expect(panel.textContent).toContain('"inputSchema": {');
    expect(panel.textContent).not.toContain('"function": {');
    expect(panel.textContent).toContain("the BFF validates and executes the tool call");
    fireEvent.click(screen.getByRole("button", { name: "Step 8: BFF authorizes and routes the MCP call" }));
    expect(panel.textContent).toContain("PingOne Authorize");
    expect(panel.textContent).toContain("# Exchange 1");
    expect(panel.textContent).toContain("# Exchange 2");
    expect(panel.textContent).toContain("McpToolCall");
    fireEvent.click(screen.getByRole("button", { name: "Step 9: MCP result returns to the user" }));
    expect(panel.textContent).toContain('"method": "tools/call"');
    expect(panel.textContent).toContain("<account list>");
    const { EDGES } = DIAGRAMS.pingfederate.flow;
    const edgeIndex = (src, tgt) => EDGES.findIndex((e) => e[0] === src && e[1] === tgt);
    expect(DIAGRAMS.pingfederate.steps[8].edges).toContain(edgeIndex("mcp", "gateway"));
    expect(DIAGRAMS.pingfederate.steps[8].edges).toContain(edgeIndex("gateway", "bff"));
    const answer = EDGES.findIndex((e) => e[0] === "bff" && e[1] === "user" && e[2] === "AI response");
    expect(answer).toBeGreaterThanOrEqual(0);
    expect(DIAGRAMS.pingfederate.steps[8].edges).toContain(answer);
  });

  it("keeps the mid-page controls connected to the same playback state", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      const midControls = screen.getByRole("group", { name: "Mid-page diagram controls" });
      const topControls = screen.getByRole("group", { name: "Top diagram controls" });
      expect(midControls.classList.contains("pfj-toolbar--mid")).toBe(true);
      expect(within(midControls).getByText("Playback controls")).toBeTruthy();
      const midStepTime = within(midControls).getByLabelText("Step time:");

      fireEvent.change(midStepTime, { target: { value: "800" } });
      fireEvent.click(within(midControls).getByRole("button", { name: "Simulate" }));
      expect(within(topControls).getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(within(topControls).getByLabelText("Step time:")).toBeDisabled();

      act(() => vi.advanceTimersByTime(800));
      expect(within(topControls).getByText("Step 2 / 10")).toBeTruthy();
      fireEvent.click(within(midControls).getByRole("button", { name: "Pause" }));
      expect(within(topControls).getByRole("button", { name: "Resume" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders both interactive React Flow views", () => {
    const { container } = renderPage();
    expect(screen.getByRole("tab", { name: "ID-JAG flow, 2 token exchanges" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("ID-JAG token journey")).toBeTruthy();
    expect(container.querySelector(".react-flow")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "PingFederate login, PF login + agent authorization" }));
    expect(screen.getByRole("heading", { name: "PingFederate standard login" })).toBeTruthy();
    expect(screen.getByText(/Login: PingFederate · Runtime policy: PingOne Authorize/)).toBeTruthy();
    expect(screen.getAllByText("PingFederate · sign-in").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PingFederate · token endpoint").length).toBeGreaterThan(0);
  });

  it("shows both ID-JAG sides: upstream validation and downstream assertion redemption", () => {
    renderPage();
    expect(screen.getByText("2 token exchanges")).toBeTruthy();
    expect(screen.getByText("PF login + agent authorization")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the upstream token" }));
    expect(screen.getByText(/token-exchange policy validates the refresh token/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 3: PingFederate issues the ID-JAG" }));
    const jagEdges = DIAGRAMS.jag.flow.EDGES;
    expect(DIAGRAMS.jag.steps[2].edges).toContain(jagEdges.findIndex((e) => e[0] === "jag" && e[1] === "bff"));
    expect(screen.getByText(/returns a signed ID-JAG to the BFF/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · submit ID-JAG for validation" }));
    expect(screen.getAllByText(/JWT bearer assertion/).length).toBeGreaterThan(0);
    expect(screen.getByText(/issuer\/signature, audience, expiry/)).toBeTruthy();
  });

  it("numbers every arrow in the Ping style and shows the reel with its step detail", () => {
    const { container } = renderPage();
    expect(container.querySelector(".sfd--ping")).toBeTruthy();
    expect(container.querySelectorAll(".dreel-card")).toHaveLength(DIAGRAMS.jag.flow.EDGES.length);
    fireEvent.click(screen.getByRole("button", { name: /Demo BFF → PingFederate/ }));
    const detail = screen.getByTestId("pfj-jag-reel-detail");
    expect(detail.textContent).toContain("requested_token_type=urn:ietf:params:oauth:token-type:id-jag");
    expect(detail.textContent).toContain("MOCK");
    expect(screen.getByTestId("pfj-jag-reel-refs").textContent).toContain("RFC 8693");
  });

  it("shows step-synced mock claims and API exchanges in the ID-JAG view", () => {
    renderPage();
    const panel = screen.getByText("Protocol details").closest("details");
    expect(panel).toBeTruthy();
    expect(panel.open).toBe(true);
    expect(screen.getByText("2 token exchanges")).toBeTruthy();
    expect(screen.getByText(/MOCK DATA — NOT A REAL TOKEN/)).toBeTruthy();
    expect(panel.textContent).toContain('"useCaseId": "enterprise-managed-mcp-authorization"');
    expect(panel.textContent).toContain('"threadId": "<thread id>"');

    fireEvent.click(screen.getByRole("button", { name: "Step 2: Side 1 · PingFederate validates the upstream token" }));
    expect(panel.textContent).toContain("requested_token_type");
    expect(panel.textContent).toContain("oauth:token-type:id-jag");
    expect(panel.textContent).toContain("subject_token_type");
    expect(panel.textContent).toContain("token-type:refresh_token");
    fireEvent.click(screen.getByRole("button", { name: "Step 4: Side 2 · submit ID-JAG for validation" }));
    expect(panel.textContent).toContain("jwt-bearer");
    expect(panel.textContent).toContain("assertion=<ID-JAG>");
    expect(panel.textContent).toContain("ID-JAG · signed assertion");
    fireEvent.click(screen.getByRole("button", { name: "Step 5: Downstream AS issues its local access token" }));
    expect(panel.textContent).toContain("<MCP access token>");
    fireEvent.click(screen.getByRole("button", { name: "Step 6: Call the protected MCP tool" }));
    expect(panel.textContent).toContain('"method": "tools/call"');
    expect(panel.textContent).toContain("Bearer <MCP access token>");

  });

  it("plays, pauses, steps, resets, and uses the selected step timer", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      expect(topControls().getByText("Step 1 / 10")).toBeTruthy();
      const stepTime = topControls().getByLabelText("Step time:");
      fireEvent.change(stepTime, { target: { value: "800" } });
      fireEvent.click(topControls().getByRole("button", { name: "Simulate" }));
      expect(topControls().getByRole("button", { name: "Pause" })).toBeTruthy();
      expect(stepTime.disabled).toBe(true);

      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 2 / 10")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Pause" }));
      fireEvent.click(topControls().getByRole("button", { name: "Next →" }));
      expect(topControls().getByText("Step 3 / 10")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "← Prev" }));
      expect(topControls().getByText("Step 2 / 10")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Resume" }));
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 3 / 10")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "Stop" }));
      expect(topControls().getByRole("button", { name: "Simulate" })).toBeTruthy();
      expect(topControls().getByText("Step 1 / 10")).toBeTruthy();
      fireEvent.click(topControls().getByRole("button", { name: "↺ Reset" }));
      expect(topControls().getByText("Step 1 / 10")).toBeTruthy();
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

      expect(topControls().getByText("Step 3 / 10")).toBeTruthy();
      expect(topControls().getByRole("button", { name: "Resume" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 3 / 10")).toBeTruthy();
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
      fireEvent.click(screen.getByRole("tab", { name: "PingFederate login, PF login + agent authorization" }));

      expect(topControls().getByText("Step 1 / 19")).toBeTruthy();
      expect(topControls().getByRole("button", { name: "Simulate" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(800));
      expect(topControls().getByText("Step 1 / 19")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });


  it("ends the ID-JAG flow at the MCP server and the banking API, not at an abstract resource", () => {
    expect(DIAGRAMS.jag.steps).toHaveLength(7);
    expect(DIAGRAMS.jag.flow.NODES.map(({ id }) => id)).toEqual(expect.arrayContaining(["invest", "banking"]));
    const data = DIAGRAMS.jag.flow.EDGES.findIndex((e) => e[0] === "invest" && e[1] === "banking");
    expect(data).toBeGreaterThanOrEqual(0);
    expect(DIAGRAMS.jag.steps[6].edges).toEqual([data]);
  });

  it("lists every call under the diagram", () => {
    renderPage();
    const section = screen.getByTestId("pfj-calls");
    expect(section.textContent).toContain("Every call, in order");
    expect(within(section).getAllByRole("button", { name: /^Call \d+:/ })).toHaveLength(19);
  });
});
