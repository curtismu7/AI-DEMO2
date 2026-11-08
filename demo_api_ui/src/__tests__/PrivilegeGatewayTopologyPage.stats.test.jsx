// PrivilegeGatewayTopologyPage.stats.test.jsx — the "Live LB stats" panel on the
// static lb tab: an iframe through the admin-gated BFF proxy (PingOne session;
// the stats credential lives only in the BFF env). No build-time env gate —
// the proxy's own 503 is the configuration signal.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import PrivilegeGatewayTopologyPage from "../components/PrivilegeGatewayTopologyPage";

vi.mock("../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import apiClient from "../services/apiClient";

const NODES = {
  nodes: [
    { name: "gateway-1", status: "UP", sessions: 3 },
    { name: "gateway-2", status: "UP", sessions: 2 },
    { name: "gateway-3", status: "MAINT", sessions: 0 },
  ],
  errors: [],
};

describe("PrivilegeGatewayTopologyPage — Live LB stats panel", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.post.mockReset();
  });

  it("stats panel always renders and iframes the BFF proxy", () => {
    render(<PrivilegeGatewayTopologyPage />);
    expect(screen.getByText(/Live LB stats/)).toBeTruthy();
    const frame = screen.getByTitle("HAProxy LB stats");
    // The iframe rides the demo's PingOne session through the admin-gated BFF
    // proxy — no browser basic-auth prompt, the credential never reaches the
    // client.
    expect(frame.getAttribute("src")).toBe("/api/admin/lb/runtime/stats-view");
  });

  it("stats panel is lb-tab only: on an archived tab there is no iframe", () => {
    render(<PrivilegeGatewayTopologyPage />);
    const tabs = screen.getAllByRole("button");
    fireEvent.click(tabs.find((b) => b.textContent === "Agent-based"));
    expect(screen.queryByTitle("HAProxy LB stats")).toBeNull();
  });
});

describe("PrivilegeGatewayTopologyPage — LB runtime park/unpark panel", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.post.mockReset();
  });

  it("fetches node state on mount and renders one row per gateway with status", async () => {
    apiClient.get.mockResolvedValue({ data: NODES });
    render(<PrivilegeGatewayTopologyPage />);
    const row = await screen.findByText("gateway-2", { selector: ".pgt-runtime__row code" });
    expect(row.closest(".pgt-runtime__row").textContent).toContain("UP");
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/lb/runtime");
  });

  it("Park click posts to the runtime API and refetches state", async () => {
    apiClient.get.mockResolvedValue({ data: NODES });
    apiClient.post.mockResolvedValue({ data: { node: "gateway-2", action: "park", appliedTo: 2 } });
    render(<PrivilegeGatewayTopologyPage />);
    const row = (await screen.findByText("gateway-2", { selector: ".pgt-runtime__row code" })).closest(".pgt-runtime__row");
    fireEvent.click(row.querySelector("button"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/admin/lb/runtime/gateway-2/park"));
    await waitFor(() => expect(apiClient.get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("fetch fails (not signed in as admin): the panel names it, no rows", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403 } }));
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText(/Sign in as an admin/)).toBeTruthy();
    expect(screen.queryByText("gateway-1", { selector: ".pgt-runtime__row code" })).toBeNull();
  });

  it("errors from the fan-out are surfaced per pod", async () => {
    apiClient.get.mockResolvedValue({ data: { nodes: NODES.nodes, errors: ["127.0.0.1:19902: timeout"] } });
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText(/1 pod unreachable/)).toBeTruthy();
  });
});

