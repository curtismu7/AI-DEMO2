import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearIdJagRunState, ID_JAG_PENDING_INTENT_KEY } from "../../utils/idJagRunMode";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

vi.mock("../../components/TokenChainFilmstrip", () => ({ default: () => <div data-testid="filmstrip" /> }));

import EnterpriseMcpDemoPage from "../EnterpriseMcpDemoPage";

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

  it("keeps the primary run button high contrast in both themes", () => {
    const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../EnterpriseMcpDemoPage.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const primaryRule = css.match(/\.emd-btn--primary\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(primaryRule).toContain("color: #fff");
    expect(primaryRule).toContain("var(--signin-accent");
  });
});
