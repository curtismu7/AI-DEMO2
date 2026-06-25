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
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UserDashboardPing2026 from "./UserDashboardPing2026";

// ── Context hooks ────────────────────────────────────────────────────────────

vi.mock("../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({
    placement: "none",
    setSurfaceHostEl: vi.fn(),
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
vi.mock("./TokenChainDisplay", () => ({ default: () => null }));
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
  it("renders the customer-skin-p1 wrapper div", () => {
    const { container } = renderDashboard();

    const wrapperDiv = container.querySelector(".customer-skin-p1");
    expect(wrapperDiv).not.toBeNull();
    expect(wrapperDiv.className).toContain("customer-skin-p1");
  });

  it("does not crash when user prop is null", () => {
    expect(() => renderDashboard(null)).not.toThrow();
  });
});
