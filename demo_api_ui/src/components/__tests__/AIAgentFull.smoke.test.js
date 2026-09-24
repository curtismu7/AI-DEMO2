/**
 * Smoke test for AIAgentFull: the MCP transport picker and the disabled
 * Privilege A2A stub must render (Task 4 of the AIAgentFull plan).
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import { clearIdJagRunState, ID_JAG_USE_CASE_ID, USE_CASE_RUN_CONTEXT_KEY } from "../../utils/idJagRunMode";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
}));

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: vi.fn() }),
}));

vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
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
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true, reply: "Done." }),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));

vi.mock("../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));

vi.mock("../../utils/agentToolSteps", () => ({
  getToolStepsForAction: vi.fn(() => []),
}));

vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../utils/appToast", () => ({
  toast: {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(),
    warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
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

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }),
}));

const bffGet = vi.fn();
vi.mock("../../services/bffAxios", () => ({
  default: {
    get: (...args) => bffGet(...args),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

let mockManifest = null;
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "healthcare",
    pageManifest: mockManifest,
    agentManifest: mockManifest,
    adminManifest: null,
    pageMockData: null,
    isAdminScope: false,
    isAdmin: false,
    refetch: () => {},
  }),
}));

vi.mock("../../services/privilegeMcpService", () => ({ callMcpToolViaPrivilege: vi.fn() }));

import AIAgentFull from "../AIAgentFull";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearIdJagRunState();
  mockManifest = { id: "healthcare", identity: { displayName: "CareConnect" } };
  bffGet.mockReset();
  bffGet.mockResolvedValue({ data: {} });
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  );
});

function renderAgent(props = {}, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgentFull {...props} />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

describe("AIAgentFull smoke", () => {
  it("renders the MCP transport picker and the disabled Privilege A2A stub", async () => {
    renderAgent({
      user: { id: "u1", role: "customer" },
      mode: "inline",
      forceVertical: "healthcare",
    });
    expect(await screen.findByLabelText(/mcp transport/i)).toBeInTheDocument();
    expect(await screen.findByText(/privilege a2a/i)).toBeInTheDocument();
    expect(screen.getByText(/coming later/i)).toBeInTheDocument();
  });

  it("launches a UC40-scoped phrase from its stored context", async () => {
    sessionStorage.setItem(USE_CASE_RUN_CONTEXT_KEY, JSON.stringify({ useCaseId: ID_JAG_USE_CASE_ID }));
    const onLaunch = vi.fn();
    window.addEventListener("id-jag-run-requested", onLaunch);
    try {
      renderAgent({ user: { id: "u1", role: "customer" }, mode: "inline" }, "/dashboard");
      const input = screen.getByPlaceholderText(/^Message |^Ask about/);
      fireEvent.change(input, { target: { value: "run ID-JAG demo" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
      expect(onLaunch.mock.calls[0][0].detail).toMatchObject({
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: "live-id-jag",
        message: "show my balance",
        returnTo: "/dashboard",
      });
      expect(global.fetch).not.toHaveBeenCalledWith("/api/demo-agent/nl", expect.anything());
    } finally {
      window.removeEventListener("id-jag-run-requested", onLaunch);
    }
  });

  it("replays a validated callback once across duplicate events", () => {
    const onPrefill = vi.fn();
    window.addEventListener("banking-agent-prefill", onPrefill);
    try {
      renderAgent({ user: { id: "u1", role: "customer" }, mode: "inline" }, "/dashboard");
      const callback = new CustomEvent("userAuthenticated", { detail: {
        idJagCallbackValidated: true,
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: "live-id-jag",
        message: "show my balance",
      } });
      act(() => {
        window.dispatchEvent(new CustomEvent("userAuthenticated"));
        window.dispatchEvent(callback);
        window.dispatchEvent(callback);
      });
      expect(onPrefill).toHaveBeenCalledTimes(1);
      expect(onPrefill.mock.calls[0][0].detail).toEqual({
        useCaseId: ID_JAG_USE_CASE_ID,
        mode: "live-id-jag",
        message: "show my balance",
        autoSend: true,
      });
    } finally {
      window.removeEventListener("banking-agent-prefill", onPrefill);
    }
  });
});
