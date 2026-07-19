import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelemetryPage from "../TelemetryPage";
import { getMyAccounts } from "../../services/demoAgentService";

vi.mock("../../components/TraceGraphCore", () => ({
  default: ({ rawUrl, refreshKey }) => (
    <div data-testid="graph-core" data-refresh-key={refreshKey}>{rawUrl}</div>
  ),
}));

vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TelemetryPage />
    </MemoryRouter>,
  );
}

const TRACES = {
  traces: [
    { traceId: "a1b2c3d4e5f60718", operation: "POST /run", spanCount: 6, durationMs: 2500, startTime: "2026-07-19T00:00:00.000Z" },
    { traceId: "9988776655443322", operation: "GET /api/token-chain", spanCount: 29, durationMs: 26, startTime: "2026-07-19T00:01:00.000Z" },
  ],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(TRACES) })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TelemetryPage", () => {
  it("defaults to Overview mode, rendering TraceGraphCore with the overview URL", async () => {
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("graph-core")).toBeInTheDocument());
    expect(screen.getByTestId("graph-core").textContent).toBe(
      "/api/health/tracing/overview/raw?lookback=1h",
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("changing the window filter updates the overview URL", async () => {
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("graph-core")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole("combobox"), "Last 6 hours");
    await waitFor(() =>
      expect(screen.getByTestId("graph-core").textContent).toBe(
        "/api/health/tracing/overview/raw?lookback=6h",
      ),
    );
  });

  it("Detailed mode shows a trace picker instead of the window filter", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    await waitFor(() => expect(screen.getByText(/POST \/run/)).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: /window/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-core")).not.toBeInTheDocument(); // no trace picked yet
    expect(screen.getByText("Pick a trace above.")).toBeInTheDocument();
  });

  it("selecting a trace in Detailed mode renders TraceGraphCore with that trace's raw URL", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    await waitFor(() => expect(screen.getByText(/POST \/run/)).toBeInTheDocument());
    const select = screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT");
    await userEvent.selectOptions(select, "a1b2c3d4e5f60718");
    await waitFor(() =>
      expect(screen.getByTestId("graph-core").textContent).toBe(
        "/api/health/tracing/traces/a1b2c3d4e5f60718/raw",
      ),
    );
  });

  it("auto-refreshes the trace list only while in Overview mode", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch();
    renderPage();
    const initialCalls = global.fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCalls);

    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    const callsAfterSwitch = global.fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(global.fetch.mock.calls.length).toBe(callsAfterSwitch); // no more polling once in Detailed
    vi.useRealTimers();
  });

  it("Overview's graph refreshKey bumps on the 5s auto-refresh and on manual Refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("graph-core")).toBeInTheDocument());
    expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "0");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "1");

    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "2"),
    );
  });

  it("Generate demo traffic calls getMyAccounts and bumps the graph refresh key on success", async () => {
    stubFetch();
    getMyAccounts.mockResolvedValueOnce({ result: { accounts: [] }, tokenEvents: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "0"));

    await userEvent.click(screen.getByRole("button", { name: "Generate demo traffic" }));

    expect(getMyAccounts).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "1"),
    );
  });

  it("Generate demo traffic shows an error message and does not bump refresh key on failure", async () => {
    stubFetch();
    getMyAccounts.mockRejectedValueOnce(new Error("HTTP 401"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "0"));

    await userEvent.click(screen.getByRole("button", { name: "Generate demo traffic" }));

    await waitFor(() => expect(screen.getByText("HTTP 401")).toBeInTheDocument());
    expect(screen.getByTestId("graph-core")).toHaveAttribute("data-refresh-key", "0");
  });

  it("Back button navigates to the previous page", async () => {
    stubFetch();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
