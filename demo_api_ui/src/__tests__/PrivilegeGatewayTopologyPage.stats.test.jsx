// PrivilegeGatewayTopologyPage.stats.test.jsx — the "Live LB stats" panel on the
// static lb tab: an iframe through the admin-gated BFF proxy (PingOne session;
// the stats credential lives only in the BFF env).
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import PrivilegeGatewayTopologyPage from "../components/PrivilegeGatewayTopologyPage";

const ENV_KEY = "REACT_APP_MCPGW_STATS_URL";

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
  const original = process.env[ENV_KEY];
  beforeEach(() => {
    delete process.env[ENV_KEY];
    apiClient.get.mockReset();
    apiClient.post.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("stats URL unset: explains the panel instead of iframing an error", () => {
    render(<PrivilegeGatewayTopologyPage />);
    expect(screen.getByText(/Live LB stats/)).toBeTruthy();
    expect(screen.queryByTitle("HAProxy LB stats")).toBeNull();
  });

  it("stats URL set: iframes HAProxy's built-in stats page on the lb tab", () => {
    process.env[ENV_KEY] = "https://mcpgw.ai-demo.ping-devops.com/lb-stats";
    render(<PrivilegeGatewayTopologyPage />);
    const frame = screen.getByTitle("HAProxy LB stats");
    // The iframe rides the demo's PingOne session through the admin-gated BFF
    // proxy — no browser basic-auth prompt, the credential never reaches the
    // client. The env var only proves the feature is configured for THIS deploy.
    expect(frame.getAttribute("src")).toBe("/api/admin/lb/runtime/stats-view");
  });

  it("stats URL set but on an archived tab: no iframe", () => {
    process.env[ENV_KEY] = "https://mcpgw.ai-demo.ping-devops.com/lb-stats";
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
    apiClient.get.mockRejectedValue(new Error("403"));
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
