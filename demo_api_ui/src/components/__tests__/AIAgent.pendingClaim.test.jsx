/**
 * The queued question must be claimed on pages that mount only the FLOATING
 * agent, not just the inline one.
 *
 * Live repro: signed out, clicked a sign-in prompt, completed PingOne SSO, came
 * back authenticated on a floating-agent page — and found
 *   sessionStorage['bx_agent_pending_nl'] still set, chat never re-asked it.
 * The mount claim was gated on `isInline`, so `/` (marketing) and the admin
 * console never replayed anything. That is the promise the bubble makes.
 *
 * Inline keeps priority; floating claims only if the key survives a tick.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Banking", name: "Super Banking" } }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({ useTokenChainOptional: () => null }));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: vi.fn() }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900, tokenLoading: false, staleSession: false, hasActiveToken: true,
  }),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({ source: "local", result: { kind: "none" } }),
}));

const sendAgentMessage = vi.fn();
vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: vi.fn().mockResolvedValue([]),
  getAccountBalance: vi.fn().mockResolvedValue({ balance: 100 }),
  getMyTransactions: vi.fn().mockResolvedValue([]),
  createTransfer: vi.fn().mockResolvedValue({ success: true }),
  createDeposit: vi.fn().mockResolvedValue({ success: true }),
  createWithdrawal: vi.fn().mockResolvedValue({ success: true }),
  refreshOAuthSession: vi.fn().mockResolvedValue({}),
  warmupAuthz: vi.fn().mockResolvedValue({}),
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: (...args) => sendAgentMessage(...args),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({ loadPublicConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: vi.fn(() => []) }));
vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(),
    warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(),
}));
vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [], toolCalls: [], tokenEvents: [], mcpTraffic: [],
      authorizeDecisions: [], lastTokenUsage: null, lastOutcome: null,
      hitlPending: null, error: null,
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));
vi.mock("../../hooks/useAgentRun", () => ({ useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }) }));
vi.mock("../../services/bffAxios", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
  },
}));
// Mutable so a test can hold the manifest unresolved (activeId null) and then
// resolve it, which is the real sequence on a full page load.
let mockVerticalId = "banking";
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: mockVerticalId,
    pageManifest: mockVerticalId
      ? { id: mockVerticalId, identity: { displayName: "Super Banking" } }
      : null,
    agentManifest: mockVerticalId
      ? { id: mockVerticalId, identity: { displayName: "Super Banking" } }
      : null,
    adminManifest: null, pageMockData: null, isAdminScope: false, isAdmin: false,
    // Null id here means "not resolved YET" (the sequence under test), so the
    // status must say loading — a concluded-empty answer is handed straight
    // back to the composer now (see AIAgent.resumeVerticalReadiness.test.jsx).
    verticalStatus: mockVerticalId ? "resolved" : "loading",
    refetch: () => {},
  }),
}));

import AIAgent from "../AIAgent";

const PENDING_KEY = "bx_agent_pending_nl";
const QUESTION = "What is my account balance?";
const signedIn = { id: "u1", role: "customer", email: "u@test.com", username: "cust" };

function renderAgent(mode) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={signedIn} mode={mode} />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

/**
 * The component resolves its own session from these three endpoints. Returning
 * `{}` (as a bare fetch mock does) takes the "no session found" branch, which is
 * NOT the path a signed-in reload takes — and the live defect lives on the other
 * branch. Answer them like a real signed-in session does.
 */
