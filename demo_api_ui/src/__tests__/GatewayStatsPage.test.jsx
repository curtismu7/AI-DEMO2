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

  it("is linked from Mission Control", () => {
    expect(JSON.stringify(MISSION_CONTROL_CATALOG)).toContain("/gateway-stats");
  });
});
