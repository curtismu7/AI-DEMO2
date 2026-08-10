import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import DemoTrackPage from "../DemoTrackPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const STEP = (stepId, act, title, extra = {}) => ({
  stepId, act, title,
  capability: "cap", ucIds: ["UC1"],
  buyerStory: "story",
  slots: {
    green: { source: "tool", chipText: "green chip", match: { tools: ["t"] }, expected: ["PERMIT"] },
    red: { source: "tool", chipText: "red chip", match: { tools: ["t"] }, expected: ["DENY"] },
  },
  proved: { green: "green proved", red: "red proved", sayThis: "say this line" },
  ...extra,
});

const TRACK = {
  steps: [
    STEP("delegated-access", 1, "Delegated access"),
    STEP("attack-gauntlet", 1, "Attack gauntlet", {
      slots: { red: { source: "sim", label: "six attacks", match: { sims: ["s1", "s2"] }, expected: ["BLOCKED"] } },
      proved: { green: null, red: "gauntlet proved", sayThis: "attack line" },
    }),
    STEP("pingone-mcp-admin", 2, "PingOne MCP admin"),
  ],
  gauntletSims: [
    { sim: "s1", ucId: "UC5", label: "Wrong scope" },
    { sim: "s2", ucId: "UC10", label: "Cross-owner" },
  ],
};

const ACTIVE_RUN = {
  runId: "run-1", startedAt: "2026-08-03T10:00:00Z", activeStepId: "delegated-access",
  slots: { "delegated-access:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-03T10:01:00Z" } },
  gauntlet: { s1: { blocked: true, status: 403, errorCode: null, decisionId: "d-1", at: "2026-08-03T10:02:00Z" } },
};

const OLD_RUN = {
  runId: "run-0", startedAt: "2026-08-02T09:00:00Z", endedAt: "2026-08-02T10:00:00Z",
  activeStepId: "pingone-mcp-admin",
  slots: {
    "delegated-access:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-02T09:10:00Z" },
    "delegated-access:red": { verdict: "DENY", decisionId: "d-9", via: "t", at: "2026-08-02T09:11:00Z" },
  },
  gauntlet: {},
};

