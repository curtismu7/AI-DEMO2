/**
 * Both the vertical-picker load and the switch-vertical POST swallowed any
 * failure with a bare `.catch(() => {})` / `catch {}` — no logging, no
 * signal that anything went wrong. An empty list read as "no verticals"; a
 * failed switch just cleared the spinner as if nothing happened.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: false, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
const refetchVerticalMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ activeId: "banking", refetch: (...a) => refetchVerticalMock(...a) }),
}));
vi.mock("../../services/demoScenarioService", () => ({ persistAgentUi: vi.fn() }));
vi.mock("../../services/logout", () => ({ performLogout: vi.fn() }));
vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
vi.mock("../../utils/appToast", () => ({ notifyError: vi.fn() }));
vi.mock("../ConfirmModal", () => ({ default: () => null }));
vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));

import AdminSideNav from "../AdminSideNav";

const adminUser = { id: "4", username: "admin", role: "admin" };
const VERTICALS = [
  { id: "banking", displayName: "Super Banking" },
  { id: "retail", displayName: "Great Buy" },
];
let consoleErrorSpy;

beforeEach(() => {
  try { window.localStorage.setItem("adminSideNav.collapsed", "false"); } catch { /* jsdom always has it */ }
  // Expanded-section state persists across renders via sessionStorage keyed
  // per user/role — clear it so each test starts with the picker collapsed.
  try { window.sessionStorage.removeItem("adminSideNav.expandedSections.admin"); } catch { /* jsdom always has it */ }
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function renderNav() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <AdminSideNav user={adminUser} />
    </MemoryRouter>,
  );
}

function expandVerticalPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^Vertical/ }));
}

describe("AdminSideNav — vertical-picker / switch-vertical failure handling", () => {
  it("logs when the vertical list fails to load instead of silently showing empty", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    renderNav();

    expandVerticalPicker();

    await waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Sidebar] Vertical list load failed:",
        "network down",
      ),
    );
  });

  it("logs when switching vertical fails", async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/verticals/list")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(VERTICALS) });
      }
      if (String(url).includes("/api/verticals/active")) {
        return Promise.reject(new Error("switch failed"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    renderNav();

    expandVerticalPicker();
    const targetBtn = await screen.findByRole("button", { name: /Great Buy/i });
    fireEvent.click(targetBtn);

    await waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Sidebar] Switch vertical failed:",
        "switch failed",
      ),
    );
    // Spinner clears — button usable again, not stuck disabled.
    await waitFor(() => expect(targetBtn).not.toBeDisabled());
  });
});
