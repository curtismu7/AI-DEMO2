/**
 * Regression tests for the customer-dashboard step-up lifecycle fixes.
 *
 * Mounts the real UserDashboardPing2026 and drives its public seams
 * (the `agentStepUpRequested` window event + the rendered OTP / "MFA Session
 * Expired" controls). UserDashboardPing2026 is a near-copy of UserDashboard.js;
 * the two share this step-up state machine, so exercising one guards the logic
 * of both. The sha256 canary in UserDashboardPing2026.test.js keeps
 * UserDashboard.js in lockstep.
 *
 * Coverage:
 *   FIX 7 — the agent CIBA auto-initiate countdown must NOT fire a real
 *           back-channel auth once the component unmounts (user navigated off
 *           /dashboard) mid-countdown. Positive control: it DOES fire when left
 *           mounted, proving the timer, not the mock, is what we cleared.
 *   FIX 6/agent-success — a genuine agent-triggered OTP success still resumes
 *           (broadcasts `cibaStepUpApproved`). This is the legitimate path we
 *           must not break.
 *   FIX 6 + FIX 8 — after an OTP challenge expires (410) the agent flag is
 *           reset; the "Try Again" control reopens the OTP modal as a MANUAL
 *           step-up, and a subsequent manual success must NOT broadcast a
 *           resume. Without FIX 8 the stale flag would leak into the retry;
 *           without FIX 6's guard the manual success would falsely resume.
 *
 * Note on reachability: the pure manual OTP-modal-open state cannot be reached
 * from a cold mount (no ToastContainer renders the 428 "Verify via Email"
 * toast, and the agent event always sets the flag). The 410 → "Try Again" path
 * is the reachable route to a manual (flag=false) OTP verify, so FIX 6's manual
 * guard is asserted through it — which simultaneously proves FIX 8.
 */
import { fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import React from "react"; // eslint-disable-line no-unused-vars -- JSX transform needs React in scope
import { MemoryRouter } from "react-router-dom";
import { AgentUiModeProvider } from "../../context/AgentUiModeContext";
import { SessionTokenProvider } from "../../context/SessionTokenContext";
import { VerticalContext } from "../../vertical/VerticalProvider";
import UserDashboardPing2026 from "../UserDashboardPing2026";

// ── Hoisted mock fns so vi.mock factories can reference them ────────────────
const { axiosPost, axiosGet, axiosPut } = vi.hoisted(() => ({
  axiosPost: vi.fn(() => Promise.resolve({ data: {} })),
  axiosGet: vi.fn(() => Promise.resolve({ data: {} })),
  axiosPut: vi.fn(() => Promise.resolve({ data: {} })),
}));
const { apiPost, apiGet, apiPut } = vi.hoisted(() => ({
  apiPost: vi.fn(() => Promise.resolve({ data: {} })),
  apiGet: vi.fn(() => Promise.resolve({ data: {} })),
  apiPut: vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock("axios", () => {
  const instance = {
    post: (...a) => axiosPost(...a),
    get: (...a) => axiosGet(...a),
    put: (...a) => axiosPut(...a),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { ...instance, create: () => instance } };
});

vi.mock("../../services/apiClient", () => ({
  default: {
    post: (...a) => apiPost(...a),
    get: (...a) => apiGet(...a),
    put: (...a) => apiPut(...a),
  },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/dashboard", search: "", state: null }),
  };
});

vi.mock("../../context/AgentUiModeContext", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAgentUiMode: () => ({
      placement: "bottom",
      setSurfaceHostEl: vi.fn(),
      setToolbarHostEl: vi.fn(),
      fab: false,
    }),
  };
});

vi.mock("../agent-clinical/AgentClinicalHost", () => ({
  default: () => <div data-testid="clinical-host-mock">Clinical Host</div>,
}));
vi.mock("../TokenChainTraceRail", () => ({ default: () => null }));
vi.mock("../TokenChainFilmstrip", () => ({ default: () => null }));

const mockUser = {
  id: "u1",
  firstName: "Demo",
  lastName: "User",
  email: "demo@example.com",
  role: "customer",
};

const DEMO_ACCOUNTS = [
  { id: "chk-1", name: "Checking Account", accountType: "checking", accountNumber: "CHK-0001", balance: 3000.0 },
  { id: "sav-1", name: "Savings Account", accountType: "savings", accountNumber: "SAV-0001", balance: 1500.0 },
];

const JSON_HEADERS = { get: (h) => (h === "content-type" ? "application/json" : null) };

function mockFetch(url) {
  if (url.includes("/api/auth/oauth/user/status")) {
    return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: () => Promise.resolve({ authenticated: true, user: mockUser }) });
  }
  if (url.includes("/api/accounts/my")) {
    return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: () => Promise.resolve({ accounts: DEMO_ACCOUNTS }) });
  }
  return Promise.resolve({ ok: true, headers: JSON_HEADERS, json: () => Promise.resolve({}) });
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation(mockFetch);
  axiosPost.mockReset().mockResolvedValue({ data: {} });
  axiosGet.mockReset().mockResolvedValue({ data: {} });
  axiosPut.mockReset().mockResolvedValue({ data: {} });
  apiPost.mockReset().mockImplementation((url) => {
    if (url && url.includes("/api/accounts/my")) return Promise.resolve({ data: { accounts: DEMO_ACCOUNTS } });
    return Promise.resolve({ data: {} });
  });
  apiGet.mockReset().mockImplementation((url) => {
    if (url && url.includes("/api/accounts/my")) return Promise.resolve({ data: { accounts: DEMO_ACCOUNTS } });
    if (url && url.includes("/api/transactions/my")) return Promise.resolve({ data: { transactions: [] } });
    return Promise.resolve({ data: {} });
  });
  apiPut.mockReset().mockResolvedValue({ data: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

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

const cibaInitiateCalls = () =>
  axiosPost.mock.calls.filter((c) => c[0] === "/api/auth/ciba/initiate").length;

// The OTP modal, the TOTP modal and the "MFA Session Expired" bubble are all
// `.otp-step-up-overlay` with a `.otp-step-up-modal__btn-primary`, so CSS
// selectors alone are ambiguous during a close→open transition. Match buttons
// by their exact visible text instead.
const findButtonByText = (text) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === text,
  ) || null;
const hasTitle = (text) =>
  [...document.querySelectorAll(".otp-step-up-modal__title")].some(
    (n) => n.textContent.trim() === text,
  );

// ── FIX 7: auto-initiate timers cleared on unmount ─────────────────────────

test("FIX 7 positive control: agent CIBA auto-initiate fires a back-channel auth after the countdown when left mounted", async () => {
  vi.useFakeTimers();
  render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  await act(async () => { await Promise.resolve(); });

  act(() => {
    window.dispatchEvent(
      new CustomEvent("agentStepUpRequested", { detail: { step_up_method: "ciba" } }),
    );
  });
  expect(cibaInitiateCalls()).toBe(0); // not yet — 3s countdown

  await act(async () => {
    vi.advanceTimersByTime(3200);
    await Promise.resolve();
  });
  expect(cibaInitiateCalls()).toBe(1); // countdown elapsed → real auth fired
});

test("FIX 7: unmounting during the countdown clears the timers so no back-channel auth fires", async () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <Wrapper>
      <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
    </Wrapper>,
  );
  await act(async () => { await Promise.resolve(); });

  act(() => {
    window.dispatchEvent(
      new CustomEvent("agentStepUpRequested", { detail: { step_up_method: "ciba" } }),
    );
  });
  expect(cibaInitiateCalls()).toBe(0);

  // User navigates off /dashboard before the 3s countdown completes.
  unmount();

  await act(async () => {
    vi.advanceTimersByTime(3200);
    await Promise.resolve();
  });
  expect(cibaInitiateCalls()).toBe(0); // timers cleared on unmount — nothing fired
});

// ── FIX 6 (agent-success path preserved) ───────────────────────────────────

