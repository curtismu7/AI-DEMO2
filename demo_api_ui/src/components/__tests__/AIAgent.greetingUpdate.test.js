/**
 * Tests that the agent greeting is replaced with the vertical manifest greeting
 * when themeAgent resolves asynchronously after the initial render.
 *
 * Regression: Great Buy vertical showed "I can check your balances, move money
 * between accounts…" (banking default) because the manifest loaded after the
 * user prop arrived, and the prev.length===0 guard prevented the update.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "demoUser",
  firstName: "Demo",
};

// Shared mock state so tests can change the resolved agent manifest between
// renders. The component reads the agent manifest from useVertical()
// (agentManifest.agent), so the mock targets that — the legacy ThemeContext
// was removed in the verticals cutover (3b9ec054).
let mockThemeAgent = null;

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "test",
    pageManifest: mockThemeAgent ? { agent: mockThemeAgent, terminology: {}, id: "test" } : null,
    agentManifest: mockThemeAgent ? { agent: mockThemeAgent } : null,
    pageMockData: null,
    isAdmin: false,
    isAdminScope: false,
    refetch: jest.fn(),
  }),
}));

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Great Buy", name: "Great Buy" } }),
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
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: jest.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: jest.fn().mockResolvedValue({ source: "local", result: { kind: "action", action: { id: "accounts" } } }),
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
  sendAgentMessage: jest.fn().mockResolvedValue({ success: true }),
  // Scope-picker effect (AIAgent.js) calls fetchAgentTools on mount — mock it so
  // the effect doesn't throw "No fetchAgentTools export" and abort the render.
  fetchAgentTools: jest.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({
  loadPublicConfig: jest.fn().mockResolvedValue({}),
}));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: jest.fn(() => false),
  setAgentBlockedByConsentDecline: jest.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked.",
  getConsentState: jest.fn(() => null),
  setConsentDeclined: jest.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: jest.fn(() => []) }));
vi.mock("react-toastify", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
vi.mock("../../utils/appToast", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), warning: jest.fn(), update: jest.fn(), dismiss: jest.fn() },
  notifySuccess: jest.fn(), notifyError: jest.fn(), notifyInfo: jest.fn(), notifyWarning: jest.fn(),
}));
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

function renderAgent(props = {}) {
  return render(<MemoryRouter><ProofOfEnforcementProvider><ActivityNarrativeProvider><AIAgent {...props} /></ActivityNarrativeProvider></ProofOfEnforcementProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  mockThemeAgent = null;
  jest.resetModules();
});

test("greeting updates to vertical manifest greeting when themeAgent resolves after initial render", () => {
  // First render: manifest not yet loaded (themeAgent = null) → banking default
  const { rerender } = renderAgent({ user: customerUser, mode: "inline" });
  expect(screen.getByText(/your ai assistant/i)).toBeInTheDocument();

  // Simulate manifest arriving: set themeAgent and re-render
  mockThemeAgent = { greeting: "Hi {name}! Browse our products. What would you like to do?" };
  rerender(<MemoryRouter><ProofOfEnforcementProvider><ActivityNarrativeProvider><AIAgent user={customerUser} mode="inline" /></ActivityNarrativeProvider></ProofOfEnforcementProvider></MemoryRouter>);

  expect(screen.getByText(/browse our products/i)).toBeInTheDocument();
  expect(screen.queryByText(/check your balances/i)).not.toBeInTheDocument();
});
