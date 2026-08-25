import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import apiClient from "../../services/apiClient";
import TransactionTraceEmbedPage from "../TransactionTraceEmbedPage";

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
    <MemoryRouter initialEntries={[`/transaction-trace/embed/${correlationId}`]}>
      <Routes>
        <Route path="/transaction-trace/embed/:correlationId" element={<TransactionTraceEmbedPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
