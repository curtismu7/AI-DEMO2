/* eslint-disable testing-library/no-node-access */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Banking", name: "Super Banking" },
  }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: jest.fn() }),
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
  fetchNlStatus: jest.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: jest.fn().mockResolvedValue({
    source: "local",
    result: { kind: "action", action: { id: "accounts" } },
  }),
}));
vi.mock("../../services/demoAgentService", () => ({
  getMyAccounts: jest.fn().mockResolvedValue([]),
  getAccountBalance: jest.fn().mockResolvedValue({ balance: 100 }),
  getMyTransactions: jest.fn().mockResolvedValue([]),
  createTransfer: jest.fn().mockResolvedValue({ success: true }),
  createDeposit: jest.fn().mockResolvedValue({ success: true }),
  createWithdrawal: jest.fn().mockResolvedValue({ success: true }),
  refreshOAuthSession: jest.fn().mockResolvedValue({}),
  warmupAuthz: jest.fn().mockResolvedValue({}),
  callMcpTool: jest.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: jest.fn().mockResolvedValue({ success: true, reply: "Done." }),
  fetchAgentTools: jest.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({
  loadPublicConfig: jest.fn().mockResolvedValue({}),
}));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: jest.fn(() => false),
  setAgentBlockedByConsentDecline: jest.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked by consent decline.",
  getConsentState: jest.fn(() => null),
  setConsentDeclined: jest.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({
  getToolStepsForAction: jest.fn(() => []),
}));
vi.mock("react-toastify", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: {
    info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(),
    warning: jest.fn(), update: jest.fn(), dismiss: jest.fn(),
  },
  notifySuccess: jest.fn(),
  notifyError: jest.fn(),
  notifyInfo: jest.fn(),
  notifyWarning: jest.fn(),
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
    reset: jest.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: jest.fn(), abort: jest.fn() }),
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
        <AIAgent {...props} />
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
