/**
 * The queued-question resume used to race RESUME_VERTICAL_WAIT_MS (8s) against
 * the vertical manifest with no way to tell "still loading" from "resolved to
 * none" (TECH_DEBT 2026-08-18 "held together by two tuned timeouts"). The
 * vertical context now reports verticalStatus, and the resume:
 *   - hands the question back IMMEDIATELY when the answer is concluded-empty
 *     ('resolved' / 'failed') — waiting cannot change a concluded answer;
 *   - keeps waiting (deadline as backstop only) while status is 'loading'.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
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
vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

// Mutable vertical context: each test sets what the provider would report.
let mockVertical = { activeId: null, verticalStatus: "loading" };
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: mockVertical.activeId,
    pageManifest: null,
    agentManifest: null,
    adminManifest: null,
    pageMockData: null,
    isAdminScope: false,
    isAdmin: false,
    verticalStatus: mockVertical.verticalStatus,
    refetch: () => {},
  }),
}));

import AIAgent from "../AIAgent";

const ADMIN = { id: "u1", role: "admin", username: "admin" };
const HANDED_BACK = /couldn't finish loading this workspace/i;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  sendAgentMessage.mockReset();
  sendAgentMessage.mockResolvedValue({ success: true, reply: "ok" });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

function renderAgent(user = ADMIN) {
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

const settle = async (ms = 400) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("queued-question resume vs vertical readiness", () => {
  test("concluded-empty vertical hands the question back immediately, not after 8s", async () => {
    mockVertical = { activeId: null, verticalStatus: "resolved" };
    sessionStorage.setItem("bx_agent_pending_nl", "What is my balance?");

    renderAgent();
    await settle();

    // Well inside the old RESUME_VERTICAL_WAIT_MS window: already handed back.
    expect(screen.getByText(HANDED_BACK)).toBeInTheDocument();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  test("'failed' status also concludes — handed back immediately", async () => {
    mockVertical = { activeId: null, verticalStatus: "failed" };
    sessionStorage.setItem("bx_agent_pending_nl", "What is my balance?");

    renderAgent();
    await settle();

    expect(screen.getByText(HANDED_BACK)).toBeInTheDocument();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  test("still-loading vertical keeps waiting (no premature hand-back, no premature send)", async () => {
    mockVertical = { activeId: null, verticalStatus: "loading" };
    sessionStorage.setItem("bx_agent_pending_nl", "What is my balance?");

    renderAgent();
    await settle();

    // Inside the deadline: neither handed back nor sent — genuinely waiting.
    expect(screen.queryByText(HANDED_BACK)).not.toBeInTheDocument();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  test("vertical resolving mid-wait releases the send", async () => {
    mockVertical = { activeId: null, verticalStatus: "loading" };
    sessionStorage.setItem("bx_agent_pending_nl", "What is my balance?");

    const view = renderAgent();
    await settle();
    expect(sendAgentMessage).not.toHaveBeenCalled();

    mockVertical = { activeId: "banking", verticalStatus: "resolved" };
    view.rerender(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={ADMIN} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );
    await settle(600);

    expect(sendAgentMessage).toHaveBeenCalledWith(
      "What is my balance?",
      null,
      expect.anything(),
    );
    expect(screen.queryByText(HANDED_BACK)).not.toBeInTheDocument();
  });
});
