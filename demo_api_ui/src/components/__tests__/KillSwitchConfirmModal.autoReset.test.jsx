import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import KillSwitchConfirmModal from "../KillSwitchConfirmModal";

vi.mock("../../services/apiClient");

/**
 * A kill is time-boxed: 10 minutes later the block lifts on its own. Without a
 * countdown the audience just sees the agent come back with no explanation, so
 * the result panel has to say when it happens and what exactly comes back.
 */
describe("KillSwitchConfirmModal — auto-reset countdown", () => {
  const killResult = (extra) => ({
    scope: "instance",
    steps: [{ key: "enforcement_flag", label: "Arm the next-request block", detail: "done", ran: true, skipped: false }],
    auto_reset_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    auto_reset_in_ms: 10 * 60 * 1000,
    ...extra,
  });

  const renderAfterKill = async (result) => {
    apiClient.get.mockResolvedValueOnce({ data: { runs: [] } });
    const onConfirm = vi.fn().mockResolvedValue(result);
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
  };

  it("counts down to when the block lifts", async () => {
    await renderAfterKill(killResult());
    expect(screen.getByText(/Auto-resets in (10:00|9:5\d)/)).toBeInTheDocument();
  });

  it("says the PingOne application comes back on a full-scope kill", async () => {
    await renderAfterKill(killResult({ scope: "full" }));
    expect(screen.getByText(/PingOne application is re-enabled/i)).toBeInTheDocument();
  });

  it("says the disabled user account is NOT part of the auto-reset", async () => {
    await renderAfterKill(killResult({ scope: "full" }));
    expect(screen.getByText(/user account stays disabled/i)).toBeInTheDocument();
  });

  it("does not promise an application re-enable for an instance-scope kill", async () => {
    await renderAfterKill(killResult({ scope: "instance" }));
    expect(screen.queryByText(/PingOne application is re-enabled/i)).not.toBeInTheDocument();
  });

  it("reports the reset as done once the time has passed", async () => {
    await renderAfterKill(killResult({ auto_reset_at: new Date(Date.now() - 1000).toISOString() }));
    expect(screen.getByText(/no longer blocked/i)).toBeInTheDocument();
  });

  it("renders nothing about auto-reset when the server did not send a time", async () => {
    await renderAfterKill({
      scope: "instance",
      steps: [{ key: "enforcement_flag", label: "Arm the next-request block", detail: "done", ran: true, skipped: false }],
    });
    expect(screen.queryByText(/Auto-resets in/i)).not.toBeInTheDocument();
  });
});
