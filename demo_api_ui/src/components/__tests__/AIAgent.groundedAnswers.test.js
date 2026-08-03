/**
 * Option C wiring in the agent panel.
 *
 * The BFF decides what is attributable; this file proves the panel HONOURS that
 * decision — that the model's prose is not what reaches the screen when a
 * grounded answer is present, and that zero grounded claims degrades to the
 * Option A no-match card instead of a hedged paragraph.
 *
 * Mock set mirrors AIAgent.noMatch.test.js. The turn is driven through the real
 * typed-prompt path: /nl resolves a banking action, the panel calls the agent,
 * and the response carries `groundedAnswer`.
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

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

/** The unattributable sentence the model produced. It must never be rendered. */
const FABRICATED = "Your pending refund is $6,750.00.";

const NO_MATCH_BODY = {
  chips: [],
  verticalId: "banking",
  isFallback: true,
  detectionMethod: "none",
  noMatch: true,
  intentsConsidered: 8,
  suggestions: [
    { id: "b1", label: "Check my balance", message: "check my balance", tool: "get_account_balance" },
  ],
  message: "No banking action matched that request. 8 intents were considered and none matched.",
};

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  localStorage.clear();
  bffGet.mockReset();
  bffGet.mockResolvedValue({ data: NO_MATCH_BODY });
  sendAgentMessage.mockReset();
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes("/api/demo-agent/nl")) {
      // Resolves to a banking action whose handler awaits the agent call, so the
      // grounded response is handled inside the click instead of on a timer.
      return jsonResponse({
        source: "heuristic",
        result: { kind: "banking", banking: { action: "weather", params: { city_name: "Paris" } } },
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

async function ask() {
  renderAgent({ user: customerUser, mode: "inline", forceVertical: "banking" });
  const input = await screen.findByPlaceholderText(/Message .* AI/i);
  fireEvent.change(input, { target: { value: "what is my balance" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

describe("grounded answer rendering", () => {
  it("renders the grounded claims with their source tool and scope", async () => {
    sendAgentMessage.mockResolvedValue({
      success: true,
      reply: `Your balance is $1,234.50. ${FABRICATED}`,
      groundedAnswer: {
        grounded: true,
        claims: [
          {
            text: "Your balance is $1,234.50.",
            sources: [{ tool: "get_account_balance", scope: "read" }],
          },
        ],
        droppedCount: 1,
        droppedReasons: { no_verifiable_value: 0, unattributable_value: 1 },
      },
    });

    await ask();

    await waitFor(() => {
      expect(screen.getByText("Your balance is $1,234.50.")).toBeInTheDocument();
    });
    expect(screen.getByText("get_account_balance")).toBeInTheDocument();
    expect(screen.getByText("scope: read")).toBeInTheDocument();
  });

  it("NEVER renders the model sentence the server could not attribute", async () => {
    sendAgentMessage.mockResolvedValue({
      success: true,
      reply: `Your balance is $1,234.50. ${FABRICATED}`,
      groundedAnswer: {
        grounded: true,
        claims: [
          {
            text: "Your balance is $1,234.50.",
            sources: [{ tool: "get_account_balance", scope: "read" }],
          },
        ],
        droppedCount: 1,
        droppedReasons: { no_verifiable_value: 0, unattributable_value: 1 },
      },
    });

    await ask();

    await waitFor(() => {
      expect(screen.getByText("Your balance is $1,234.50.")).toBeInTheDocument();
    });
    // The fabricated figure must be absent from the entire rendered document,
    // not merely from the claim list.
    expect(document.body.textContent).not.toContain("6,750");
    expect(screen.getByText(/1 statement was dropped/)).toBeInTheDocument();
  });

  it("degrades to the Option A no-match card when nothing grounded", async () => {
    sendAgentMessage.mockResolvedValue({
      success: true,
      reply: "You are doing great financially and should have plenty of room this month.",
      groundedAnswer: {
        grounded: false,
        claims: [],
        droppedCount: 1,
        droppedReasons: { no_verifiable_value: 1, unattributable_value: 0 },
      },
    });

    await ask();

    await waitFor(() => {
      expect(screen.getByText(/No verified answer in/)).toBeInTheDocument();
    });
    expect(document.querySelector(".ba-nomatch-head")).toHaveTextContent(
      "No verified answer in Super Banking (Banking)",
    );
    // Routing SUCCEEDED here — only grounding failed. Claiming otherwise would
    // misdescribe the turn, which is the failure this feature removes.
    expect(document.body.textContent).not.toContain("No matching action");
    expect(screen.getByText("Statements dropped")).toBeInTheDocument();
    // The hedged paragraph is the thing Option C exists to prevent.
    expect(document.body.textContent).not.toContain("doing great financially");
    expect(document.querySelector(".ba-grounded-card")).toBeNull();
  });

  it("still degrades to the card when the no-match lookup returns no detail", async () => {
    // The usual case: the prompt DID route, so /api/fallback/chips reports a
    // match and fetchNoMatch answers null. The card must still name the vertical
    // from what the page knows, and must omit what the server did not send.
    bffGet.mockResolvedValue({ data: { chips: [{ id: "c1" }], verticalId: "banking" } });
    sendAgentMessage.mockResolvedValue({
      success: true,
      reply: "You are doing great financially.",
      groundedAnswer: { grounded: false, claims: [], droppedCount: 1, droppedReasons: {} },
    });

    await ask();

    await waitFor(() => {
      expect(screen.getByText(/No verified answer in/)).toBeInTheDocument();
    });
    expect(screen.queryByText("Intents considered")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("doing great financially");
  });

  it("leaves the reply untouched when the server sent no groundedAnswer (flag OFF)", async () => {
    sendAgentMessage.mockResolvedValue({
      success: true,
      reply: `Your balance is $1,234.50. ${FABRICATED}`,
    });

    await ask();

    await waitFor(() => {
      expect(document.body.textContent).toContain("6,750");
    });
    expect(document.querySelector(".ba-grounded-card")).toBeNull();
    expect(document.querySelector(".ba-nomatch-head")).toBeNull();
  });
});