function mockSignedInStatus() {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    const body = u.includes("/api/auth/oauth/user/status")
      ? { authenticated: true, user: { id: "u1", role: "customer", username: "cust" } }
      : u.includes("/api/auth/session")
        ? { authenticated: true, user: { id: "u1", role: "customer", username: "cust" }, hasTokens: true }
        : u.includes("/api/auth/oauth/status")
          ? { authenticated: false }
          : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockVerticalId = "banking";
  sendAgentMessage.mockReset();
  sendAgentMessage.mockResolvedValue({ success: true, reply: "Your balance is $100." });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

// The live defect, reproduced at its cause.
//
// `/dashboard` is a guest-chat surface, so `marketingGuestChatEnabled` reads
// true for the whole window before `isLoggedIn` flips. Reloading it while
// SIGNED IN therefore replayed the queued question ~250ms in, as a guest,
// before the vertical manifest resolved — the probe showed the body going out
// with no `vertical`, a 200 coming back, and the reply being discarded: no user
// bubble, a typing indicator that never cleared, and a disabled input until
// reload. The same run works on an SPA remount, where hydration is already done.
// The measured difference between the broken and working cases. On a full page
// load the replay fired before the vertical manifest resolved and the request
// went out with no `vertical`; after an SPA remount, with the manifest already
// resolved, the same replay sends `vertical:"retail"` and renders normally.
describe("before the vertical manifest resolves", () => {
  it("waits, rather than sending a request whose reply is discarded", async () => {
    mockVerticalId = null; // manifest not resolved yet
    mockSignedInStatus();
    sessionStorage.setItem(PENDING_KEY, QUESTION);

    const { rerender } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={signedIn} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();

    // Manifest resolves — now the replay may go, and carries the vertical.
    mockVerticalId = "retail";
    rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={signedIn} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    await waitFor(() => {
      expect(sendAgentMessage).toHaveBeenCalledWith(
        QUESTION,
        null,
        expect.objectContaining({ vertical: "retail" }),
      );
    });
  });
});

// The gate added in #1981 had no timeout, so a surface whose manifest never
// resolves dropped the question silently — and a silent drop is
// indistinguishable from "this path was never watched", which is the ambiguity
// that cost two sessions hours on this defect. The wait is bounded, and the
// expiry hands the question back where the user can see and send it.
describe("when the vertical manifest never resolves", () => {
  it("gives the question back to the composer instead of dropping it", async () => {
    vi.useFakeTimers();
    try {
      mockVerticalId = null; // never resolves
      mockSignedInStatus();
      sessionStorage.setItem(PENDING_KEY, QUESTION);

      render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <ActivityNarrativeProvider>
            <ProofOfEnforcementProvider>
              <AIAgent user={signedIn} mode="inline" />
            </ProofOfEnforcementProvider>
          </ActivityNarrativeProvider>
        </MemoryRouter>,
      );

      // Past the 8s deadline.
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

      // Never sent — a request without a vertical is the bug this gate exists for.
      expect(sendAgentMessage).not.toHaveBeenCalled();
      // But the visitor can see what happened and act on it.
      expect(screen.getByText(/haven't asked that yet/i)).toBeInTheDocument();
      const box = screen.getByPlaceholderText(/Ask about|Message/i);
      expect(box).toHaveValue(QUESTION);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("while the session check is still in flight", () => {
  it("does not replay the question as a guest", async () => {
    // Status endpoints that never answer — the hydration window, held open.
    global.fetch = vi.fn(() => new Promise(() => {}));
    sessionStorage.setItem(PENDING_KEY, QUESTION);

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={null} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    // Sending here is the bug: the answer would be discarded mid-hydration.
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});

describe("a resumed run on a signed-in reload", () => {
  it("shows the question and the reply, and does not strand the panel", async () => {
    mockSignedInStatus();
    sessionStorage.setItem(PENDING_KEY, QUESTION);

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={signedIn} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });

    await waitFor(() => {
      expect(sendAgentMessage).toHaveBeenCalledWith(QUESTION, null, expect.anything());
    });
    // The question the visitor asked must be on screen…
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    // …and so must the answer, rather than a typing indicator that never clears.
    await waitFor(() => {
      expect(screen.getByText(/Your balance is \$100\./)).toBeInTheDocument();
    });
  });
});

describe("a question queued before sign-in", () => {
  it("is claimed by the inline agent immediately", async () => {
    sessionStorage.setItem(PENDING_KEY, QUESTION);
    renderAgent("inline");

    await waitFor(() => {
      expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText(QUESTION)).toBeInTheDocument();
    });
  });

  // The case that was broken: `/` and the admin console mount only this one.
  it("is claimed by a floating agent when no inline one exists", async () => {
    sessionStorage.setItem(PENDING_KEY, QUESTION);
    renderAgent("fab");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    await waitFor(() => {
      expect(sendAgentMessage).toHaveBeenCalledWith(QUESTION, null, expect.anything());
    });
  });

  it("is replayed exactly once when both instances mount", async () => {
    sessionStorage.setItem(PENDING_KEY, QUESTION);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={signedIn} mode="inline" />
            <AIAgent user={signedIn} mode="fab" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    const replays = sendAgentMessage.mock.calls.filter((c) => c[0] === QUESTION);
    expect(replays).toHaveLength(1);
  });
});