function mockApi() {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/demo-track") return Promise.resolve({ data: { track: TRACK, run: ACTIVE_RUN } });
    if (url === "/api/demo-track/runs") return Promise.resolve({ data: { runs: [OLD_RUN] } });
    if (url === "/api/verticals/me") return Promise.resolve({ data: { activeId: "healthcare" } });
    if (String(url).startsWith("/api/use-cases")) {
      return Promise.resolve({
        data: {
          useCases: [
            { id: "UC1", useCaseId: "delegated-access", trigger: { type: "chip", text: "show my healthcare balance" } },
          ],
        },
      });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  apiClient.post.mockImplementation((url) => {
    if (url === "/api/agent/invoke") {
      return Promise.resolve({ data: { reply: "Your balances:\n• CHECKING — $3,032.43", toolsCalled: ["get_my_accounts"] } });
    }
    if (url === "/api/demo/attack-sim/run") return Promise.resolve({ data: { status: 401, errorCode: "invalid_aud" } });
    return Promise.resolve({ data: {} });
  });
  apiClient.patch.mockResolvedValue({ data: {} });
}

describe("DemoTrackPage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it("renders acts, steps, progress dots and the filled slot from the live run", async () => {
    render(<DemoTrackPage />);
    expect(await screen.findByText("ACT 1 — THE CUSTOMER AGENT")).toBeInTheDocument();
    expect(screen.getByText("ACT 2 — SAME RAILS GOVERN THE ADMINS")).toBeInTheDocument();
    expect(screen.getByText("Delegated access")).toBeInTheDocument();
    // active step is expanded: buyer story + green verdict stamp visible
    expect(screen.getAllByText(/story/).length).toBeGreaterThan(0);
    expect(screen.getByText(/PERMIT/)).toBeInTheDocument();
    // gauntlet score 1/2 from run.gauntlet (visible when gauntlet step expanded via click)
    fireEvent.click(screen.getByText("Attack gauntlet"));
    expect(await screen.findByText(/1 \/ 2 blocked/)).toBeInTheDocument();
  });

  it("expands a step on click and shows its takeaway when both slots filled (history run)", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    // switch to the previous run via the history picker
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "run-0" } });
    fireEvent.click(screen.getByText("Delegated access"));
    await waitFor(() => expect(screen.getByText("WHAT THIS PROVED")).toBeInTheDocument());
    expect(screen.getByText("green proved")).toBeInTheDocument();
    expect(screen.getByText("red proved")).toBeInTheDocument();
    expect(screen.getByText(/say this line/)).toBeInTheDocument();
    // viewing history: mutation controls hidden
    expect(screen.queryByText("Start new run")).not.toBeInTheDocument();
  });

  it("starts a new run via POST and re-polls", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    fireEvent.click(screen.getByText("Start new run"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/runs"));
  });

  it("sets the active step when a step header is clicked on the live run", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("PingOne MCP admin");
    fireEvent.click(screen.getByText("PingOne MCP admin"));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/active-step", { stepId: "pingone-mcp-admin" })
    );
  });

  it("does not set the active step from a history snapshot", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "run-0" } });
    fireEvent.click(screen.getByText("PingOne MCP admin"));
    await waitFor(() => expect(screen.getByText("Viewing history — read-only")).toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("shows the finish summary only when every step is complete", async () => {
    const doneRun = {
      ...OLD_RUN, runId: "run-done",
      slots: {
        "delegated-access:green": OLD_RUN.slots["delegated-access:green"],
        "delegated-access:red": OLD_RUN.slots["delegated-access:red"],
        "pingone-mcp-admin:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-02T09:20:00Z" },
        "pingone-mcp-admin:red": { verdict: "DENY", decisionId: "d-8", via: "t", at: "2026-08-02T09:21:00Z" },
      },
      gauntlet: {
        s1: { blocked: true, status: 403, errorCode: null, decisionId: null, at: "2026-08-02T09:30:00Z" },
        s2: { blocked: true, status: 403, errorCode: null, decisionId: null, at: "2026-08-02T09:31:00Z" },
      },
    };
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/demo-track") return Promise.resolve({ data: { track: TRACK, run: ACTIVE_RUN } });
      if (url === "/api/demo-track/runs") return Promise.resolve({ data: { runs: [doneRun] } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    expect(screen.queryByText(/Track complete/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "run-done" } });
    await waitFor(() => expect(screen.getByText(/Track complete/)).toBeInTheDocument());
  });

  it("shows the active vertical and dispatches the catalog-resolved chip through the agent", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    await waitFor(() => expect(screen.getByText("Vertical: healthcare")).toBeInTheDocument());
    // catalog trigger text (per-vertical) replaces the config chip text
    await waitFor(() => expect(screen.getByText("show my healthcare balance")).toBeInTheDocument());
    const row = screen.getByText("show my healthcare balance").closest(".dtp-run-row");
    fireEvent.click(within(row).getByRole("button", { name: /^Run/ }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/agent/invoke", {
        prompt: "show my healthcare balance",
        forceHeuristic: true,
        vertical: "healthcare",
      })
    );
    // The run arms its own slot first — the matcher wildcard (any vertical's
    // tool) fires only for the armed slot, not for whatever step is active.
    expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/arm", { stepId: "delegated-access", color: "green" });
    // gateway runtime flag armed before dispatch (launcher contract)
    expect(apiClient.patch).toHaveBeenCalledWith("/api/admin/feature-flags", expect.objectContaining({
      updates: expect.objectContaining({ ff_mcp_gateway_pinggateway: true }),
    }));
    // a permit must not look dead: the Run button flashes a visible success ack
    await waitFor(() => expect(within(row).getByRole("button", { name: /ran/ })).toBeInTheDocument());
    // and the agent's actual reply is shown so the presenter sees WHAT happened
    await waitFor(() => expect(screen.getByText(/Your balances/)).toBeInTheDocument());
    expect(screen.getByText(/get_my_accounts/)).toBeInTheDocument();
  });

  it("runs sim-sourced red slots through the attack-sim API", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Attack gauntlet");
    fireEvent.click(screen.getByText("Attack gauntlet"));
    fireEvent.click(await screen.findByText("Run all 6 attacks"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/demo/attack-sim/run", { sim: "s1" }));
    expect(apiClient.post).toHaveBeenCalledWith("/api/demo/attack-sim/run", { sim: "s2" });
  });
});
