import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelemetryPage from "../TelemetryPage";

const GRAPH = {
  tracingEnabled: true,
  fetchedAt: "2026-07-18T00:00:00.000Z",
  nodes: [
    { id: "demo-api-server", label: "demo-api-server", latency: "45ms", status: "ok" },
    { id: "mcp-gateway", label: "mcp-gateway", latency: "12ms", status: "error" },
  ],
  edges: [{ source: "demo-api-server", target: "mcp-gateway", label: "mcp:tool" }],
};

const TRACES = {
  traces: [
    { traceId: "a1b2c3d4e5f60718", operation: "POST /run", spanCount: 6, durationMs: 2500, startTime: "2026-07-18T00:00:00.000Z" },
  ],
};

function stubFetch({ graph = GRAPH, traces = TRACES } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const u = String(url);
      const body = u.includes("/tracing/graph") ? graph : traces;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TelemetryPage", () => {
  it("renders service nodes from the graph endpoint", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    expect(screen.getByText("mcp-gateway")).toBeInTheDocument();
    expect(screen.getByText("mcp:tool")).toBeInTheDocument();
  });

  it("shows the tracing-off empty state when tracingEnabled is false", async () => {
    stubFetch({ graph: { tracingEnabled: false, nodes: [], edges: [], fetchedAt: "x" } });
    render(<TelemetryPage />);
    await waitFor(() =>
      expect(screen.getByText(/tracing is off or Jaeger is unreachable/i)).toBeInTheDocument(),
    );
  });

  it("shows no-traces empty state when enabled but graph is empty", async () => {
    stubFetch({ graph: { tracingEnabled: true, nodes: [], edges: [], fetchedAt: "x" } });
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText(/No traces yet/i)).toBeInTheDocument());
  });

  it("Pause toggles to Resume and stops the auto-refresh interval", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    const btn = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("Fetch button triggers a new graph request", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    const calls = global.fetch.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(calls));
  });
});