describe("PrivilegeGatewayTopologyPage — Ping UI live/sample labelling and focus", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.post.mockReset();
  });

  it("signed out: the runtime card is neutral with an Admin sign-in needed chip; the stats card says admin only", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403 } }));
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText("Admin sign-in needed")).toBeTruthy();
    expect(screen.getByText("LB runtime controls").closest(".pu-card").className).toContain("pu-card--neutral");
    expect(screen.getByText("Live, admin only")).toBeTruthy();
    expect(screen.getByTestId("pgt-stats").className).toContain("pu-card--live");
  });

  it("signed in: the runtime card is live, each node row carries its status word as a chip", async () => {
    apiClient.get.mockResolvedValue({ data: NODES });
    render(<PrivilegeGatewayTopologyPage />);
    const row = (await screen.findByText("gateway-3", { selector: ".pgt-runtime__row code" })).closest(".pgt-runtime__row");
    expect(row.querySelector(".pu-chip--warn").textContent).toBe("MAINT");
    const up = screen.getByText("gateway-1", { selector: ".pgt-runtime__row code" }).closest(".pgt-runtime__row");
    expect(up.querySelector(".pu-chip--ok").textContent).toBe("UP");
    expect(screen.getByText("LB runtime controls").closest(".pu-card").className).toContain("pu-card--live");
    expect(screen.getAllByText("Live, admin only").length).toBe(2);
  });

  it("row buttons are secondaries with the node in their name; Unpark on a parked node", async () => {
    apiClient.get.mockResolvedValue({ data: NODES });
    render(<PrivilegeGatewayTopologyPage />);
    const park = await screen.findByRole("button", { name: "Park gateway-1" });
    expect(park.className).toContain("pu-btn");
    expect(park.className).not.toContain("primary");
    expect(screen.getByRole("button", { name: "Unpark gateway-3" })).toBeTruthy();
  });

  it("Park keeps keyboard focus on the same button while the call runs and after the row flips to Unpark, and a second press is ignored", async () => {
    apiClient.get.mockResolvedValueOnce({ data: NODES });
    let finish;
    apiClient.post.mockReturnValue(new Promise((r) => { finish = r; }));
    render(<PrivilegeGatewayTopologyPage />);
    const park = await screen.findByRole("button", { name: "Park gateway-2" });
    park.focus();
    expect(document.activeElement).toBe(park);
    fireEvent.click(park);
    await waitFor(() => expect(park.getAttribute("aria-disabled")).toBe("true"));
    expect(park.disabled).toBe(false);
    expect(document.activeElement).toBe(park);
    fireEvent.click(park);
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    apiClient.get.mockResolvedValue({ data: { nodes: NODES.nodes.map((n) => (n.name === "gateway-2" ? { ...n, status: "MAINT" } : n)), errors: [] } });
    finish({ data: {} });
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpark gateway-2" })).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Unpark gateway-2" }));
    expect(park.getAttribute("aria-disabled")).toBeNull();
    const notice = screen.getByTestId("pgt-runtime-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("Done");
    expect(notice.textContent).toContain("gateway-2 parked");
  });

  it("a failed Park says Failed with the reason, and the button works again", async () => {
    apiClient.get.mockResolvedValue({ data: NODES });
    apiClient.post.mockRejectedValue({ response: { data: { error: "runtime API refused" } } });
    render(<PrivilegeGatewayTopologyPage />);
    const park = await screen.findByRole("button", { name: "Park gateway-1" });
    fireEvent.click(park);
    const notice = screen.getByTestId("pgt-runtime-notice");
    await waitFor(() => expect(notice.textContent).toContain("Failed"));
    expect(notice.textContent).toContain("runtime API refused");
    await waitFor(() => expect(park.getAttribute("aria-disabled")).toBeNull());
  });

  it("no nodes reported: an empty note, not a blank card", async () => {
    apiClient.get.mockResolvedValue({ data: { nodes: [], errors: [] } });
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText("The load balancer reported no nodes.")).toBeTruthy();
  });

  it("F8: a 500 from the LB read says it could not read the load balancer, never 'Admin sign-in needed'", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("Request failed"), { response: { status: 500 } }));
    render(<PrivilegeGatewayTopologyPage />);
    const card = (await screen.findByText("LB runtime controls")).closest(".pu-card");
    await waitFor(() => expect(card.textContent).toContain("Could not read the load balancer (HTTP 500)"));
    expect(screen.queryByText("Admin sign-in needed")).toBeNull();
    expect(card.querySelector(".pu-chip--danger").textContent).toBe("Unavailable");
  });

  it("F8: a network error (no response) is also not a sign-in problem", async () => {
    apiClient.get.mockRejectedValue(new Error("Network Error"));
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText(/Could not read the load balancer \(Network Error\)/)).toBeTruthy();
    expect(screen.queryByText("Admin sign-in needed")).toBeNull();
  });

  it("F8: 401 and 403 are still 'Admin sign-in needed'", async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error("x"), { response: { status: 401 } }));
    render(<PrivilegeGatewayTopologyPage />);
    expect(await screen.findByText("Admin sign-in needed")).toBeTruthy();
  });

  it("F8: after a good read, a later 500 keeps the last nodes on screen and says the read failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiClient.get.mockResolvedValueOnce({ data: NODES });
      render(<PrivilegeGatewayTopologyPage />);
      await screen.findByText("gateway-1", { selector: ".pgt-runtime__row code" });
      apiClient.get.mockRejectedValue(Object.assign(new Error("x"), { response: { status: 502 } }));
      await vi.advanceTimersByTimeAsync(10000);
      await waitFor(() => expect(screen.getByText(/Could not read the load balancer \(HTTP 502\)/)).toBeTruthy());
      expect(screen.getByText("gateway-1", { selector: ".pgt-runtime__row code" })).toBeTruthy();
      expect(screen.queryByText("Admin sign-in needed")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

