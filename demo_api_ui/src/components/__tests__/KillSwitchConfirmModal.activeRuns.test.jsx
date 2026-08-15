import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import KillSwitchConfirmModal from "../KillSwitchConfirmModal";

vi.mock("../../services/apiClient");

describe("KillSwitchConfirmModal — active runs", () => {
  it("shows the active run list fetched for this agentId", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { runs: [{ runId: "r1", tool: "reorder", startedAt: Date.now() - 4000 }] },
    });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/reorder/i)).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/agent/default-agent/active-runs");
  });

  it("shows a nothing-running message when the list is empty", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { runs: [] } });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/nothing currently running/i)).toBeInTheDocument();
    });
  });

  it("names runMcpToolPipeline (not evaluateMcpFirstToolGate or agentRateLimit) as the enforcement point", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { runs: [] } });
    const onConfirm = vi.fn().mockResolvedValue({
      scope: "instance",
      steps: [{ key: "enforcement_flag", label: "Arm the next-request block", detail: "done", ran: true, skipped: false }],
    });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/nothing currently running/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Confirm Stop Agent"));

    await waitFor(() => {
      expect(screen.getByText(/Enforcement point/)).toBeInTheDocument();
    });
    expect(screen.getByText(/runMcpToolPipeline/)).toBeInTheDocument();
    expect(screen.queryByText(/evaluateMcpFirstToolGate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agentRateLimit/)).not.toBeInTheDocument();
  });
});
