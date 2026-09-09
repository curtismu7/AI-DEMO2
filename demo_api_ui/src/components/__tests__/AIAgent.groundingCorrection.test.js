/* eslint-disable testing-library/no-node-access */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

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
  parseNaturalLanguage: vi.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
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
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

let mockGroundingCorrection = null;

vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [],
      toolCalls: [],
      tokenEvents: [],
      mcpTraffic: [],
      authorizeDecisions: [],
      lastTokenUsage: null,
      lastOutcome: null,
      hitlPending: null,
      error: null,
      lastGroundingCorrection: mockGroundingCorrection,
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }),
}));

import AIAgent from "../AIAgent";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

function renderAgent(props = {}) {
  return render(
    <MemoryRouter>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent {...props} />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockGroundingCorrection = null;
});

describe("grounding correction surfaces in chat", () => {
  it("renders a token-event bubble when lastGroundingCorrection is set", async () => {
    mockGroundingCorrection = {
      original: "I've waived your fee!",
      corrected: "I've submitted a fee waiver request (ID: fwr-123) for human review.",
      correctionNote: "overclaim",
    };
    // token-event bubbles are gated behind the "Show RFC info" toggle
    // (same gate every other attack-outcome token-event bubble in this file
    // uses); opt in so the correction bubble is visible for this assertion.
    localStorage.setItem("ba_show_rfc_info", "true");
    renderAgent({ user: customerUser, mode: "inline" });
    await waitFor(() => {
      expect(screen.getByText(/fwr-123/i)).toBeInTheDocument();
    });
  });

  it("renders nothing extra when there is no correction", async () => {
    renderAgent({ user: customerUser, mode: "inline" });
    await waitFor(() => {
      expect(screen.queryByText(/correction/i)).not.toBeInTheDocument();
    });
  });
});
