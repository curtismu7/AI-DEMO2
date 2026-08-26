import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GatewayMcpMetrics from "./GatewayMcpMetrics";

const payload = (over = {}) => ({
  available: true,
  source: "http://ping-gateway:8085",
  methods: [
    { method: "tools/call", tool: "get_my_accounts", route: "00-mcp-external-door", count: 3, meanSeconds: 0.326 },
    { method: "initialize", tool: null, route: "00-mcp-external-door", count: 2, meanSeconds: 1.482 },
  ],
  errors: [{ code: "-32600", method: null, route: "00-mcp-external-door", count: 7 }],
  ...over,
});

const mockFetch = (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GatewayMcpMetrics", () => {
  it("renders the gateway's method and error counters", async () => {
    mockFetch(payload());
    render(<GatewayMcpMetrics />);

    expect(await screen.findByText("PingGateway MCP counters")).toBeInTheDocument();
    expect(screen.getByText("get_my_accounts")).toBeInTheDocument();
    expect(screen.getByText("-32600")).toBeInTheDocument();
    // 5 calls across both methods, 7 errors — the summary line the user sees collapsed.
    expect(screen.getByText(/5 calls · 7 errors/)).toBeInTheDocument();
  });

  it("formats sub-second means in milliseconds", async () => {
    mockFetch(payload());
    render(<GatewayMcpMetrics />);
    expect(await screen.findByText("326 ms")).toBeInTheDocument();
    expect(screen.getByText("1.48 s")).toBeInTheDocument();
  });

  it("renders nothing when PingGateway is absent", async () => {
    mockFetch({ available: false, reason: "unreachable", methods: [], errors: [] });
    const { container } = render(<GatewayMcpMetrics />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the gateway is up but has served no MCP traffic", async () => {
    mockFetch(payload({ methods: [], errors: [] }));
    const { container } = render(<GatewayMcpMetrics />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent when the endpoint fails rather than surfacing an error box", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { container } = render(<GatewayMcpMetrics />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
