import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import apiClient from "../../services/apiClient";
import { ThemeProvider } from "../../context/ThemeContext";
import TransactionTraceEmbedPage, { facadeHopsToSequenceSteps } from "../TransactionTraceEmbedPage";

vi.mock("../../services/apiClient", () => ({ default: { get: vi.fn() } }));

const RECORD = {
  correlationId: "cid-1",
  startedAt: "2026-08-24T22:00:00.000Z",
  endedAt: "2026-08-24T22:00:01.000Z",
  hops: [
    { seq: 1, phase: "mcp.step", service: "mcp-facade", op: "initialize", status: "ok", durationMs: 9, details: { httpStatus: 200, client: { name: "LM Studio" } } },
    {
      seq: 2, phase: "ui.request", service: "mcp-facade", op: "tools/call get_my_accounts",
      identity: { sub: "user-1", scopes: ["read"], act: [] },
      details: {
        doorLabel: "Agent Gateway",
        client: { name: "LM Studio" },
        server: { name: "Demo MCP Gateway" },
        capabilities: { tools: {} },
        tools: [{ name: "get_my_accounts", description: "List my accounts" }],
        resources: null,
        arguments: { limit: 4 },
      },
    },
    { seq: 3, phase: "gateway.authorize", service: "mcp-gateway", op: "get_my_accounts", decision: { outcome: "permit", by: "gateway" } },
    { seq: 4, phase: "mcp.tool", service: "mcp-facade", op: "get_my_accounts", status: "ok", durationMs: 42, details: { httpStatus: 200, result: { content: [{ type: "text", text: "{\"success\":true}" }] } } },
    { seq: 5, phase: "response", service: "mcp-facade", op: "tools/call", status: "ok", details: { reelUrl: "x" } },
  ],
};

function renderAt(correlationId) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/transaction-trace/embed/${correlationId}`]}>
        <Routes>
          <Route path="/transaction-trace/embed/:correlationId" element={<TransactionTraceEmbedPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem("ttrace_embed_font_size");
  localStorage.removeItem("ttrace_embed_view");
  localStorage.removeItem("ttrace_embed_sequence_zoom");
  localStorage.removeItem("ba_dark_mode");
});

describe("TransactionTraceEmbedPage", () => {
  it("shows a waiting state while the first hop has not landed", async () => {
    apiClient.get.mockResolvedValue({ status: 404, data: { error: "not_found" } });
    renderAt("cid-1");
    await waitFor(() => expect(screen.getByTestId("embed-waiting")).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledWith(
      "/api/transaction-trace/embed/cid-1",
      expect.objectContaining({ _silent: true }),
    );
  });

  it("renders the hops plus the MCP catalog, request and response once the record exists", async () => {
    apiClient.get.mockResolvedValue({ status: 200, data: RECORD });
    renderAt("cid-1");
    await waitFor(() => expect(screen.getByTestId("hop-5")).toBeInTheDocument());
    expect(screen.getByText(/Agent Gateway · tools\/call get_my_accounts · client: LM Studio/)).toBeInTheDocument();
    // hop cards reuse the trace page's component
    expect(screen.getByText("✓ PERMIT")).toBeInTheDocument();
    // MCP panels
    const mcp = screen.getByTestId("embed-mcp");
    expect(mcp).toHaveTextContent("Tools (1)");
    expect(mcp).toHaveTextContent("get_my_accounts — List my accounts");
    expect(mcp).toHaveTextContent("Resources — not advertised by this server");
    expect(mcp).toHaveTextContent("This MCP server did not advertise the resources capability");
    expect(mcp).toHaveTextContent('"door": "Agent Gateway"');
    expect(mcp).toHaveTextContent('"tool": "get_my_accounts"');
    expect(mcp).toHaveTextContent('"limit": 4');
    expect(mcp).toHaveTextContent("✓ HTTP 200 · 42ms");
    expect(mcp).toHaveTextContent('{\\"success\\":true}');
    // first render is one fetch; the 2 s re-poll has not fired yet
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("explains when the ledger feature is off", async () => {
    apiClient.get.mockResolvedValue({ status: 403, data: { error: "feature_disabled" } });
    renderAt("cid-1");
    await waitFor(() => expect(screen.getByText(/ff_transaction_ledger/)).toBeInTheDocument());
  });

  it("defaults to large text and persists font-size controls", async () => {
    apiClient.get.mockResolvedValue({ status: 200, data: RECORD });
    renderAt("cid-1");
    const page = await screen.findByTestId("ttrace-embed");
    expect(page).toHaveClass("ttrace-page--font-large");

    fireEvent.click(screen.getByRole("button", { name: "Extra large font size" }));
    expect(page).toHaveClass("ttrace-page--font-xlarge");
    expect(localStorage.getItem("ttrace_embed_font_size")).toBe("xlarge");
  });

  it("offers the app light and dark mode toggle", async () => {
    apiClient.get.mockResolvedValue({ status: 200, data: RECORD });
    renderAt("cid-1");
    const toggle = await screen.findByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("switches from the movie reel to a complete facade sequence diagram", async () => {
    apiClient.get.mockResolvedValue({ status: 200, data: RECORD });
    renderAt("cid-1");
    await screen.findByTestId("hop-5");
    expect(screen.getByRole("button", { name: "Movie reel" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Sequence" }));
    expect(screen.getByTestId("facade-sequence")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sequence diagram of this facade trace" })).toBeInTheDocument();
    expect(screen.queryByTestId("hop-5")).not.toBeInTheDocument();
    expect(localStorage.getItem("ttrace_embed_view")).toBe("sequence");
  });

  it("maps facade hops to the same lifeline vocabulary as the dashboard sequence", () => {
    expect(facadeHopsToSequenceSteps(RECORD.hops)).toEqual([
      expect.objectContaining({ lane: "MCP", title: "initialize" }),
      expect.objectContaining({ lane: "CHAT", title: "tools/call get_my_accounts" }),
      expect.objectContaining({ lane: "AUTHZ", title: "PingOne Authorize — PERMIT" }),
      expect.objectContaining({ lane: "MCP", title: "get_my_accounts" }),
      expect.objectContaining({ lane: "CHAT", title: "tools/call" }),
    ]);
  });
});
