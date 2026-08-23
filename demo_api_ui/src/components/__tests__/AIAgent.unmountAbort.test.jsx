/**
 * The unmount/route-change cleanup effect only aborted sendAbortRef -- it
 * never called useAgentRun's own aguiAbort, so an in-flight AG-UI stream kept
 * running past unmount and could call onEvent/onStateSnapshot/onFinished
 * closures against a dead component instance.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
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
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });
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

const aguiAbortSpy = vi.fn();
vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: (...args) => aguiAbortSpy(...args) }),
}));

import AIAgent from "../AIAgent";

const signedIn = { id: "u1", role: "customer", email: "u@test.com", username: "cust" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  aguiAbortSpy.mockClear();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

describe("AIAgent unmount cleanup", () => {
  it("aborts the AG-UI run (aguiAbort), not just the plain sendAbortRef fetch", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={signedIn} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    // aguiAbort may already run once during mount (unrelated defensive reset
    // elsewhere in the component) -- only calls from THIS unmount matter.
    aguiAbortSpy.mockClear();
    unmount();

    // A separate, pre-existing effect (empty deps, fires once on true
    // unmount only) already calls aguiAbort -- that accounts for ONE call.
    // Before this fix, that was the only one: the sendAbortRef cleanup effect
    // (keyed on location.pathname, so it ALSO fires on every route change
    // even without unmounting -- the case the pre-existing effect can never
    // catch) never referenced aguiAbort at all. Two calls on unmount proves
    // this fix's line actually ran, not just the pre-existing effect.
    expect(aguiAbortSpy).toHaveBeenCalledTimes(2);
  });
});
