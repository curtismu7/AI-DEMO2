import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("../components/ControlPlaneRoster.css", () => ({}), { virtual: true });
vi.mock("../components/ControlPlaneDemoGuideModal", () => ({ default: () => null }));
vi.mock("../services/apiClient", () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock("../hooks/useAppEventsSSE", () => ({ useAppEventsSSE: vi.fn() }));

const useAuthMock = vi.fn(() => ({ user: null }));
vi.mock("../hooks/useAuth", () => ({ useAuth: (...a) => useAuthMock(...a) }));

const getAgents = vi.fn();
const comprehensiveShutdown = vi.fn(() => Promise.resolve({ ok: true, stopped: [], steps: [] }));
vi.mock("../services/controlPlaneApi", () => ({
  getAgents: (...a) => getAgents(...a),
  comprehensiveShutdown: (...a) => comprehensiveShutdown(...a),
}));

import ControlPlaneRoster from "../components/ControlPlaneRoster";

const ROSTER = {
  live: { id: "demo-agent", kind: "live", label: "Live Agent (Super Banking)", provider: "helix", providerLabel: "Helix only", source: "this-app", sourceLabel: "This App", status: "active" },
  demo: [],
};

describe("ControlPlaneRoster", () => {
  beforeEach(() => {
    getAgents.mockReset();
    getAgents.mockResolvedValue(ROSTER);
    comprehensiveShutdown.mockClear();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: null });
  });

  const rosterRow = (label) =>
    screen.getAllByText(label).map((el) => el.closest(".cp-row")).find(Boolean);

  it("renders the live row and comprehensive shutdown action; no simulated rows", async () => {
    render(<ControlPlaneRoster />);
    await waitFor(() => expect(screen.getByText(/Live Agent \(Super Banking\)/)).toBeInTheDocument());
    expect(screen.queryByText("ChatGPT")).not.toBeInTheDocument();
    expect(screen.queryByText(/Stop across all platforms/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Comprehensive shutdown/i)).toBeInTheDocument();
    // self-explaining teaching copy is present
    expect(screen.getByText(/What this is:/i)).toBeInTheDocument();
    expect(screen.getByText(/the business value/i)).toBeInTheDocument();
  });

  it("shows the admin-only Demo Guide button for an admin user", async () => {
    useAuthMock.mockReturnValue({ user: { role: "admin" } });
    render(<ControlPlaneRoster />);
    await waitFor(() => expect(screen.getByText(/Live Agent \(Super Banking\)/)).toBeInTheDocument());
    expect(screen.getByText(/Demo Guide/i)).toBeInTheDocument();
  });

  it("hides the Demo Guide button for a non-admin (customer) user", async () => {
    useAuthMock.mockReturnValue({ user: { role: "customer" } });
    render(<ControlPlaneRoster />);
    await waitFor(() => expect(screen.getByText(/Live Agent \(Super Banking\)/)).toBeInTheDocument());
    expect(screen.queryByText(/Demo Guide/i)).not.toBeInTheDocument();
  });

  // The live row's kill switch is opened via the App.js-owned shared modal
  // (openKillSwitchModal), not a locally-rendered <KillSwitchConfirmModal> —
  // that's what lets the result survive /ai-control-plane's own user-gated
  // route redirect after the kill destroys the session. See App.js and
  // REGRESSION_PLAN.md §4, 2026-08-10.
  it("opens the shared kill-switch modal (not a local one) for the live row's instance scope", async () => {
    const openKillSwitchModal = vi.fn();
    render(<ControlPlaneRoster openKillSwitchModal={openKillSwitchModal} />);
    await waitFor(() => expect(rosterRow("Live Agent (Super Banking)")).toBeTruthy());

    fireEvent.click(screen.getByText("Stop this instance"));

    expect(openKillSwitchModal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "demo-agent",
        initialScope: "instance",
        onConfirm: expect.any(Function),
        onDismiss: expect.any(Function),
      }),
    );
  });

  it("opens the shared kill-switch modal with full scope for 'Stop entire agent'", async () => {
    const openKillSwitchModal = vi.fn();
    render(<ControlPlaneRoster openKillSwitchModal={openKillSwitchModal} />);
    await waitFor(() => expect(rosterRow("Live Agent (Super Banking)")).toBeTruthy());

    fireEvent.click(screen.getByText("Stop entire agent"));

    expect(openKillSwitchModal).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "demo-agent", initialScope: "full" }),
    );
  });
});
