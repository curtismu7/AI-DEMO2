/**
 * A signed-out visitor who TYPES a request needing a session gets a sign-in
 * button, not a debugging instruction.
 *
 * Live repro on /dashboard, signed out, "What is my account balance?":
 *   ⚠️ The agent request failed: Session expired — open Token Chain or MCP
 *      Traffic to see the failing step, then try again.
 * There was no session to expire, the panel shows nothing actionable, and
 * trying again fails identically. The demo-step path has offered a sign-in
 * button since #1950; the typed path reached the dead end it was built to
 * remove. Public prompts were never affected — the BFF answers those for
 * guests, so no error is raised in the first place.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    tokenSecondsLeft: 0, tokenLoading: false, staleSession: false, hasActiveToken: false,
  }),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({ source: "local", result: { kind: "none" } }),
}));
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
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true, reply: "ok" }),
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
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "banking",
    pageManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    agentManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    adminManifest: null, pageMockData: null, isAdminScope: false, isAdmin: false,
    refetch: () => {},
  }),
}));

// The run's failure is what this test drives — the AG-UI reducer surfaces it
// as state.error, which is where the bubble decision is made.
let mockAgentError = null;
vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [], toolCalls: [], tokenEvents: [], mcpTraffic: [],
      authorizeDecisions: [], lastTokenUsage: null, lastOutcome: null,
      hitlPending: null, error: mockAgentError,
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));

import AIAgent from "../AIAgent";

const customer = { id: "u1", role: "customer", email: "u@test.com", username: "cust" };

function renderAgent(user) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={user} mode="inline" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockAgentError = null;
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

describe("signed-out visitor, run failed for want of a session", () => {
  it.each(["Session expired", "Unauthorized", "authentication required"])(
    "offers a sign-in instead of a debugging instruction (%s)",
    async (err) => {
      mockAgentError = err;
      renderAgent(null);

      await waitFor(() => {
        expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("The agent request failed");
      expect(document.body.textContent).not.toContain("try again");
    },
  );
});

// The bubble says "I'll answer it as soon as you are". Keeping that promise
// means the question must survive the OAuth redirect — a full page load, so a
// React ref is gone and only sessionStorage carries it. Shipped in #1958
// asserting only the bubble, and the persistence was silently absent on the
// typed path (the ref was set at the chip call site, not this one); driving the
// live stack showed the bubble rendered while bx_agent_pending_nl stayed null.
describe("the queued question", () => {
  it("is persisted verbatim so it survives the sign-in redirect", async () => {
    // Start clean: the run has not failed yet, so the visitor can type.
    mockAgentError = null;
    const { rerender } = renderAgent(null);

    const input = await screen.findByPlaceholderText(/Ask about|Message/i);
    fireEvent.change(input, { target: { value: "What is my account balance?" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      fireEvent.submit(input.closest("form") || input);
    });

    // The user's turn is on screen — that is what addMessage captured.
    await waitFor(() => {
      expect(screen.getByText("What is my account balance?")).toBeInTheDocument();
    });

    // Now the run fails for want of a session.
    mockAgentError = "Session expired";
    rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={null} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    // The exact question, ready for the post-login replay to claim.
    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBe("What is my account balance?");
  });
});

describe("errors that are not about auth", () => {
  it("still shows the debugging bubble for a signed-out visitor", async () => {
    mockAgentError = "MCP tool 503 from gateway";
    renderAgent(null);

    await waitFor(() => {
      expect(screen.getByText(/The agent request failed/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toMatch(/needs you signed in/i);
  });

  it("keeps the debugging bubble for a signed-in user whose session really expired", async () => {
    // A real expiry mid-session is a different situation from never having
    // signed in: the re-auth banner owns that, and the chat should still say
    // what broke rather than inviting a sign-in the user already has.
    mockAgentError = "Session expired";
    renderAgent(customer);

    await waitFor(() => {
      expect(screen.getByText(/The agent request failed/i)).toBeInTheDocument();
    });
  });
});
