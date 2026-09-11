import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn() } }));

import apiClient from "../../services/apiClient";
import IdentityChainPage, { chainSteps } from "../IdentityChainPage";

// A third-party app's plain SSO token: no delegated agent, so real PingOne
// Authorize denies with mcp-invalid-actor.
const ONYX_DENY = {
  ts: "2026-09-11T14:30:02.000Z",
  method: "initialize",
  tool: "",
  decision: "DENY",
  backend: "real",
  sub: "user-1",
  email: "demo@example.com",
  clientId: "onyx-app",
  aud: "https://api.ping.demo:3036/mcp",
  scope: "openid profile gateway:mcp:invoke",
  iss: "https://auth.pingone.com/env/as",
  actor: "",
  statements: [
    { code: "mcp-invalid-actor", payload: JSON.stringify({ message: "Actor client ID '' is not a registered actor" }) },
  ],
};

describe("IdentityChainPage", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
  });

  it("draws a denied third-party call as a chain that stops at PingOne Authorize", async () => {
    apiClient.get.mockResolvedValue({ data: { decisions: [ONYX_DENY] } });
    render(<IdentityChainPage />);

    expect(await screen.findByText("demo@example.com")).toBeInTheDocument();
    expect(screen.getByText("onyx-app")).toBeInTheDocument();
    expect(screen.getByText(/no delegated agent/)).toBeInTheDocument();
    expect(screen.getByText(/is not a registered actor/)).toBeInTheDocument();
    expect(screen.getByText("not reached")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/agent-gateway/decisions", { params: { limit: 20 } });
  });

  it("says how to produce a decision when there are none yet", async () => {
    apiClient.get.mockResolvedValue({ data: { decisions: [] } });
    render(<IdentityChainPage />);
    expect(await screen.findByText(/No gateway decisions yet/)).toBeInTheDocument();
  });

  it("links to Onyx in a new window so the two can sit side by side", async () => {
    apiClient.get.mockResolvedValue({ data: { decisions: [] } });
    render(<IdentityChainPage />);
    const link = await screen.findByRole("link", { name: /Open Onyx/ });
    expect(link).toHaveAttribute("href", "http://localhost:3003");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("marks a permitted delegated call as reaching the MCP server", () => {
    const steps = chainSteps({ ...ONYX_DENY, decision: "PERMIT", actor: "agent-7", statements: [] });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.token.status).toBe("ok");
    expect(byKey.token.detail).toMatch(/acting agent agent-7/);
    expect(byKey.mcp.value).toBe("reached");
    expect(byKey.authorize.status).toBe("ok");
  });

  it("does not claim the MCP server was reached when PingGateway held a PERMIT", () => {
    // Step-up / approval: P1AZ said PERMIT with an unmet obligation, so the gateway
    // stopped the call and reports where.
    const steps = chainSteps({ ...ONYX_DENY, decision: "PERMIT", actor: "agent-7", statements: [], stoppedAt: "P1AZDecision" });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.mcp.value).toBe("held at PingGateway");
    expect(byKey.mcp.status).toBe("warn");
    expect(byKey.authorize.status).toBe("warn");
  });
});
