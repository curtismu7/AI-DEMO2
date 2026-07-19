import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionTracePage from "../TransactionTracePage";

function jsonOk(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function jsonFail(status, body = {}) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

const LIST = {
  transactions: [
    { correlationId: "c-fail", startedAt: "2026-07-18T14:19:44.000Z", endedAt: "2026-07-18T14:19:45.000Z", hopCount: 4 },
    { correlationId: "c-pass", startedAt: "2026-07-18T14:22:07.000Z", endedAt: "2026-07-18T14:22:08.000Z", hopCount: 6 },
  ],
};

const DETAIL_FAIL = {
  correlationId: "c-fail",
  traceId: "abcd1234abcd1234abcd1234abcd1234",
  startedAt: "2026-07-18T14:19:44.000Z",
  endedAt: "2026-07-18T14:19:45.000Z",
  hops: [
    { seq: 1, ts: "2026-07-18T14:19:44.000Z", service: "demo-api-server", phase: "ui.request", op: "POST /message", identity: { sub: "demoUser" }, source: "emit" },
    { seq: 2, ts: "2026-07-18T14:19:44.100Z", service: "authz-server", phase: "authz.decision", op: "create_withdrawal", decision: { outcome: "deny", by: "mock", reason: "Amount > 2000" }, source: "emit" },
    { seq: 3, ts: "2026-07-18T14:19:44.300Z", service: "mcp-server", phase: "mcp.tool", op: "create_withdrawal", source: "emit" },
  ],
  verdict: {
    status: "FAIL",
    violations: [{ id: "INV-6", severity: "error", hopSeq: 3, detail: '"create_withdrawal" executed after a deny at hop 2 (Amount > 2000)' }],
  },
  reconciliation: { status: "MATCH", diffs: [], sources: {} },
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("TransactionTracePage", () => {
  it("lists transactions newest-first with their hop counts", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    expect(screen.getByText("c-pass")).toBeInTheDocument();
    expect(screen.getByText("6 hops")).toBeInTheDocument();
  });

  it("expands a row into a hop chain with the verdict badge", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByText("authz-server")).toBeInTheDocument());
    expect(screen.getByText("mcp-server")).toBeInTheDocument();
    expect(screen.getByText(/❌ FAIL/)).toBeInTheDocument();
  });

  it("renders a violation band anchored at the offending hop", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByText(/INV-6/)).toBeInTheDocument());
    const band = screen.getByTestId("violation-3");
    expect(band).toHaveTextContent("INV-6");
    expect(band).toHaveTextContent("executed after a deny");
  });

  it("shows a Jaeger deep link built from the traceId", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(DETAIL_FAIL) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const link = screen.getByRole("link", { name: "Jaeger" });
      expect(link.getAttribute("href")).toContain("abcd1234abcd1234abcd1234abcd1234");
    });
  });

  it("renders SOURCE_UNAVAILABLE as unknown, visually distinct from a mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail")
        ? jsonOk({ ...DETAIL_FAIL, reconciliation: { status: "SOURCE_UNAVAILABLE", diffs: [], sources: {} } })
        : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const pill = screen.getByTestId("reconciliation-pill");
      expect(pill).toHaveTextContent(/not corroborated/i);
      expect(pill.className).toContain("unknown");
      expect(pill.className).not.toContain("mismatch");
    });
  });

  it("reports the disabled feature instead of an empty list on 403", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonFail(403, { error: "feature_disabled" })));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText(/Transaction Chain of Custody is off/i)).toBeInTheDocument());
  });

  it("shows an empty-state explainer when no transactions have been recorded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonOk({ transactions: [] })));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText(/No transactions recorded yet/i)).toBeInTheDocument());
  });
});