test("FIX 6: a genuine agent-triggered OTP success still broadcasts cibaStepUpApproved", async () => {
  apiPost.mockImplementation((url) => {
    if (url === "/api/auth/mfa/challenge") {
      return Promise.resolve({ data: { daId: "da1", devices: [{ id: "dev1", type: "EMAIL", nickname: "e@x" }] } });
    }
    if (url && url.includes("/api/accounts/my")) return Promise.resolve({ data: { accounts: DEMO_ACCOUNTS } });
    return Promise.resolve({ data: {} });
  });
  apiPut.mockImplementation((url, body) => {
    if (body && body.otp) return Promise.resolve({ data: { completed: true } }); // verify
    return Promise.resolve({ data: {} }); // device challenge
  });

  const onResume = vi.fn();
  window.addEventListener("cibaStepUpApproved", onResume);
  try {
    render(
      <Wrapper>
        <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
      </Wrapper>,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentStepUpRequested", { detail: { step_up_method: "email" } }),
      );
    });

    const input = await waitFor(() => {
      expect(hasTitle("Verify Your Identity")).toBe(true);
      const el = document.querySelector(".otp-step-up-modal__input");
      expect(el).not.toBeNull();
      return el;
    });
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(findButtonByText("Verify"));

    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  } finally {
    window.removeEventListener("cibaStepUpApproved", onResume);
  }
});

// ── FIX 6 + FIX 8 (expiry resets flag; manual retry does not resume) ────────

test("FIX 6 + FIX 8: after an OTP expiry, a manual 'Try Again' success does NOT broadcast a resume", async () => {
  apiPost.mockImplementation((url) => {
    if (url === "/api/auth/mfa/challenge") {
      return Promise.resolve({ data: { daId: "da1", devices: [{ id: "dev1", type: "EMAIL", nickname: "e@x" }] } });
    }
    if (url && url.includes("/api/accounts/my")) return Promise.resolve({ data: { accounts: DEMO_ACCOUNTS } });
    return Promise.resolve({ data: {} });
  });
  let verifyAttempts = 0;
  apiPut.mockImplementation((url, body) => {
    if (body && body.otp) {
      verifyAttempts += 1;
      if (verifyAttempts === 1) {
        // First verify: challenge expired → FIX 8 must reset agentTriggeredStepUp
        return Promise.reject({ response: { status: 410, data: { error: "challenge_expired" } } });
      }
      return Promise.resolve({ data: { completed: true } }); // manual retry succeeds
    }
    return Promise.resolve({ data: {} }); // device challenge
  });

  const onResume = vi.fn();
  window.addEventListener("cibaStepUpApproved", onResume);
  try {
    render(
      <Wrapper>
        <UserDashboardPing2026 user={mockUser} onLogout={vi.fn()} />
      </Wrapper>,
    );

    // Agent-triggered email step-up opens the OTP modal (agent flag = true).
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentStepUpRequested", { detail: { step_up_method: "email" } }),
      );
    });
    const input1 = await waitFor(() => {
      expect(hasTitle("Verify Your Identity")).toBe(true);
      const el = document.querySelector(".otp-step-up-modal__input");
      expect(el).not.toBeNull();
      return el;
    });
    fireEvent.change(input1, { target: { value: "123456" } });
    fireEvent.click(findButtonByText("Verify"));

    // Expiry closes the OTP modal and shows the standalone "MFA Session Expired"
    // bubble. Gate on that title before touching "Try Again" so we never grab
    // the closing OTP modal's own primary button.
    await waitFor(() => {
      expect(hasTitle("MFA Session Expired")).toBe(true);
      expect(hasTitle("Verify Your Identity")).toBe(false);
    });

    // "Try Again" reopens the OTP modal as a MANUAL step-up (flag now false).
    fireEvent.click(findButtonByText("Try Again"));
    const input2 = await waitFor(() => {
      expect(hasTitle("Verify Your Identity")).toBe(true);
      const el = document.querySelector(".otp-step-up-modal__input");
      expect(el).not.toBeNull();
      return el;
    });
    fireEvent.change(input2, { target: { value: "654321" } });
    fireEvent.click(findButtonByText("Verify"));

    // Manual success closes the modal…
    await waitFor(() =>
      expect(hasTitle("Verify Your Identity")).toBe(false),
    );
    // …and must NOT broadcast the agent-resume event.
    expect(onResume).not.toHaveBeenCalled();
    expect(verifyAttempts).toBe(2);
  } finally {
    window.removeEventListener("cibaStepUpApproved", onResume);
  }
});
