import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import DemoTrackAgentControl from "../DemoTrackAgentControl";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const TRACK = {
  steps: [
    { stepId: "delegated-access", act: 1, title: "Delegated access", ucIds: ["UC1"], buyerStory: "story-1",
      slots: { green: { chipText: "show my balance" }, red: { label: "replayed token" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
    { stepId: "fine-grained-authz", act: 1, title: "Fine-grained authz", ucIds: ["UC6"], buyerStory: "story-3",
      slots: { green: { chipText: "transfer $200 to savings" }, red: { chipText: "transfer $6,000 to savings" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
    { stepId: "pingone-mcp-admin", act: 2, title: "PingOne MCP admin", ucIds: ["UC-LEARN2"], buyerStory: "story-8",
      slots: { green: { chipText: "admin task" }, red: { chipText: "denied task" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
  ],
  gauntletSims: [],
};
const RUN = {
  runId: "run-1", activeStepId: "fine-grained-authz",
  slots: {
    "delegated-access:green": { verdict: "PERMIT", at: "2026-08-03T10:00:00Z" },
    "delegated-access:red": { verdict: "DENY", at: "2026-08-03T10:01:00Z" },
  },
  gauntlet: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: { track: TRACK, run: RUN } });
  apiClient.post.mockResolvedValue({ data: {} });
});

describe("DemoTrackAgentControl", () => {
  it("shows the active step position in the header button", async () => {
    render(<DemoTrackAgentControl onPickStep={() => {}} />);
    expect(await screen.findByText(/Demo Track:/)).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
  });

  it("opens the picker with act labels, done marks, and full-page link", async () => {
    render(<DemoTrackAgentControl onPickStep={() => {}} />);
    fireEvent.click(await screen.findByText(/Demo Track:/));
    expect(await screen.findByText("ACT 1 · THE CUSTOMER AGENT")).toBeInTheDocument();
    expect(screen.getByText("ACT 2 · SAME RAILS GOVERN THE ADMINS")).toBeInTheDocument();
    expect(screen.getByText("Delegated access").closest("button").textContent).toContain("✓");
    const link = screen.getByText(/Open full track page/);
    expect(link.closest("a")).toHaveAttribute("href", "/demo-track");
  });

  it("picking a step posts active-step and calls onPickStep with step and position", async () => {
    const onPickStep = vi.fn();
    render(<DemoTrackAgentControl onPickStep={onPickStep} />);
    fireEvent.click(await screen.findByText(/Demo Track:/));
    fireEvent.click(await screen.findByText("PingOne MCP admin"));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/active-step", { stepId: "pingone-mcp-admin" })
    );
    await waitFor(() => expect(onPickStep).toHaveBeenCalled());
    const arg = onPickStep.mock.calls[0][0];
    expect(arg.step.stepId).toBe("pingone-mcp-admin");
    expect(arg.index).toBe(2);
    expect(arg.total).toBe(3);
  });

  it("renders nothing until the track has loaded", () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DemoTrackAgentControl onPickStep={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("fires onStepComplete once with the next step when the picked step's slots fill", async () => {
    const onStepComplete = vi.fn();
    const completedRun = {
      ...RUN,
      slots: {
        ...RUN.slots,
        "fine-grained-authz:green": { verdict: "PERMIT", at: "2026-08-03T10:05:00Z" },
        "fine-grained-authz:red": { verdict: "DENY", at: "2026-08-03T10:06:00Z" },
      },
    };
    // First load: incomplete. After the pick's reload: completed.
    let calls = 0;
    apiClient.get.mockImplementation(() => {
      calls += 1;
      return Promise.resolve({ data: { track: TRACK, run: calls >= 2 ? completedRun : RUN } });
    });
    render(<DemoTrackAgentControl onPickStep={() => {}} onStepComplete={onStepComplete} />);
    fireEvent.click(await screen.findByText(/Demo Track:/));
    fireEvent.click(await screen.findByText("Fine-grained authz"));
    await waitFor(() => expect(onStepComplete).toHaveBeenCalledTimes(1));
    const arg = onStepComplete.mock.calls[0][0];
    expect(arg.step.stepId).toBe("fine-grained-authz");
    expect(arg.next.step.stepId).toBe("pingone-mcp-admin");
    expect(arg.next.index).toBe(2);
  });

  it("does not fire onStepComplete for a step that was never picked", async () => {
    const onStepComplete = vi.fn();
    const completedRun = {
      ...RUN,
      slots: {
        ...RUN.slots,
        "fine-grained-authz:green": { verdict: "PERMIT", at: "2026-08-03T10:05:00Z" },
        "fine-grained-authz:red": { verdict: "DENY", at: "2026-08-03T10:06:00Z" },
      },
    };
    apiClient.get.mockResolvedValue({ data: { track: TRACK, run: completedRun } });
    render(<DemoTrackAgentControl onPickStep={() => {}} onStepComplete={onStepComplete} />);
    await screen.findByText(/Demo Track:/);
    expect(onStepComplete).not.toHaveBeenCalled();
  });
});
