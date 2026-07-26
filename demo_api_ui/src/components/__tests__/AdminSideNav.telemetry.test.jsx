import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// AdminSideNav pulls in several contexts/services; mock them to their minimal
// used shape so we can render the nav in isolation. Same convention as
// adminSideNav.test.jsx in this directory.
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: false, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ activeId: "banking" }),
}));
vi.mock("../../services/demoScenarioService", () => ({ persistAgentUi: vi.fn() }));
vi.mock("../../services/logout", () => ({ performLogout: vi.fn() }));
vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
vi.mock("../ConfirmModal", () => ({ default: () => null }));
vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));

import AdminSideNav from "../AdminSideNav";

// jsdom has no matchMedia; AdminSideNav's responsive-collapse effect calls it
// unconditionally on mount, so any full render needs this stub. This same gap
// pre-exists in adminSideNav.test.jsx in this directory.
window.matchMedia =
  window.matchMedia ||
  (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSideNav user={{ id: "4", username: "demoAdmin", role: "admin" }} />
    </MemoryRouter>,
  );
}

describe("AdminSideNav Telemetry group", () => {
  it("lists Transaction Trace beside Tracing and Health Check", async () => {
    renderAt("/transaction-trace");
    expect(await screen.findByText("Transaction Trace")).toBeInTheDocument();
    expect(screen.getByText("Tracing")).toBeInTheDocument();
    expect(screen.getByText("Health Check")).toBeInTheDocument();
  });

  it("links Transaction Trace to /transaction-trace, not /transactions", async () => {
    renderAt("/transaction-trace");
    const link = (await screen.findByText("Transaction Trace")).closest("a");
    expect(link.getAttribute("href")).toBe("/transaction-trace");
  });

  it("auto-expands Telemetry when the route is /transaction-trace", async () => {
    renderAt("/transaction-trace");
    expect(await screen.findByText("Transaction Trace")).toBeVisible();
  });
});
