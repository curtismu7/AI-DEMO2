/**
 * A guest who picks a step that needs a session gets a sign-in button, not a
 * doomed request.
 *
 * `/` and `/dashboard` enable guest chat (isPublicMarketingAgentPath), and the
 * old gate treated that as permission to run ANY step. So a guest on the
 * dashboard picking UC1 saw "Running Demo step…", the BFF refused it, and a
 * re-auth banner landed over an empty chat — with no way in. The step's own
 * declared level decides now, and the refusal carries the button.
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
    tokenSecondsLeft: 0, tokenLoading: false, staleSession: false, hasActiveToken: false,
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

const apiPatch = vi.fn();
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: (...args) => apiPatch(...args),
  },
}));

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "banking",
    pageManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    agentManifest: { id: "banking", identity: { displayName: "Super Banking" } },
    adminManifest: null,
    pageMockData: null,
    isAdminScope: false,
    isAdmin: false,
    refetch: () => {},
  }),
}));

import AIAgent from "../AIAgent";

const UC1 = {
  id: "UC1",
  useCaseId: "delegated-access-with-proof",
  title: "Delegated access with proof",
  auth: "user",
  primaryTool: "get_account_balance",
  trigger: { type: "chip", text: "What is my balance?" },
};

const UC24 = {
  id: "UC24",
  useCaseId: "progressive-trust-public-access",
  title: "Act 1 — Public catalog access",
  auth: "public",
  primaryTool: "get_branch_hours",
  trigger: { type: "chip", text: "What branches are near me?" },
};

const ADMIN1 = {
  id: "ADMIN1",
  useCaseId: "admin-list-apps",
  title: "List applications",
  auth: "admin",
  trigger: { type: "chip", text: "List all PingOne applications in this environment" },
};

beforeEach(() => {
  localStorage.clear();
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({ data: {} });
  sendAgentMessage.mockReset();
  sendAgentMessage.mockResolvedValue({ success: true, reply: "ok" });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

/** `/dashboard` is a guest-chat surface — the case the old gate got wrong. */
function renderAt(path, user = null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={user} mode="inline" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

async function runStep(uc) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent("agent-demo-step-select", { detail: { uc, stepNumber: 1 } }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
}

describe("guest on a guest-chat surface", () => {
  it("offers a sign-in button for a step that needs a session", async () => {
    renderAt("/dashboard");
    await runStep(UC1);

    await waitFor(() => {
      expect(screen.getByText(/needs you signed in/i)).toBeInTheDocument();
    });
    // The prompt's own action, not the header's Sign In — that is the button
    // the visitor is actually being offered here.
    expect(screen.getByRole("button", { name: /sign in to continue/i })).toBeInTheDocument();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("asks for an ADMIN sign-in when the step needs admin", async () => {
    renderAt("/dashboard");
    await runStep(ADMIN1);

    await waitFor(() => {
      expect(screen.getByText(/needs an admin sign-in/i)).toBeInTheDocument();
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it("still runs a public step without asking for anything", async () => {
    renderAt("/dashboard");
    await runStep(UC24);

    await waitFor(() => {
      expect(screen.getByText(/Running Demo step 1/i)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toMatch(/needs you signed in/i);
  });
});

describe("signed-in customer", () => {
  it("runs a user-level step, and is still refused an admin one", async () => {
    const customer = { id: "u1", role: "customer", email: "u@test.com", username: "cust" };

    const { unmount } = renderAt("/dashboard", customer);
    await runStep(UC1);
    await waitFor(() => {
      expect(screen.getByText(/Running Demo step 1/i)).toBeInTheDocument();
    });
    unmount();

    renderAt("/dashboard", customer);
    await runStep(ADMIN1);
    await waitFor(() => {
      expect(screen.getByText(/needs an admin sign-in/i)).toBeInTheDocument();
    });
  });
});
