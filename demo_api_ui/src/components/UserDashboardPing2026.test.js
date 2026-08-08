/**
 * UserDashboardPing2026.test.js — Smoke-test for the full customer dashboard.
 *
 * The component is a ~3000-line customer-dashboard implementation that uses
 * Router, several React contexts, and makes network calls on mount.  We mock
 * every external seam so the render is hermetic, then assert the one durable
 * structural fact: the top-level wrapper carries the `customer-skin-p1` class.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UserDashboardPing2026 from "./UserDashboardPing2026";
import apiClient from "../services/apiClient";
import { getCachedJson } from "../services/cachedStatusService";
import { notifyError } from "../utils/appToast";

// ── Context hooks ────────────────────────────────────────────────────────────

vi.mock("../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: "none",
    setSurfaceHostEl: vi.fn(),
    // The dashboard registers a toolbar host too; omitting this makes every
    // case in this file die on "setToolbarHostEl is not a function".
    setToolbarHostEl: vi.fn(),
  }),
}));

vi.mock("../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    registerTokenModalOpener: vi.fn(() => vi.fn()),
    sessionToken: null,
    sessionTokenExpiry: null,
  }),
}));

vi.mock("../hooks/useCurrentUserTokenEvent", () => ({
  useCurrentUserTokenEvent: () => {},
}));

// ── Network ──────────────────────────────────────────────────────────────────

vi.mock("../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    create: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({ data: [] }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

// Stub out fetch so feature-flag useEffects don't throw
global.fetch = vi.fn().mockResolvedValue({
  ok: false,
  json: () => Promise.resolve(null),
});

// ── Service layer ────────────────────────────────────────────────────────────

vi.mock("../services/cachedStatusService", () => ({
  getCachedJson: vi.fn().mockResolvedValue(null),
}));

// ── Utility / toast ──────────────────────────────────────────────────────────

vi.mock("../utils/appToast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn(), dismiss: vi.fn() },
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../utils/authUi", () => ({
  navigateToCustomerOAuthLogin: vi.fn(),
  SESSION_REAUTH_EVENT: "session-reauth",
}));

vi.mock("../utils/dashboardLayout", () => ({
  getDashboardLayout: vi.fn(() => "split2"),
  setDashboardLayout: vi.fn(),
  splitGridClass: vi.fn(() => "split-grid-2"),
}));

vi.mock("../utils/dashboardToast", () => ({
  toastCustomerError: vi.fn(),
}));

// ── CSS imports ──────────────────────────────────────────────────────────────

vi.mock("./UserDashboard.css", () => ({}), { virtual: true });
vi.mock("./customerSkinPing2026.css", () => ({}), { virtual: true });

// ── Heavy child components → lightweight stubs ───────────────────────────────

vi.mock("./ExchangeModeToggle", () => ({ default: () => null }));
vi.mock("./Fido2Challenge", () => ({ default: () => null }));
vi.mock("./TokenChainTraceRail", () => ({ default: () => null }));
vi.mock("./ConfirmModal", () => ({ default: () => null }));
vi.mock("./TransactionConsentModal", () => ({ default: () => null }));
vi.mock("./EmbeddedAgentDock", () => ({ default: () => null }));
vi.mock("./WebMcpPanel", () => ({ default: () => null }));
vi.mock("./FloatingPanel", () => ({ default: () => null }));
vi.mock("./OAuthTokenDisplayPage", () => ({ default: () => null }));
vi.mock("./RetailDashboard", () => ({ default: () => null }));
vi.mock("./agent-clinical/AgentClinicalHost", () => ({ default: () => null }));
vi.mock("./AgentIdentityCard", () => ({ default: () => null }));
vi.mock("./StaleSessionBanner", () => ({ default: () => null }));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockUser = {
  id: "test-user",
  email: "test@example.com",
  given_name: "Test",
  family_name: "User",
  role: "customer",
};

function renderDashboard(user = mockUser) {
  return render(
    <MemoryRouter>
      <UserDashboardPing2026 user={user} onLogout={vi.fn()} />
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UserDashboardPing2026", () => {
  it("renders the customer-skin-p1 wrapper div", async () => {
    const { container } = renderDashboard();

    // loading=true on mount shows spinner; wait for fetchUserData to complete
    await waitFor(() => {
      const wrapperDiv = container.querySelector(".customer-skin-p1");
      expect(wrapperDiv).not.toBeNull();
      expect(wrapperDiv.className).toContain("customer-skin-p1");
    });
  });

  it("does not crash when user prop is null", () => {
    expect(() => renderDashboard(null)).not.toThrow();
  });

  it("shows the policy_not_found friendly message (not a generic failure) when the real Authorize engine returns 503", async () => {
    const accounts = [
      { id: "acc-1", accountType: "checking", accountNumber: "1111", balance: 500 },
      { id: "acc-2", accountType: "savings", accountNumber: "2222", balance: 900 },
    ];

    vi.mocked(getCachedJson).mockImplementation(async (url) => {
      if (url === "/api/auth/oauth/user/status") {
        return { data: { authenticated: true, user: mockUser } };
      }
      return { data: { authenticated: false } };
    });

    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === "/api/accounts/my") return { data: { accounts } };
      if (url === "/api/transactions/my") return { data: { transactions: [] } };
      return { data: [] };
    });

    vi.mocked(apiClient.post).mockRejectedValue({
      response: {
        status: 503,
        data: {
          error: "policy_not_found",
          error_description:
            "Policy not found — this action has no matching authorization policy. Please contact your administrator.",
        },
      },
    });

    renderDashboard();

    // Wait for the real (non-demo) accounts to load, then select the first one to transfer from.
    const transferButtons = await screen.findAllByRole("button", { name: "Transfer" });
    fireEvent.click(transferButtons[0]);

    const form = await screen.findByRole("form", { name: "Transfer form" });
    const toSelect = within(form).getByRole("combobox");
    const amountInput = within(form).getByPlaceholderText("Enter amount");

    fireEvent.change(toSelect, { target: { value: "acc-2" } });
    fireEvent.change(amountInput, { target: { value: "100" } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Policy not found — this action has no matching authorization policy. Please contact your administrator.",
        5000,
      );
    });
    // The bug this guards: falling through to the generic status-only branch,
    // which would show the raw error code instead of the friendly message.
    expect(notifyError).not.toHaveBeenCalledWith("policy_not_found");
    expect(notifyError).not.toHaveBeenCalledWith("Transfer failed");
  });
});
