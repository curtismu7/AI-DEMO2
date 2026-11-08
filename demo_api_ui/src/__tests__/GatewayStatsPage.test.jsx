// GatewayStatsPage.test.jsx — /gateway-stats asks the admin-gated BFF stats proxy first and says what is
// wrong (not signed in, server not configured) instead of showing a blank frame; Mission Control links to it.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import GatewayStatsPage from "../components/GatewayStatsPage";
import { MISSION_CONTROL_CATALOG } from "../config/missionControlCatalog";

const reply = (status) => vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });

afterEach(() => { vi.unstubAllGlobals(); });

describe("GatewayStatsPage", () => {
  it("frames the BFF stats proxy, not HAProxy directly, once the proxy answers", async () => {
    vi.stubGlobal("fetch", reply(200));
    render(<GatewayStatsPage />);
    const frame = await screen.findByTitle("HAProxy LB stats");
    expect(frame.getAttribute("src")).toBe("/api/admin/lb/runtime/stats-view");
    expect(screen.getByRole("heading", { name: "Gateway stats" })).toBeTruthy();
  });

  it("tells a signed-out visitor to sign in, and re-checks on request", async () => {
    const fetchMock = reply(401);
    vi.stubGlobal("fetch", fetchMock);
    render(<GatewayStatsPage />);
    expect(await screen.findByText("Sign in to see the stats.")).toBeTruthy();
    expect(screen.queryByTitle("HAProxy LB stats")).toBeNull();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByTitle("HAProxy LB stats")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the missing server settings on a 503", async () => {
    vi.stubGlobal("fetch", reply(503));
    render(<GatewayStatsPage />);
    expect(await screen.findByText("The server has no stats connection set up.")).toBeTruthy();
    expect(screen.getByText("MCPGW_LB_STATS_URL")).toBeTruthy();
  });

  it("says the stats could not be loaded on any other answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    render(<GatewayStatsPage />);
    expect(await screen.findByText("The stats could not be loaded.")).toBeTruthy();
  });

  describe("Ping UI Standard", () => {
    it("puts the banner first, as a note, and its wording follows the state (never 'live' without data)", async () => {
      let finish;
      vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
      const { container } = render(<GatewayStatsPage />);
      const root = container.querySelector(".pu-page.gws-page");
      expect(root.firstElementChild.querySelector("[role=note]")).toBeTruthy();
      expect(screen.getByTestId("gws-banner").textContent).toMatch(/NO DATA YET/);
      finish({ ok: false, status: 401 });
      await screen.findByText("Sign in to see the stats.");
      const banner = screen.getByTestId("gws-banner").textContent;
      expect(banner).toMatch(/NO DATA SHOWN/);
      expect(banner).not.toMatch(/LIVE DATA/);
      expect(banner).toMatch(/Nothing on this page is simulated/);
    });

    it("says live data only once the proxy answered, and names the one thing it checked", async () => {
      vi.stubGlobal("fetch", reply(200));
      render(<GatewayStatsPage />);
      await screen.findByTitle("HAProxy LB stats");
      const banner = screen.getByTestId("gws-banner").textContent;
      expect(banner).toMatch(/LIVE DATA, NOTHING SIMULATED/);
      expect(banner).toMatch(/does not judge node health/);
    });

    it.each([
      [200, "Proxy answered", "ok"],
      [401, "Not signed in", "warn"],
      [503, "Not configured", "warn"],
      [500, "Not loaded", "danger"],
    ])("a %s answer gets the word %s in a %s chip, and a matching card edge", async (status, word, tone) => {
      vi.stubGlobal("fetch", reply(status));
      render(<GatewayStatsPage />);
      await waitFor(() => expect(screen.getByTestId("gws-status").textContent).toContain(word));
      const chip = screen.getByTestId("gws-status").querySelector(".pu-chip");
      expect(chip.className).toContain(`pu-chip--${tone}`);
      expect(screen.getByTestId("gws-connection-card").className).toContain(`pu-card--${tone}`);
    });

    it("is neutral while it has not checked yet", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      render(<GatewayStatsPage />);
      expect(screen.getByTestId("gws-status").querySelector(".pu-chip--neutral").textContent).toBe("Checking");
    });

    it("announces the result in a status region that stays mounted", async () => {
      vi.stubGlobal("fetch", reply(401));
      render(<GatewayStatsPage />);
      const region = screen.getByRole("status");
      await screen.findByText("Sign in to see the stats.");
      expect(screen.getByRole("status")).toBe(region);
    });

    it("has exactly one primary button in every state, and it keeps focus after a press", async () => {
      const fetchMock = reply(401);
      vi.stubGlobal("fetch", fetchMock);
      render(<GatewayStatsPage />);
      await screen.findByText("Sign in to see the stats.");
      const button = screen.getByRole("button", { name: "Check again" });
      expect(document.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
      button.focus();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      fireEvent.click(button);
      await screen.findByTitle("HAProxy LB stats");
      expect(screen.getByRole("button", { name: "Check again" })).toBe(button);
      expect(document.activeElement).toBe(button);
      expect(document.querySelectorAll(".pu-btn--primary")).toHaveLength(1);
    });

    it("keeps the button focusable (aria-disabled, not disabled) while a check runs and ignores a second press", async () => {
      let finish;
      const fetchMock = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
      vi.stubGlobal("fetch", fetchMock);
      render(<GatewayStatsPage />);
      const button = screen.getByRole("button", { name: "Check again" });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      finish({ ok: false, status: 503 });
      await screen.findByText("The server has no stats connection set up.");
      expect(button.getAttribute("aria-disabled")).toBeNull();
    });
  });

  it("is linked from Mission Control", () => {
    expect(JSON.stringify(MISSION_CONTROL_CATALOG)).toContain("/gateway-stats");
  });
});
