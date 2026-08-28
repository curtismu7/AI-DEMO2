/**
 * Smoke tests for UserDashboardPing2026.
 *
 * Asserts parity invariants that can be verified without a live BFF:
 *   1. Renders without crashing
 *   2. .customer-skin-p1 wrapper present
 *   3. Root element has both customer-skin-p1 and user-dashboard--2026 classes
 *   4. Hero balance element exists (contains "$")
 *   5. At least one Transfer button in the DOM
 *   6. TransactionConsentModal not open on mount
 *   7. OTP modal overlay not in DOM on mount
 *
 * Test setup: fetch is mocked globally; react-router-dom hooks are mocked;
 * required contexts are provided with minimal stubs.
 */
import node_crypto from "node:crypto";
import node_fs from "node:fs";
import node_path from "node:path";
import { render, waitFor } from "@testing-library/react";
import React from "react"; // eslint-disable-line no-unused-vars -- JSX transform still needs React in scope for some vitest configs
import { MemoryRouter } from "react-router-dom";
import { AgentUiModeProvider } from "../../context/AgentUiModeContext";
import { SessionTokenProvider } from "../../context/SessionTokenContext";
import { VerticalContext } from "../../vertical/VerticalProvider";
import UserDashboardPing2026 from "../UserDashboardPing2026";

// ── Mock react-router-dom hooks used by UserDashboard ─────────────────────
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/dashboard", search: "", state: null }),
  };
});

// ── Mock apiClient (axios-based) so account data loads in tests ───────────
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn((url) => {
      if (url.includes("/api/accounts/my")) {
        return Promise.resolve({
          data: {
            accounts: [
              { id: "chk-1", name: "Checking Account", accountType: "checking", accountNumber: "CHK-0001", balance: 3000.0 },
              { id: "sav-1", name: "Savings Account", accountType: "savings", accountNumber: "SAV-0001", balance: 1500.0 },
            ],
          },
        });
      }
      if (url.includes("/api/transactions/my")) {
        return Promise.resolve({ data: { transactions: [] } });
      }
      return Promise.resolve({ data: {} });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// ── Mock AgentUiModeContext to use 'bottom' placement so banking content renders ──
vi.mock("../../context/AgentUiModeContext", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAgentUiMode: () => ({
      placement: "bottom",
      setSurfaceHostEl: vi.fn(),
      // The dashboard registers a toolbar host too; omitting this makes every
      // case in this file die on "setToolbarHostEl is not a function".
      setToolbarHostEl: vi.fn(),
      fab: false,
    }),
  };
});

// ── Shared test fixtures ───────────────────────────────────────────────────
const mockUser = {
  id: "u1",
  firstName: "Demo",
  lastName: "User",
  email: "demo@example.com",
  role: "customer",
};

// ── Global fetch mock ─────────────────────────────────────────────────────
const DEMO_ACCOUNTS = [
  {
    id: "chk-1",
    name: "Checking Account",
    accountType: "checking",
    accountNumber: "CHK-0001",
    balance: 3000.0,
  },
  {
    id: "sav-1",
    name: "Savings Account",
    accountType: "savings",
    accountNumber: "SAV-0001",
    balance: 1500.0,
  },
];

const JSON_HEADERS = { get: (h) => (h === "content-type" ? "application/json" : null) };

