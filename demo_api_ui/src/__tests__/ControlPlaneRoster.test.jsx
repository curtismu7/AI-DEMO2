import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("../components/ControlPlaneRoster.css", () => ({}), { virtual: true });
vi.mock("../components/KillSwitchConfirmModal", () => ({ default: () => null }));
vi.mock("../services/apiClient", () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock("../hooks/useAppEventsSSE", () => ({ useAppEventsSSE: vi.fn() }));

const getAgents = vi.fn();
const stopAgent = vi.fn(() => Promise.resolve({ ok: true }));
const resetRoster = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("../services/controlPlaneApi", () => ({
  getAgents: (...a) => getAgents(...a),
  stopAgent: (...a) => stopAgent(...a),
  resetRoster: (...a) => resetRoster(...a),
}));

import ControlPlaneRoster from "../components/ControlPlaneRoster";

const ROSTER = {
  live: { id: "demo-agent", kind: "live", label: "Live Agent (Super Banking)", provider: "helix", providerLabel: "Helix only", status: "active" },
  demo: [
    { id: "chatgpt", platform: "ChatGPT", label: "ChatGPT", status: "active" },
    { id: "glean", platform: "Glean", label: "Glean", status: "active" },
  ],
};

describe("ControlPlaneRoster", () => {
  beforeEach(() => { getAgents.mockReset(); getAgents.mockResolvedValue(ROSTER); });

  // The platform label appears in BOTH the trust-panel node and the roster row,
  // so use getAllByText / scope to .cp-row.
  const rosterRow = (label) =>
    screen.getAllByText(label).map((el) => el.closest(".cp-row")).find(Boolean);

  it("renders the live row, demo platforms, and the stop-all action", async () => {
    render(<ControlPlaneRoster />);
    await waitFor(() => expect(screen.getByText(/Live Agent \(Super Banking\)/)).toBeInTheDocument());
    expect(rosterRow("ChatGPT")).toBeTruthy();
    expect(rosterRow("Glean")).toBeTruthy();
    expect(screen.getByText(/Stop across all platforms/i)).toBeInTheDocument();
    // self-explaining teaching copy is present
    expect(screen.getByText(/What this is:/i)).toBeInTheDocument();
    expect(screen.getByText(/the business value/i)).toBeInTheDocument();
  });

  it("stops a demo agent via the control-plane API", async () => {
    render(<ControlPlaneRoster />);
    await waitFor(() => expect(rosterRow("Glean")).toBeTruthy());
    fireEvent.click(rosterRow("Glean").querySelector(".cp-stop"));
    await waitFor(() => expect(stopAgent).toHaveBeenCalledWith("glean"));
  });
});
