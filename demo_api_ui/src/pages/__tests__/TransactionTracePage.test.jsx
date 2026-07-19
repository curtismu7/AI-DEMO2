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

const HOPS_5 = [
  { seq: 1, ts: "2026-07-18T14:19:44.000Z", service: "svc-1", phase: "ui.request", op: "op-1", source: "emit" },
  { seq: 2, ts: "2026-07-18T14:19:44.100Z", service: "svc-2", phase: "authz.decision", op: "op-2", source: "emit" },
  { seq: 3, ts: "2026-07-18T14:19:44.200Z", service: "svc-3", phase: "mcp.tool", op: "op-3", source: "emit" },
  { seq: 4, ts: "2026-07-18T14:19:44.300Z", service: "svc-4", phase: "mcp.tool", op: "op-4", source: "emit" },
  { seq: 5, ts: "2026-07-18T14:19:44.400Z", service: "svc-5", phase: "mcp.tool", op: "op-5", source: "emit" },
];

function detailWithViolations(violations) {
  return {
    correlationId: "c-fail",
    traceId: "abcd1234abcd1234abcd1234abcd1234",
    startedAt: "2026-07-18T14:19:44.000Z",
    endedAt: "2026-07-18T14:19:45.000Z",
    hops: HOPS_5,
    verdict: { status: violations.length ? "FAIL" : "PASS", violations },
    reconciliation: { status: "MATCH", diffs: [], sources: {} },
  };
}

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

  it("shows a retry control in the row when the detail fetch fails, and retry recovers it", async () => {
    let detailCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/c-fail")) {
        detailCalls += 1;
        return detailCalls === 1 ? jsonFail(500) : jsonOk(DETAIL_FAIL);
      }
      return jsonOk(LIST);
    }));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByTestId("detail-error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /c-fail/ })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("authz-server")).toBeInTheDocument());
    expect(screen.queryByTestId("detail-error")).not.toBeInTheDocument();
  });

  it("severs the spine from the earliest violated hop onward, leaving earlier hops intact", async () => {
    const detail = detailWithViolations([
      { id: "INV-1", severity: "error", hopSeq: 3, detail: "bad state" },
    ]);
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByTestId("hop-3")).toBeInTheDocument());
    expect(screen.getByTestId("hop-1").className).not.toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-2").className).not.toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-3").className).toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-4").className).toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-5").className).toContain("ttrace-hop--severed");
  });

  it("severs from the earliest of multiple violations, not the last one seen", async () => {
    const detail = detailWithViolations([
      { id: "INV-2", severity: "error", hopSeq: 4, detail: "later violation" },
      { id: "INV-1", severity: "error", hopSeq: 2, detail: "earlier violation" },
    ]);
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByTestId("hop-2")).toBeInTheDocument());
    expect(screen.getByTestId("hop-1").className).not.toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-2").className).toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-3").className).toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-4").className).toContain("ttrace-hop--severed");
    expect(screen.getByTestId("hop-5").className).toContain("ttrace-hop--severed");
  });

  it("severs no hops when there are no violations", async () => {
    const detail = detailWithViolations([]);
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByTestId("hop-1")).toBeInTheDocument());
    for (const seq of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`hop-${seq}`).className).not.toContain("ttrace-hop--severed");
    }
  });

  it("renders INCOMPLETE as its own badge, distinct from a failure", async () => {
    const detail = { ...DETAIL_FAIL, verdict: { status: "INCOMPLETE", violations: [] } };
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const badge = screen.getByText(/INCOMPLETE/);
      expect(badge.className).toContain("incomplete");
      expect(badge.className).not.toContain("fail");
    });
    expect(screen.queryByText(/❌ FAIL/)).not.toBeInTheDocument();
  });

  it("renders MISMATCH with the mismatch treatment", async () => {
    const detail = { ...DETAIL_FAIL, reconciliation: { status: "MISMATCH", diffs: [], sources: {} } };
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => {
      const pill = screen.getByTestId("reconciliation-pill");
      expect(pill.className).toContain("mismatch");
      expect(pill.className).not.toContain("unknown");
      expect(pill).toHaveTextContent(/does not match second witness/i);
    });
  });

  it("still renders a violation with a null hopSeq instead of dropping it", async () => {
    const detail = {
      ...DETAIL_FAIL,
      verdict: {
        status: "FAIL",
        violations: [{ id: "INV-9", severity: "error", hopSeq: null, detail: "unanchored evidence gap" }],
      },
    };
    vi.stubGlobal("fetch", vi.fn((url) =>
      String(url).includes("/c-fail") ? jsonOk(detail) : jsonOk(LIST)));
    render(<TransactionTracePage />);
    await waitFor(() => expect(screen.getByText("c-fail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /c-fail/ }));

    await waitFor(() => expect(screen.getByText(/INV-9/)).toBeInTheDocument());
    expect(screen.getByText(/unanchored evidence gap/)).toBeInTheDocument();
  });
});
