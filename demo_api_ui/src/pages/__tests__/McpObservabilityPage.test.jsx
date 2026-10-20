import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import McpObservabilityPage, { buildObservabilitySummary } from "../McpObservabilityPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn() },
}));

const auditEvents = [
  {
    eventId: "evt-1",
    timestamp: "2026-09-18T14:32:00.000Z",
    operation: "transfer_funds",
    outcome: "success",
    agentId: "agent-olb-07",
    userId: "maya.chen",
    duration: 842,
    vertical: "banking",
    correlationId: "c-7f9e2a",
    details: { alert: false },
  },
  {
    eventId: "evt-2",
    timestamp: "2026-09-18T14:31:54.000Z",
    operation: "approve_transfer",
    outcome: "failure",
    agentId: "agent-olb-03",
    userId: "alex.roberts",
    duration: 118,
    vertical: "banking",
    correlationId: "c-b45e91",
    details: { alert: true, reason: "insufficient_scope" },
  },
];

beforeEach(() => {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/mcp/audit?limit=100") return Promise.resolve({ data: auditEvents });
    if (url === "/api/mcp/audit?summary=1") {
      return Promise.resolve({ data: { totalEvents: 2, byEventType: { tool_call: 2 }, byOutcome: { success: 1, failure: 1 } } });
    }
    if (url === "/api/health/gateway-metrics") {
      return Promise.resolve({ data: { available: true, methods: [], errors: [] } });
    }
    if (url === "/api/health") {
      return Promise.resolve({ data: { status: "healthy", components: { pingone_jwks: { status: "healthy" }, mcp_server: { status: "healthy" } } } });
    }
    if (url === "/api/transaction-trace/c-7f9e2a") {
      return Promise.resolve({ data: { correlationId: "c-7f9e2a", hops: [] } });
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
});

describe("McpObservabilityPage", () => {
  it("counts all alerting authorization failures and preserves missing durations", () => {
    const summary = buildObservabilitySummary([
      { eventId: "scope", outcome: "failure", duration: null, details: { alert: true, reason: "insufficient_scope" } },
      { eventId: "step-up", outcome: "failure", duration: undefined, details: { alert: true, reason: "stepup_required" } },
    ], { totalEvents: 2, byOutcome: { failure: 2 } }, { available: false }, {});

    expect(summary.denied).toBe(2);
    expect(summary.p95).toBeNull();
  });

  it("loads live audit and metrics data into the operations view", async () => {
    render(<McpObservabilityPage />);

    expect(await screen.findByRole("heading", { name: /MCP traffic, with the why attached/i })).toBeInTheDocument();
    expect(screen.getAllByText("transfer_funds").length).toBeGreaterThan(0);
    expect(screen.getAllByText("approve_transfer").length).toBeGreaterThan(0);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/mcp/audit?limit=100", { _silent: true });
    expect(apiClient.get).toHaveBeenCalledWith("/api/health/gateway-metrics", { _silent: true });
  });

  it("loads the selected request trace from the correlation id", async () => {
    const user = { setup: false };
    render(<McpObservabilityPage />);

    await screen.findAllByText("transfer_funds");
    fireEvent.click(screen.getByRole("button", { name: /transfer_funds/i }));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/api/transaction-trace/c-7f9e2a", { _silent: true }));
    expect(screen.getAllByText(/c-7f9e2a/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Trace unavailable: no chain-of-custody hops were returned/i)).toBeInTheDocument();
    expect(user.setup).toBe(false);
  });

  it("draws where the data comes from in the Ping style with Simulate and Reset", async () => {
    render(<McpObservabilityPage />);

    const flow = await screen.findByRole("region", { name: "Where this page's data comes from" });
    expect(flow.classList.contains("efd--ping")).toBe(true);
    expect(flow.querySelector(".sfd--ping")).toBeTruthy();
    expect(within(flow).getByRole("button", { name: "Simulate" })).toBeInTheDocument();
    expect(within(flow).getByRole("button", { name: /Reset$/ })).toBeInTheDocument();
  });
});
