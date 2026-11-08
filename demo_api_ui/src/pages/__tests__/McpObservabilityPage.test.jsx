import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import McpObservabilityPage, { buildObservabilitySummary, buildToolHealth, toolStatus } from "../McpObservabilityPage";
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

function beforeEachMock() {
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
}

beforeEach(beforeEachMock);

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

  it("puts the live-data banner first and carries exactly one primary button", async () => {
    const { container } = render(<McpObservabilityPage />);
    await screen.findAllByText("transfer_funds");

    const banner = screen.getByTestId("mcp-obs-banner");
    expect(banner.getAttribute("role")).toBe("note");
    expect(banner.textContent).toMatch(/LIVE DATA/);
    expect(banner.textContent).toMatch(/calls nothing/);
    // The banner is the first thing in the page, above the title band.
    expect(container.querySelector(".pu-page").firstElementChild.contains(banner)).toBe(true);
    // The page owns exactly one primary: Refresh. (The diagram's Simulate is the shared DiagramStepBar's.)
    const primaries = [...container.querySelectorAll(".pu-btn--primary")];
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe("Refresh");
  });

  it("gives every outcome a word and makes each request a real button with a state", async () => {
    render(<McpObservabilityPage />);
    await screen.findAllByText("transfer_funds");

    const rows = screen.getAllByRole("button", { name: /(transfer_funds|approve_transfer)/ });
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Success")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Denied")).toBeInTheDocument();
    // The first request is opened by default; choosing the other moves aria-current.
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    fireEvent.click(rows[1]);
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(rows[0].getAttribute("aria-current")).toBeNull();
    // The chart is a described image, not bars alone.
    expect(screen.getByRole("img", { name: /1 success, 0 failure, 1 denied/ })).toBeInTheDocument();
  });

  it("keeps Refresh mounted and says what it did, without moving focus", async () => {
    render(<McpObservabilityPage />);
    await screen.findAllByText("transfer_funds");

    const refresh = screen.getByRole("button", { name: "Refresh" });
    refresh.focus();
    fireEvent.click(refresh);
    expect(await screen.findByText(/Refreshed at .*: 2 audit events loaded\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBe(refresh);
    expect(document.activeElement).toBe(refresh);
  });

  it("says so when the audit read fails, and never shows a live chip", async () => {
    apiClient.get.mockImplementation((url) => (url.startsWith("/api/mcp/audit?limit") ? Promise.reject(new Error("down")) : Promise.resolve({ data: {} })));
    render(<McpObservabilityPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/MCP audit data is unavailable/);
    expect(screen.getByText("Audit unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/^Live ·/)).toBeNull();
    expect(screen.getByText("No MCP requests yet.")).toBeInTheDocument();
  });

  it("draws where the data comes from in the Ping style with Simulate and Reset", async () => {
    render(<McpObservabilityPage />);

    const flow = await screen.findByRole("region", { name: "Where this page's data comes from" });
    expect(flow.classList.contains("efd--ping")).toBe(true);
    expect(flow.querySelector(".sfd--ping")).toBeTruthy();
    expect(within(flow).getByRole("button", { name: "Simulate" })).toBeInTheDocument();
    expect(within(flow).getByRole("button", { name: /Reset$/ })).toBeInTheDocument();
  });

  it("never shows a tool that fails every call as Healthy (status is derived from errors, not denials alone)", async () => {
    const failing = [
      { eventId: "f1", operation: "flaky_tool", outcome: "failure", duration: 10, timestamp: "2026-09-18T14:30:00.000Z", details: {} },
      { eventId: "f2", operation: "flaky_tool", outcome: "failure", duration: 12, timestamp: "2026-09-18T14:30:01.000Z", details: {} },
    ];
    const [tool] = buildToolHealth(failing);
    expect(tool).toMatchObject({ calls: 2, failures: 2, denials: 0 });
    expect(tool.errorRate).toBe(100);
    expect(toolStatus(tool)).toEqual({ tone: "danger", word: "Failing" });

    apiClient.get.mockImplementation((url) => (url === "/api/mcp/audit?limit=100" ? Promise.resolve({ data: failing }) : Promise.resolve({ data: {} })));
    render(<McpObservabilityPage />);
    const table = await screen.findByTestId("mcp-obs-tools");
    const row = within(table).getByText("flaky_tool").closest("tr");
    expect(within(row).getByText("100.0%")).toBeInTheDocument();
    expect(within(row).getByText("Failing")).toBeInTheDocument();
    expect(within(row).queryByText("Healthy")).toBeNull();
  });

  it("grades tool status: Healthy only with no errors and no denials, Errors below half, Denials for denials", () => {
    expect(toolStatus({ calls: 4, failures: 0, denials: 0 })).toEqual({ tone: "ok", word: "Healthy" });
    expect(toolStatus({ calls: 4, failures: 1, denials: 0 })).toEqual({ tone: "warn", word: "Errors" });
    expect(toolStatus({ calls: 4, failures: 2, denials: 0 })).toEqual({ tone: "danger", word: "Failing" });
    expect(toolStatus({ calls: 2, failures: 2, denials: 2 })).toEqual({ tone: "warn", word: "Denials" });
    expect(toolStatus({ calls: 3, failures: 2, denials: 1 })).toEqual({ tone: "warn", word: "Errors" });
  });

  it("says no traffic was seen when the audit store is reachable but empty, and not when there are events", async () => {
    apiClient.get.mockImplementation((url) => (url === "/api/mcp/audit?limit=100" ? Promise.resolve({ data: [] }) : Promise.resolve({ data: {} })));
    const { unmount } = render(<McpObservabilityPage />);
    const note = await screen.findByTestId("mcp-obs-empty");
    expect(note.textContent).toMatch(/No MCP traffic seen yet/);
    expect(screen.getByText(/^Live ·/)).toBeInTheDocument();
    unmount();

    beforeEachMock();
    render(<McpObservabilityPage />);
    await screen.findAllByText("transfer_funds");
    expect(screen.queryByTestId("mcp-obs-empty")).toBeNull();
  });

  it("keeps the shared diagram toolbar under the .pu-page root so the demoted-secondary rule applies", async () => {
    const { container } = render(<McpObservabilityPage />);
    await screen.findByRole("region", { name: "Where this page's data comes from" });
    const root = container.querySelector(".pu-page");
    expect(root).toBeTruthy();
    const simulate = root.querySelector(".dc-toolbar .dc-ctrl-btn");
    expect(simulate).toBeTruthy();
  });
});
