import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import PingFederateIdJagImplementationPage from "../PingFederateIdJagImplementationPage";

const renderPage = () => render(<MemoryRouter><PingFederateIdJagImplementationPage /></MemoryRouter>);

function withLastRun(trace) {
  vi.spyOn(tokenChainTraceStore, "getState").mockReturnValue({ trace, steps: [], history: [] });
  vi.spyOn(tokenChainTraceStore, "subscribe").mockImplementation((fn) => { fn({ trace, steps: [], history: [] }); return () => {}; });
}

afterEach(() => vi.restoreAllMocks());

describe("ID-JAG implementation page", () => {
  it("is the last stop of the learning path", () => {
    renderPage();
    expect(screen.getByTestId("idjag-path")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back: See the protocol" })).toBeInTheDocument();
  });

  it("has a step for every hop through the banking API", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "7 · MCP server → banking API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8 · Banking API verifies" })).toBeInTheDocument();
  });

  it("explains a step in plain language when asked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "4 · Redeem at oauth-mcp" }));
    expect(screen.queryByTestId("idjag-simple")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    expect(screen.getByTestId("idjag-simple").textContent).toMatch(/visitor sticker/);
  });

  it("shows the real claims from the last run on the issue and redeem steps", () => {
    withLastRun({
      provenance: "live-id-jag",
      tokenEvents: [{ id: "pf-id-jag-issued", claims: { header: { typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pf.test", sub: "demouser", client_id: "ai-demo-pf-user", scope: "mcp:invoke", secret: "must-not-show" } } }],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    const live = screen.getByTestId("idjag-live");
    expect(live.textContent).toContain("ai-demo-pf-user");
    expect(live.textContent).toContain("Decoded from the token chain of your last live run");
    expect(live.textContent).not.toContain("must-not-show");
  });

  it("labels a mock replay as mock and says when this step has no claims", () => {
    withLastRun({ provenance: "mock-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "mock-user" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    expect(screen.getByTestId("idjag-live").textContent).toContain("Mock replay");
    fireEvent.click(screen.getByRole("button", { name: "4 · Redeem at oauth-mcp" }));
    // A run exists but recorded nothing for this step: not "no run recorded".
    expect(screen.getByTestId("idjag-live").textContent).toContain("The last run recorded no claims for this step");
    expect(screen.getByTestId("idjag-live").textContent).not.toContain("No run recorded");
  });

  it("has an every-call mode listing all 19 calls and describing the selected one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Every call/ }));
    expect(screen.getAllByRole("button", { name: /^\d+\. / })).toHaveLength(19);
    fireEvent.click(screen.getByRole("button", { name: "11. Fetch PingFederate keys" }));
    expect(screen.getByRole("heading", { name: "Call 11: Fetch PingFederate keys" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing else is sent to PingFederate/)).toBeInTheDocument();
  });

  it("shows claims on the redeem call in every-call mode", () => {
    withLastRun({ provenance: "live-id-jag", tokenEvents: [{ id: "pf-id-jag-redeemed", claims: { sub: "demouser", aud: "mcpserver.ping.demo" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Every call/ }));
    fireEvent.click(screen.getByRole("button", { name: "12. Verify, then mint" }));
    expect(screen.getByTestId("idjag-live").textContent).toContain("mcpserver.ping.demo");
  });

  // Ping UI standard (Wave 6)
  it("opens with a role=note banner inside the page root, before the learning-path bar", () => {
    const { container } = renderPage();
    const root = container.firstElementChild;
    expect(root).toHaveClass("pu-page");
    expect(root.firstElementChild).toHaveClass("pu-banner-wrap");
    expect(screen.getByRole("note")).toHaveTextContent(/WALKTHROUGH, NOT A LIVE CALL/);
    expect(root.children[1]).toBe(screen.getByTestId("idjag-path"));
  });

  it("words the banner from the run actually recorded, never a fixed claim", () => {
    renderPage();
    expect(screen.getByTestId("idjag-impl-banner").textContent).toMatch(/No run is recorded in this browser yet/);
    cleanup();
    const claims = [{ id: "pf-id-jag-issued", claims: { sub: "demouser" } }];
    withLastRun({ provenance: "mock-id-jag", tokenEvents: claims });
    renderPage();
    expect(screen.getByTestId("idjag-impl-banner").textContent).toMatch(/mock replay/);
    expect(screen.getByTestId("idjag-impl-banner").textContent).not.toMatch(/No run is recorded/);
    cleanup();
    withLastRun({ provenance: "live-id-jag", tokenEvents: claims });
    renderPage();
    expect(screen.getByTestId("idjag-impl-banner").textContent).toMatch(/last run recorded in this browser; this page does not re-check/);
    cleanup();
    // A trace with no claims (the store's empty trace before any run, or a run that recorded none) is still "no run recorded".
    withLastRun({ provenance: "live", tokenEvents: [] });
    renderPage();
    expect(screen.getByTestId("idjag-impl-banner").textContent).toMatch(/No run is recorded in this browser yet/);
  });

  it("has one h1, no second main landmark, and a named diagram region", () => {
    const { container } = renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByRole("region", { name: "ID-JAG implementation diagram" })).toBeInTheDocument();
  });

  it("keeps exactly one primary button in each view state", () => {
    const { container } = renderPage();
    const primaries = () => [...container.querySelectorAll(".pu-btn--primary")].map((b) => b.textContent);
    expect(primaries()).toEqual(["Simulate"]);
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(primaries()).toEqual(["Simulate"]);
    fireEvent.click(screen.getByRole("button", { name: /^Every call/ }));
    expect(primaries()).toEqual(["Next call"]);
  });

  it("uses aria-disabled so Back keeps focus at the first step and ignores the press", () => {
    renderPage();
    const back = screen.getByRole("button", { name: "Back" });
    back.focus();
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
    fireEvent.click(back);
    expect(document.activeElement).toBe(back);
    expect(screen.getByTestId("idjag-step-status")).toHaveTextContent("Showing Overview");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(back).toHaveAttribute("aria-disabled", "false");
  });

  it("steps through every call with Next call and stops, focus kept, on the last one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Every call/ }));
    const next = screen.getByRole("button", { name: "Next call" });
    next.focus();
    for (let i = 0; i < 25; i += 1) fireEvent.click(next);
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(next);
    expect(screen.getByTestId("idjag-step-status")).toHaveTextContent(/^Call 19:/);
    fireEvent.click(screen.getByRole("button", { name: "Previous call" }));
    expect(screen.getByTestId("idjag-step-status")).toHaveTextContent(/^Call 18:/);
  });

  it("marks the chosen step and mode with aria state, and toggles with aria-pressed", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "2 · Run + gate" }));
    expect(screen.getByRole("button", { name: "2 · Run + gate" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Phases" })).toHaveAttribute("aria-pressed", "true");
    const simple = screen.getByRole("button", { name: "Explain it simply" });
    fireEvent.click(simple);
    expect(simple).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lock nodes" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows claims as a card with a word chip: neutral for a recorded run, warn for a mock replay, none when empty", () => {
    const long = "A".repeat(100);
    withLastRun({ provenance: "live-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "demouser", aud: long } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    let live = screen.getByTestId("idjag-live");
    expect(live).toHaveClass("pu-card--neutral");
    expect(live.querySelector(".pu-chip")).toHaveClass("pu-chip--neutral");
    expect(live.querySelector(".pu-kv")).toHaveTextContent(long);
    expect(live).toHaveTextContent("Claims from your last live run");
    expect(live.querySelector(".pu-chip")).toHaveTextContent("Last live run");
    expect(live).not.toHaveTextContent("Real claims");
    cleanup();
    withLastRun({ provenance: "mock-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "mock-user" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    live = screen.getByTestId("idjag-live");
    expect(live).toHaveClass("pu-card--warn");
    expect(live.querySelector(".pu-chip")).toHaveTextContent("Mock replay");
    expect(live).not.toHaveTextContent("Real claims");
    cleanup();
    vi.restoreAllMocks();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    expect(screen.getByTestId("idjag-live").querySelector(".pu-chip")).toHaveTextContent("No run recorded");
  });

  it("announces the shown step in a live region that is mounted from the start", () => {
    renderPage();
    const status = screen.getByTestId("idjag-step-status");
    expect(status).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByRole("button", { name: "5 · Gateway validates" }));
    expect(status).toHaveTextContent("Showing 5 · Gateway validates");
  });

  // Skeptic fixes (wave 6 follow-up)
  it("words the claims card and banner from the provenance: a replayed run is never called live or real", () => {
    withLastRun({ provenance: "recorded", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "demouser" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    const live = screen.getByTestId("idjag-live");
    expect(live).toHaveClass("pu-card--neutral");
    expect(live.querySelector(".pu-chip")).toHaveTextContent("Replayed run");
    expect(live).toHaveTextContent("Claims from a replayed run");
    expect(live).toHaveTextContent("Replay of a recorded run, not a fresh live token");
    expect(live.textContent).not.toMatch(/Real claims|live token chain/);
    expect(screen.getByTestId("idjag-impl-banner").textContent).toMatch(/replay of an earlier run/);
    expect(screen.getByTestId("idjag-impl-banner").textContent).not.toMatch(/this page does not re-check|No run is recorded/);
  });

  it("does not say no run was recorded when a run exists but has no claims for this step", () => {
    withLastRun({ provenance: "live-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "demouser" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "4 · Redeem at oauth-mcp" }));
    const live = screen.getByTestId("idjag-live");
    expect(live.querySelector(".pu-chip")).toHaveTextContent("Not in this run");
    expect(live.querySelector(".pu-chip")).toHaveClass("pu-chip--neutral");
    expect(live.textContent).not.toMatch(/No run recorded/);
  });

  it("keeps the Simulate name stable (aria-pressed says it plays) and the focus on it", () => {
    renderPage();
    const sim = screen.getByRole("button", { name: "Simulate" });
    sim.focus();
    expect(sim).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sim);
    expect(screen.getByRole("button", { name: "Simulate" })).toBe(sim);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(sim).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(sim);
    expect(screen.getByTestId("idjag-playstate")).toHaveTextContent(/Playing/);
    fireEvent.click(sim);
    expect(sim).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("idjag-playstate")).toBeNull();
  });

  it("shows a neutral ended state when playback runs out of steps, and clears it on the next action", () => {
    vi.useFakeTimers();
    try {
      renderPage();
      const sim = screen.getByRole("button", { name: "Simulate" });
      fireEvent.click(sim);
      for (let i = 0; i < 12; i += 1) act(() => { vi.advanceTimersByTime(3600); });
      expect(sim).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("idjag-step-status")).toHaveTextContent(/^Walkthrough ended on 8 /);
      expect(screen.getByTestId("idjag-playstate")).toHaveTextContent(/ended on the last step/);
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.queryByTestId("idjag-playstate")).toBeNull();
      expect(screen.getByTestId("idjag-step-status")).toHaveTextContent(/^Showing 7 /);
    } finally {
      vi.useRealTimers();
    }
  });
});
