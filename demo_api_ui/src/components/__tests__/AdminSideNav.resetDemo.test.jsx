/**
 * "Reset Demo" swallowed any fetch failure and proceeded to clear
 * localStorage + log the admin out regardless — the admin believed the
 * reset happened when it never did.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
const performLogoutMock = vi.fn();
vi.mock("../../services/logout", () => ({ performLogout: (...a) => performLogoutMock(...a) }));
vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
const notifyErrorMock = vi.fn();
vi.mock("../../utils/appToast", () => ({ notifyError: (...a) => notifyErrorMock(...a) }));
vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));
// Real ConfirmModal usages in this file share one component for several
// different confirmations; only the one whose isOpen is true (i.e. the one
// the test just triggered) renders a clickable stand-in.
vi.mock("../ConfirmModal", () => ({
  default: ({ isOpen, title, onConfirm }) =>
    isOpen ? <button onClick={onConfirm}>{`confirm:${title}`}</button> : null,
}));

import AdminSideNav from "../AdminSideNav";

const adminUser = { id: "4", username: "admin", role: "admin" };

beforeEach(() => {
  performLogoutMock.mockClear();
  notifyErrorMock.mockClear();
  try { window.localStorage.setItem("adminSideNav.collapsed", "false"); } catch { /* jsdom always has it */ }
  localStorage.setItem("tokenChainHistory", "x");
  localStorage.setItem("api-traffic-store", "y");
});

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminSideNav user={adminUser} />
    </MemoryRouter>,
  );
}

async function triggerReset() {
  fireEvent.click(screen.getByText("Reset Demo"));
  const confirmBtn = await screen.findByText("confirm:Reset Demo");
  fireEvent.click(confirmBtn);
}

describe("AdminSideNav — Reset Demo failure handling", () => {
  it("does NOT log out or clear localStorage when the reset request fails (network error)", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    renderNav();

    await triggerReset();

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalled());
    expect(performLogoutMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBe("x");
  });

  it("does NOT log out when the server answers with a non-ok status", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    renderNav();

    await triggerReset();

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalled());
    expect(performLogoutMock).not.toHaveBeenCalled();
  });

  it("still logs out and clears localStorage when the reset succeeds", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    renderNav();

    await triggerReset();

    await waitFor(() => expect(performLogoutMock).toHaveBeenCalled());
    expect(notifyErrorMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("tokenChainHistory")).toBeNull();
  });
});
