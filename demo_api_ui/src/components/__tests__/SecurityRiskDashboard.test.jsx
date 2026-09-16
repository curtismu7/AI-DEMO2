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

  it("prioritizes high-severity events before limiting the risk queue", async () => {
    apiClient.get.mockImplementation((path) => {
      if (path === "/api/health/services") {
        return Promise.resolve({ data: { services: { mcp_gateway: { up: true, configured: true } } } });
      }
      if (path === "/api/admin/app-events?limit=100") {
        return Promise.resolve({
          data: {
            events: [
              ...Array.from({ length: 5 }, (_, index) => ({
                id: `warning-${index}`,
                timestamp: `2026-09-16T14:5${index}:00.000Z`,
                category: "config",
                severity: "warning",
                message: `Warning ${index}`,
              })),
              {
                id: "critical-1",
                timestamp: "2026-09-16T14:59:00.000Z",
                category: "authorize",
                severity: "error",
                message: "Critical policy failure",
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { available: false, methods: [] } });
    });

    render(<SecurityRiskDashboard />);

    expect(await screen.findAllByText("Critical policy failure")).not.toHaveLength(0);
  });

  it("does not create synthetic signal bars when there are no events", async () => {
    apiClient.get.mockImplementation((path) => {
      if (path === "/api/health/services") {
        return Promise.resolve({ data: { services: { mcp_gateway: { up: true, configured: true } } } });
      }
      if (path === "/api/admin/app-events?limit=100") {
        return Promise.resolve({ data: { events: [] } });
      }
      return Promise.resolve({ data: { available: false, methods: [] } });
    });

    const { container } = render(<SecurityRiskDashboard />);
    await screen.findByRole("heading", { name: "Security & Risk Dashboard" });

    const bars = container.querySelectorAll(".srd-signal-bar--blue");
    expect(bars).toHaveLength(12);
    expect([...bars].every((bar) => bar.style.height === "0%")).toBe(true);
  });

  it("does not treat an unconfigured optional service as an outage", async () => {
    apiClient.get.mockImplementation((path) => {
      if (path === "/api/health/services") {
        return Promise.resolve({
          data: { services: { llm_proxy: { up: false, configured: false, error: "not_configured" } } },
        });
      }
      if (path === "/api/admin/app-events?limit=100") {
        return Promise.resolve({ data: { events: [] } });
      }
      return Promise.resolve({ data: { available: false, methods: [] } });
    });

    render(<SecurityRiskDashboard />);

    expect(await screen.findAllByText("Healthy")).not.toHaveLength(0);
    expect(screen.queryByText("LLM proxy unavailable")).not.toBeInTheDocument();
  });
});
