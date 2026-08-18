/**
 * A signed-out visitor who TYPES a banking prompt on a guest-chat surface
 * (`/` or `/dashboard`) is offered a sign-in button, not thrown straight to
 * PingOne mid-sentence.
 *
 * The marketing/guest branch in dispatchNlResult predated the shared
 * sign-in-prompt treatment (#1952/#1958): it called handleLoginAction("login_user")
 * directly, so the visitor was redirected with no chance to decline. Every other
 * refusal path renders a "needs you signed in" bubble plus a "Sign in to
 * continue" button and lets the visitor choose. This brings the guest branch
 * into line. The typed question is still persisted (bx_agent_pending_nl) for the
 * post-login replay exactly as before — a consent/consistency fix, not a flow
 * change.
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

import AIAgent from "../AIAgent";

const PROMPT = "What is my account balance?";

// The typed path routes through POST /api/demo-agent/nl. Returning a banking
// intent is what carries the guest into the marketing/guest branch under test.
// handleLoginAction("login_user") — and only it — fetches /api/admin/config, so
// that call is the deterministic signal for "the login action fired".
function mockFetch() {
  return vi.fn((url) => {
    if (String(url).includes("/api/demo-agent/nl")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          result: { kind: "banking", banking: { action: "account_balance" } },
          source: "heuristic",
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function adminConfigCalls() {
  return global.fetch.mock.calls.filter(([u]) => String(u).includes("/api/admin/config"));
}

function renderGuest() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={null} mode="inline" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

async function typeAndSend(text) {
  const input = await screen.findByPlaceholderText(/Ask about|Message/i);
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.submit(input.closest("form") || input);
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  global.fetch = mockFetch();
});

describe("signed-out visitor types a banking prompt on the guest-chat surface", () => {
  it("offers a sign-in button instead of auto-redirecting to PingOne", async () => {
    renderGuest();
    await typeAndSend(PROMPT);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
    // The old branch spoke this line and redirected mid-sentence.
    expect(document.body.textContent).not.toMatch(/Taking you to PingOne/i);
    // No redirect happens on its own — the visitor still holds the choice.
    expect(adminConfigCalls()).toHaveLength(0);
  });

  it("persists the typed question verbatim for the post-login replay", async () => {
    renderGuest();
    await typeAndSend(PROMPT);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
    });
    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBe(PROMPT);
  });

  it("invokes the customer login action only when the visitor clicks the button", async () => {
    renderGuest();
    await typeAndSend(PROMPT);

    const btn = await screen.findByRole("button", { name: /sign in to continue/i });
    // Nothing has redirected yet.
    expect(adminConfigCalls()).toHaveLength(0);

    await act(async () => {
      btn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // The customer login path is the one that reads /api/admin/config.
    expect(adminConfigCalls().length).toBeGreaterThan(0);
    // The queued question is still there for the replay after sign-in.
    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBe(PROMPT);
  });
});
