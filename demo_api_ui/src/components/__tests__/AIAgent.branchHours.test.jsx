/**
 * Task 6 regression coverage.
 *
 * The NL heuristic parser resolves "branches near me" / "clinics near me" /
 * "stores near me" (cross-vertical UC24 public catalog) to action
 * `branch_hours`, but runAction had no case for it, so this prompt threw
 * "Unknown action: branch_hours" in EVERY vertical. This proves the fix end
 * to end for real: /nl resolves the banking action, runAction's new
 * `branch_hours` case calls sendAgentMessage (the same dispatch shape as the
 * already-working `weather` action), and the raw `.branches`/`.publicCatalog`
 * response renders as location cards via ProductCardGrid kind="locations".
 *
 * Boilerplate copied from AIAgent.groundedAnswers.test.js, the sibling file
 * that already drives a `kind: "banking", banking: { action: "weather" }` NL
 * response through the real typed-prompt path.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

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
  parseNaturalLanguage: jest.fn().mockResolvedValue({ source: "local", result: { kind: "none" } }),
}));

const sendAgentMessage = vi.fn();
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
  sendAgentMessage: (...args) => sendAgentMessage(...args),
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

vi.mock("../../hooks/useAgentState", () => ({
  useAgentState: () => ({
    state: {
      messages: [], toolCalls: [], tokenEvents: [], mcpTraffic: [],
      authorizeDecisions: [], lastTokenUsage: null, lastOutcome: null,
      hitlPending: null, error: null,
    },
    handlers: {},
    reset: jest.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: jest.fn(), abort: jest.fn() }),
}));

const bffGet = vi.fn();
vi.mock("../../services/bffAxios", () => ({
  default: {
    get: (...args) => bffGet(...args),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

// Vertical is overridden per-test via forceVertical prop; the mock returns
// whichever manifest matches so banking, healthcare, and sporting-goods all
// resolve through the same NL/runAction plumbing under test.
let mockActiveId = "banking";
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: mockActiveId,
    pageManifest: { id: mockActiveId, identity: { displayName: "Test Vertical" } },
    agentManifest: { id: mockActiveId, identity: { displayName: "Test Vertical" } },
    adminManifest: null,
    pageMockData: null,
    isAdminScope: false,
    isAdmin: false,
    refetch: () => {},
  }),
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

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  localStorage.clear();
  mockActiveId = "banking";
  bffGet.mockReset();
  bffGet.mockResolvedValue({ data: {} });
  sendAgentMessage.mockReset();
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes("/api/demo-agent/nl")) {
      // The NL heuristic resolves any "<location noun> near me" phrasing to
      // the cross-vertical banking action branch_hours regardless of which
      // vertical is active (nlIntentParser.js / config/verticals/*/index.js).
      return jsonResponse({
        source: "heuristic",
        result: { kind: "banking", banking: { action: "branch_hours", params: {} } },
      });
    }
    return jsonResponse({});
  });
});

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

async function ask(text, vertical) {
  mockActiveId = vertical;
  renderAgent({ user: customerUser, mode: "inline", forceVertical: vertical });
  const input = await screen.findByPlaceholderText(/Message .* AI/i);
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

const BRANCH_RESPONSE = {
  success: true,
  reply: "Here are locations near you.",
  publicCatalog: true,
  branches: [
    { id: "b1", name: "Test Branch", city: "Austin", state: "TX", address: "1 Main St", hours: "9-5", atm: true },
  ],
};

describe("branch_hours dispatches through runAction and renders location cards", () => {
  it("no longer throws Unknown action: branch_hours, and renders the location card (banking)", async () => {
    sendAgentMessage.mockResolvedValue(BRANCH_RESPONSE);

    await ask("branches near me", "banking");

    await waitFor(() => {
      expect(screen.getByText("Test Branch")).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("Unknown action");
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "branches near me",
      null,
      expect.objectContaining({ forceHeuristic: true, vertical: "banking" }),
    );
  });

  it.each([
    ["clinics near me", "healthcare"],
    ["stores near me", "sporting-goods"],
  ])("renders location cards for %s in the %s vertical too", async (text, vertical) => {
    sendAgentMessage.mockResolvedValue(BRANCH_RESPONSE);

    await ask(text, vertical);

    await waitFor(() => {
      expect(screen.getByText("Test Branch")).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain("Unknown action");
    expect(sendAgentMessage).toHaveBeenCalledWith(
      text,
      null,
      expect.objectContaining({ forceHeuristic: true, vertical }),
    );
  });
});
