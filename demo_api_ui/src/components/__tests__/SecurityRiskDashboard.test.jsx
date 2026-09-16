import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecurityRiskDashboard from "../SecurityRiskDashboard";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn() },
}));

describe("SecurityRiskDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockImplementation((path) => {
      if (path === "/api/health/services") {
        return Promise.resolve({
          data: {
            timestamp: "2026-09-16T15:00:00.000Z",
            services: {
              mcp_gateway: { up: true },
              mcp_server: { up: false, error: "probe failed" },
            },
          },
        });
      }
      if (path === "/api/admin/app-events?limit=100") {
        return Promise.resolve({
          data: {
            events: [
              {
                id: "evt-1",
                timestamp: "2026-09-16T14:59:00.000Z",
                category: "authorize",
                severity: "error",
                message: "Policy deny: token audience mismatch",
                correlationId: "corr-12345678",
              },
              {
                id: "evt-2",
                timestamp: "2026-09-16T14:58:00.000Z",
                category: "token_exchange",
                severity: "info",
                message: "Token exchange completed",
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { available: false, methods: [] } });
    });
  });

  it("renders live posture signals and dependency health", async () => {
    render(<SecurityRiskDashboard />);

    expect(screen.getByText("Loading security posture…")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Security & Risk Dashboard" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Elevated")).toBeInTheDocument();
    expect(screen.getByText("MCP gateway")).toBeInTheDocument();
    expect(screen.getByText("MCP server")).toBeInTheDocument();
    expect(
      await screen.findAllByText("Policy deny: token audience mismatch"),
    ).not.toHaveLength(0);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("opens the selected-risk detail from the risk queue", async () => {
    render(<SecurityRiskDashboard />);
    expect(
      await screen.findAllByText("Policy deny: token audience mismatch"),
    ).not.toHaveLength(0);

    fireEvent.click(
      screen.getAllByText("Policy deny: token audience mismatch")[0],
    );

    expect(screen.getByText("Why it matters")).toBeInTheDocument();
    expect(
      screen.getByText(/Open the source event using its correlation ID/),
    ).toBeInTheDocument();
  });
});
