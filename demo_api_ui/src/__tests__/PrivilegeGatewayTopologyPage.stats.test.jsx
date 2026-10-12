// PrivilegeGatewayTopologyPage.stats.test.jsx — the "Live LB stats" panel on the
// static lb tab: an iframe of HAProxy's built-in stats page (basic auth is the
// browser's one-per-session prompt; the UI never holds the credential).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import PrivilegeGatewayTopologyPage from "../components/PrivilegeGatewayTopologyPage";

const ENV_KEY = "REACT_APP_MCPGW_STATS_URL";

describe("PrivilegeGatewayTopologyPage — Live LB stats panel", () => {
  const original = process.env[ENV_KEY];
  beforeEach(() => { delete process.env[ENV_KEY]; });
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
    expect(frame.getAttribute("src")).toBe("https://mcpgw.ai-demo.ping-devops.com/lb-stats");
  });

  it("stats URL set but on an archived tab: no iframe", () => {
    process.env[ENV_KEY] = "https://mcpgw.ai-demo.ping-devops.com/lb-stats";
    render(<PrivilegeGatewayTopologyPage />);
    const tabs = screen.getAllByRole("button");
    fireEvent.click(tabs.find((b) => b.textContent === "Agent-based"));
    expect(screen.queryByTitle("HAProxy LB stats")).toBeNull();
  });
});