function mockFetch(url) {
  if (url.includes("/api/auth/oauth/user/status")) {
    return Promise.resolve({
      ok: true,
      headers: JSON_HEADERS,
      json: () =>
        Promise.resolve({
          authenticated: true,
          user: mockUser,
        }),
    });
  }
  if (url.includes("/api/accounts/my")) {
    return Promise.resolve({
      ok: true,
      headers: JSON_HEADERS,
      json: () => Promise.resolve({ accounts: DEMO_ACCOUNTS }),
    });
  }
  if (url.includes("/api/transactions/my")) {
    return Promise.resolve({
      ok: true,
      headers: JSON_HEADERS,
      json: () => Promise.resolve({ transactions: [] }),
    });
  }
  if (url.includes("/api/admin/feature-flags")) {
    return Promise.resolve({
      ok: true,
      headers: JSON_HEADERS,
      json: () => Promise.resolve({ flags: [] }),
    });
  }
  return Promise.resolve({
    ok: true,
    headers: JSON_HEADERS,
    json: () => Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation(mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Mock AgentClinicalHost to avoid deep dependency chain in clinical-split tests ──
vi.mock("../agent-clinical/AgentClinicalHost", () => ({
  default: () => <div data-testid="clinical-host-mock">Clinical Host</div>,
}));

// ── Mock TokenChainTraceRail — polls /api/token-chain and portals modals ──
vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));
vi.mock("../TokenChainFilmstrip", () => ({ default: () => null }));

// ── Wrapper with all required providers ────────────────────────────────────
function Wrapper({ children }) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <VerticalContext.Provider value={null}>
        <AgentUiModeProvider>
          <SessionTokenProvider>{children}</SessionTokenProvider>
        </AgentUiModeProvider>
      </VerticalContext.Provider>
    </MemoryRouter>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("1. renders without crashing", () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  expect(container).toBeInTheDocument();
});

test("2. .customer-skin-p1 wrapper is present", async () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  // loading=true on mount shows spinner; wait for fetchUserData to complete
  await waitFor(() =>
    expect(container.querySelector(".customer-skin-p1")).not.toBeNull()
  );
});

test("3. root element has both customer-skin-p1 and user-dashboard--2026 classes", async () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  // Both classes appear on the same root div — no nesting, so use compound selector
  await waitFor(
    () => {
      expect(
        container.querySelector(".customer-skin-p1.user-dashboard--2026"),
      ).not.toBeNull();
    },
    { timeout: 3000 },
  );
});

test("4. hero balance element contains $", async () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  // Component renders demo accounts synchronously after loading resolves
  await waitFor(
    () => {
      const balance = container.querySelector(".ud-hero__balance");
      expect(balance).not.toBeNull();
      expect(balance.textContent).toContain("$");
    },
    { timeout: 3000 },
  );
});

test("5. at least one Transfer button is present", async () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  await waitFor(
    () => {
      const btns = container.querySelectorAll(".select-account-btn");
      expect(btns.length).toBeGreaterThan(0);
    },
    { timeout: 3000 },
  );
});

test("6. TransactionConsentModal is not open on mount", () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  expect(
    container.querySelector('[data-testid="transaction-consent-modal"]'),
  ).toBeNull();
});

test("7. OTP step-up overlay is not in DOM on mount", () => {
  const { container } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  expect(container.querySelector(".otp-step-up-overlay")).toBeNull();
});


test("9. ConfirmModal (Reset Demo) mounts in clinical-split branch when showResetModal is set", async () => {
  // The component reads window.location.search in its useState initializer.
  // jsdom's window.location is separate from MemoryRouter, so we set it directly.
  const originalSearch = window.location.search;
  Object.defineProperty(window, "location", {
    value: { ...window.location, search: "?ff_agent_clinical_split=on" },
    writable: true,
    configurable: true,
  });

  try {
    const { container } = render(
      <Wrapper>
        <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
      </Wrapper>,
    );

    // Confirm the clinical-split layout rendered (not the default layout)
    await waitFor(() => {
      expect(
        container.querySelector(".user-dashboard--clinical-split"),
      ).not.toBeNull();
    }, { timeout: 3000 });

    // The ConfirmModal (Reset Demo) is NOT open on mount.
    // DraggableModal uses a portal so it renders outside `container` — use document.
    expect(document.querySelector(".dm-panel")).toBeNull();

    // Fire the event that opens the Reset Demo modal
    window.dispatchEvent(new CustomEvent("dashboard:open-reset-modal"));

    // The ConfirmModal must now be present in the document — proving it is reachable
    // in clinical-split mode even though clinicalSplitEnabled causes an early return.
    await waitFor(() => {
      expect(document.querySelector(".dm-panel")).not.toBeNull();
    }, { timeout: 3000 });
  } finally {
    // Restore original window.location.search
    Object.defineProperty(window, "location", {
      value: { ...window.location, search: originalSearch },
      writable: true,
      configurable: true,
    });
  }
});

// Test 8 was a byte-for-byte sha256 canary over UserDashboard.js, the frozen
// classic dashboard. That component is deleted, so there is nothing to freeze:
// the guard that replaced it lives in FocusModeFilmstripGuard.test.js and
// asserts exactly one customer dashboard component exists.
