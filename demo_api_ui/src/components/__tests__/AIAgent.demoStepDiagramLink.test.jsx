/* eslint-disable testing-library/no-unnecessary-act */
// A demo step's agent response carries a link (icon + "Diagram") to the
// step's use-case diagram — the same affordance the Mission Control card
// has, so the presenter can open the walkthrough from the reply itself.
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import * as demoAgentNlService from "../../services/demoAgentNlService";
import * as configService from "../../services/configService";
import * as demoAgentService from "../../services/demoAgentService";
import { useVertical } from "../../vertical/useVertical";

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
  useAgentUiMode: () => ({
    placement: "none",
    setPlacement: vi.fn(),
    floatingEnabled: false,
    setFloatingEnabled: vi.fn(),
    popoutEnabled: false,
    setPopoutEnabled: vi.fn(),
    agentPoppedOut: false,
    setAgentPoppedOut: vi.fn(),
    agentPopoutWin: null,
  }),
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
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true }),
  fetchAgentTools: vi
    .fn()
    .mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));

vi.mock("../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi
    .fn()
    .mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  }),
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
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(), warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../../vertical/useVertical", () => ({
  useVertical: vi.fn(),
}));

vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: 900,
    tokenLoading: false,
    staleSession: false,
    hasActiveToken: true,
  }),
}));

vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

const DEFAULT_VERTICAL_MOCK = {
  vertical: "banking",
  verticalId: "banking",
  setVertical: vi.fn(),
  verticals: [],
};

function renderAgent(props = {}) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent {...props} />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const nlMock = demoAgentNlService;
  nlMock.fetchNlStatus.mockResolvedValue({ groqConfigured: false, geminiConfigured: false });
  const cfgMock = configService;
  cfgMock.loadPublicConfig.mockResolvedValue({});
  const svcMock = demoAgentService;
  svcMock.sendAgentMessage.mockResolvedValue({ success: true, reply: "Done." });
  useVertical.mockReturnValue(DEFAULT_VERTICAL_MOCK);
});

// A step with no runnable trigger reaches handleDemoStepSelect's final
// addMessage — the plainest path, so the test isolates the link attachment.
// UC12 is public (runs signed-out) and has a diagram config.
test("demo step response carries a Diagram link to the step's walkthrough", async () => {
  renderAgent({ isLoggedIn: false });
  // The panel starts collapsed; the dispatch handler opens it and then runs
  // the step after an 80ms defer, so just dispatch and wait for the result.
  await act(async () => {
    window.dispatchEvent(new CustomEvent("agent-demo-step-select", {
      detail: {
        uc: {
          id: "UC12",
          useCaseId: "uc12-dpop",
          title: "Token theft / replay defense",
          auth: "public",
          trigger: { type: "none" },
        },
        stepNumber: 7,
      },
    }));
  });
  const link = await screen.findByTestId("agent-diagram-link-UC12", {}, { timeout: 10000 });
  expect(link).toHaveAttribute("href", "/use-case-diagrams/UC12");
});
