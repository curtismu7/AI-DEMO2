import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearIdJagRunState, ID_JAG_PENDING_INTENT_KEY } from "../../utils/idJagRunMode";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../components/TokenChainFilmstrip", () => ({ default: () => <div data-testid="filmstrip" /> }));

import EnterpriseMcpDemoPage from "../EnterpriseMcpDemoPage";
import { PI_FLOW_SIGNIN_EVENT } from "../../utils/authUi";

describe("EnterpriseMcpDemoPage", () => {
  beforeEach(() => {
    clearIdJagRunState();
    sessionStorage.clear();
    tokenChainTraceStore.reset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders the token chain and explains both ID-JAG hops", () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getByTestId("filmstrip")).toBeTruthy();
    expect(screen.getAllByText(/ID-JAG issued/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ID-JAG redeemed/i).length).toBeGreaterThan(0);
  });

  it("lets the user pick the movie reel or the sequence diagram for all 19 calls", () => {
    render(<EnterpriseMcpDemoPage />);
    expect(screen.getByRole("heading", { name: "Every call, in order" })).toBeTruthy();
    expect(screen.getByTestId("idjag-reel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sequence diagram" }));
    expect(screen.getByTestId("idjag-sequence")).toBeTruthy();
    expect(screen.queryByTestId("idjag-reel")).toBeNull();
  });

  it("launches live UC40 without sending an agent prompt before authentication", () => {
    const launched = vi.fn();
    const prefilled = vi.fn();
    window.addEventListener("id-jag-run-requested", launched);
    window.addEventListener("banking-agent-prefill", prefilled);
    try {
      render(<EnterpriseMcpDemoPage />);
      fireEvent.click(screen.getByRole("button", { name: "Run live ID-JAG demo" }));

      expect(launched).toHaveBeenCalledTimes(1);
      expect(launched.mock.calls[0][0].detail).toEqual({
        useCaseId: "enterprise-managed-mcp-authorization",
        mode: "live-id-jag",
        message: "show my balance",
        returnTo: "/pingfederate-id-jag/demo",
      });
      expect(prefilled).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toMatch(/Live PF ID-JAG/);
    } finally {
      window.removeEventListener("id-jag-run-requested", launched);
      window.removeEventListener("banking-agent-prefill", prefilled);
    }
  });

  it("explains how to recover when PingOne rejected the live login after sign-out", () => {
    const previousUrl = window.location.href;
    window.history.replaceState({}, "", "/pingfederate-id-jag/demo?error=id_jag_provider_required");
    try {
      render(<EnterpriseMcpDemoPage />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/PingOne.*selected/i);
      expect(alert).toHaveTextContent(/PingFederate/i);
      expect(alert).toHaveTextContent(/P1\/PF/);
      expect(alert).toHaveTextContent(/run.*again/i);
      // The admin sign-in opens the branded pi.flow modal.
      const handled = vi.fn((e) => { e.detail.handled = true; });
      window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);
      fireEvent.click(screen.getByRole("button", { name: /sign in as admin/i }));
      expect(handled).toHaveBeenCalled();
      expect(handled.mock.calls[0][0].detail.returnTo).toBe("/pingfederate-id-jag/demo");
      window.removeEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });

  // Regression: every failed handoff rendered "PingOne is selected", even for a user on
  // PingFederate whose handoff was merely lost. Each error code now has its own message.
  it.each([
    ["id_jag_intent_lost", /handoff was lost.*PingFederate is still selected/i],
    ["id_jag_return_mismatch", /different page/i],
    ["id_jag_provider_mismatch", /signed in with PingFederate.*set to PingOne/i],
  ])("%s does not claim PingOne is the selected provider unless it is", (code, text) => {
    const previousUrl = window.location.href;
    window.history.replaceState({}, "", `/pingfederate-id-jag/demo?error=${code}`);
    try {
      render(<EnterpriseMcpDemoPage />);
      expect(screen.getByRole("alert")).toHaveTextContent(text);
      if (code !== "id_jag_provider_mismatch") expect(screen.getByRole("alert")).not.toHaveTextContent(/PingOne is selected/i);
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });

  it("replaces the live status with provider recovery when preflight rejects PingOne", () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run live ID-JAG demo" }));
    fireEvent(window, new Event("id-jag-provider-required"));

    expect(screen.getByRole("alert")).toHaveTextContent(/PingOne.*selected/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replays a visibly mock ID-JAG flow while signed out without auth, network, flags, or agent events", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const events = ["id-jag-mock-replay-requested", "id-jag-run-requested", "banking-agent-prefill", "userLoggedOut", "userAuthenticated"];
    const heard = Object.fromEntries(events.map((name) => [name, vi.fn()]));
    events.forEach((name) => window.addEventListener(name, heard[name]));
    try {
      render(<EnterpriseMcpDemoPage />);
      fireEvent.click(screen.getByRole("button", { name: "Run mock demo" }));

      expect(heard["id-jag-mock-replay-requested"]).toHaveBeenCalledTimes(1);
      expect(heard["id-jag-run-requested"]).not.toHaveBeenCalled();
      expect(heard["banking-agent-prefill"]).not.toHaveBeenCalled();
      expect(heard.userLoggedOut).not.toHaveBeenCalled();
      expect(heard.userAuthenticated).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Mock replay — no login or live tokens");
      const trace = tokenChainTraceStore.getState().trace;
      expect(trace.tokenEvents.map((event) => event.label)).toEqual([
        "Mock PingFederate issued an ID-JAG",
        "Mock MCP authorization server redeemed the ID-JAG",
      ]);
      expect(trace.mcpResult.result.balance).toBe("Mock balance: 1,234 points");
    } finally {
      events.forEach((name) => window.removeEventListener(name, heard[name]));
    }
  });

  it("has exactly one primary button, the live run, which takes the shared Ping Red tokens", () => {
    const { container } = render(<EnterpriseMcpDemoPage />);
    const primaries = container.querySelectorAll("button.pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent("Run live ID-JAG demo");
    expect(screen.getByRole("button", { name: "Run mock demo" })).not.toHaveClass("pu-btn--primary");

    // The fill lives in the shared sheet (fixed --btn-accent*, not the vertical); the page sheet must not restyle it.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const shared = fs.readFileSync(path.resolve(here, "../../styles/ping-ui.css"), "utf8");
    const primaryRule = shared.match(/\.pu-page button\.pu-btn\.pu-btn--primary\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(primaryRule).toContain("var(--btn-accent-gradient)");
    expect(primaryRule).toContain("var(--btn-accent-text)");
    const pageCss = fs.readFileSync(path.resolve(here, "../EnterpriseMcpDemoPage.css"), "utf8");
    expect(pageCss).not.toMatch(/--signin-accent|--app-primary-red|--th-accent/);
  });

  it("opens with a role=note banner, first in the page, that says nothing has run and what is real vs simulated", () => {
    const { container } = render(<EnterpriseMcpDemoPage />);
    const banner = screen.getByRole("note");
    expect(banner).toHaveAttribute("data-testid", "emd-banner");
    expect(banner).toHaveTextContent(/nothing has run yet/i);
    expect(banner).toHaveTextContent(/live.*is real/i);
    expect(banner).toHaveTextContent(/mock.*is simulated/i);
    // First element of the page root, above the title band.
    expect(container.querySelector(".pu-page.emd-page").firstElementChild).toContainElement(banner);
    expect(container.querySelector(".pu-page.emd-page > header, .pu-page.emd-page header")).not.toBeNull();
  });

  it("makes the banner, chip and status follow the run mode in use", () => {
    render(<EnterpriseMcpDemoPage />);
    fireEvent.click(screen.getByRole("button", { name: "Run mock demo" }));
    expect(screen.getByRole("note")).toHaveTextContent(/mock replay.*simulated/i);
    expect(screen.getByRole("note")).not.toHaveTextContent(/nothing has run yet/i);
    expect(screen.getByRole("status").parentElement).toHaveTextContent("Simulated");
    expect(screen.getByRole("status").parentElement.querySelector(".pu-chip--neutral")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run live ID-JAG demo" }));
    expect(screen.getByRole("note")).toHaveTextContent(/live run requested/i);
    expect(screen.getByRole("note")).not.toHaveTextContent(/mock replay.*simulated/i);
    // Requested, not verified: never a green chip, because this page does not check a live run's outcome.
    const chip = screen.getByRole("status").parentElement.querySelector(".pu-chip");
    expect(chip).toHaveTextContent("Live requested");
    expect(chip).toHaveClass("pu-chip--info");
    expect(document.querySelector(".pu-chip--ok")).toBeNull();
  });

  it("lists what each run mode does as key-value rows and gives every chip a word", () => {
    const { container } = render(<EnterpriseMcpDemoPage />);
    const kv = container.querySelectorAll("dl.pu-kv");
    expect(kv).toHaveLength(2);
    expect(kv[0]).toHaveTextContent(/signed out first/i);
    expect(kv[1]).toHaveTextContent(/works signed out/i);
    expect(kv[1]).toHaveTextContent(/no request is made/i);
    container.querySelectorAll(".pu-chip").forEach((chip) => expect(chip.textContent.trim().length).toBeGreaterThan(0));
  });

  it("gives the recovery notice a word chip and keeps the live run as the primary in that state", () => {
    const previousUrl = window.location.href;
    window.history.replaceState({}, "", "/pingfederate-id-jag/demo?error=id_jag_intent_lost");
    try {
      const { container } = render(<EnterpriseMcpDemoPage />);
      const alert = screen.getByRole("alert");
      expect(alert.querySelector(".pu-chip--warn")).toHaveTextContent("Action needed");
      expect(container.querySelectorAll("button.pu-btn--primary")).toHaveLength(1);
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });

  it("keeps focus on the run button after it is pressed", async () => {
    render(<EnterpriseMcpDemoPage />);
    const mock = screen.getByRole("button", { name: "Run mock demo" });
    mock.focus();
    fireEvent.click(mock);
    expect(document.activeElement).toBe(mock);
  });

  // ping-ui.css gives `.pu-card li` min-width: 0, which let the movie reel's flex frames shrink to ~50px and overlap
  // inside the call-player card (measured in the browser). The page sheet keeps them at their own width.
  it("keeps the movie reel frames from shrinking inside a card", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.resolve(here, "../EnterpriseMcpDemoPage.css"), "utf8");
    const rule = css.match(/\.pu-page\.emd-page \.ijc-reel > li\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/flex:\s*0 0 auto/);
    expect(rule).toMatch(/min-width:\s*auto/);
  });
});
