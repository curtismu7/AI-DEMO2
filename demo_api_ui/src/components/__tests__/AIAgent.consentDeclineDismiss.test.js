/**
 * Declining high-value consent used to render a permanent red banner: the agent
 * stayed disabled with no in-app way back — the copy said "sign out and sign in
 * again", and in practice only a browser reload cleared it (the mount effect
 * calls setAgentBlockedByConsentDecline(false)). The notice is now a dismissable
 * modal whose dismiss clears the block, so the session is never a dead end.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import { setAgentBlockedByConsentDecline } from "../../services/agentAccessConsent";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "demoUser",
  firstName: "Demo",
};

// Flipped between renders to simulate the decline landing while the agent is
// mounted — the component only re-reads the flag on its change event.
let mockBlocked = false;

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "test",
    pageManifest: null,
    agentManifest: null,
    pageMockData: null,
    isAdmin: false,
    isAdminScope: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Banking", name: "Super Banking" } }),
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
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({ source: "local", result: { kind: "action", action: { id: "accounts" } } }),
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
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => mockBlocked),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: vi.fn(() => []) }));
vi.mock("react-toastify", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../utils/appToast", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(), warning: vi.fn(), update: vi.fn(), dismiss: vi.fn() },
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(),
}));
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

function renderAgent(props = {}) {
  return render(<MemoryRouter><ProofOfEnforcementProvider><ActivityNarrativeProvider><AIAgent {...props} /></ActivityNarrativeProvider></ProofOfEnforcementProvider></MemoryRouter>);
}

/** The decline is announced by an event; the agent re-reads the flag from it. */
function declineHighValueConsent() {
  mockBlocked = true;
  act(() => {
    window.dispatchEvent(new CustomEvent("bankingAgentConsentBlockChanged"));
  });
}

beforeEach(() => {
  localStorage.clear();
  mockBlocked = false;
  vi.clearAllMocks();
});

test("the consent-decline notice can be dismissed, which unblocks the agent", () => {
  renderAgent({ user: customerUser, mode: "inline" });
  expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();

  declineHighValueConsent();
  expect(screen.getByText(/access denied/i)).toBeInTheDocument();

  // The mount effect also clears the flag, so count the clears rather than
  // asserting "called with false" — that would pass without any dismiss button.
  const clearsBefore = setAgentBlockedByConsentDecline.mock.calls.filter(
    ([blocked]) => blocked === false,
  ).length;
  fireEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
  const clearsAfter = setAgentBlockedByConsentDecline.mock.calls.filter(
    ([blocked]) => blocked === false,
  ).length;

  expect(clearsAfter).toBe(clearsBefore + 1);
});
