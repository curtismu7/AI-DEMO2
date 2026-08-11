import { render, screen, waitFor } from "@testing-library/react";
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

  it("no longer claims agentRateLimit is the enforcement point", () => {
    apiClient.get.mockResolvedValueOnce({ data: { runs: [] } });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByText(/agentRateLimit/)).not.toBeInTheDocument();
  });
});
