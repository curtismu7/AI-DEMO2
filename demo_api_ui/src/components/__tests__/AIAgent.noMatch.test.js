/**
 * PR #1214 added a structured no-match result to GET /api/fallback/chips but
 * nothing rendered it. These tests drive the real typed-prompt path: /nl answers
 * kind:'none', the agent asks the BFF for the no-match detail, and the card must
 * appear with the active vertical named and that vertical's own suggestions —
 * which must dispatch back through the NL pipeline when clicked.
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

import AIAgent from "../AIAgent";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "bankUser",
  firstName: "Test",
  lastName: "User",
};

const NO_MATCH_BODY = {
  chips: [],
  verticalId: "healthcare",
  isFallback: true,
  detectionMethod: "none",
  noMatch: true,
  intentsConsidered: 8,
  suggestions: [
    { id: "hc1", label: "View my care plan", message: "show my care plan", tool: "care_plan" },
    { id: "hc2", label: "Book an appointment", message: "book an appointment", tool: "book_appt" },
  ],
  message:
    "No healthcare action matched that request. 8 intents were considered and none matched.",
};

let nlCalls = [];

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  localStorage.clear();
  nlCalls = [];
  bffGet.mockReset();
  bffGet.mockResolvedValue({ data: NO_MATCH_BODY });
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    if (u.includes("/api/demo-agent/nl")) {
      nlCalls.push(JSON.parse(opts.body));
      return jsonResponse({
        result: { kind: "none", message: "Heuristics could not route that." },
        source: "heuristic",
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

async function askUnroutablePrompt() {
  renderAgent({ user: customerUser, mode: "inline", forceVertical: "healthcare" });
  const input = await screen.findByPlaceholderText(/Message .* AI/i);
  fireEvent.change(input, { target: { value: "book me a flight to Paris" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

describe("no-match response rendering", () => {
  it("names the active vertical and explains the refusal instead of failing silently", async () => {
    await askUnroutablePrompt();
    await waitFor(() => {
      expect(screen.getByText(/No matching action in Healthcare/)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/will not answer it using another vertical's data/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Intents considered")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("asks the BFF for the active vertical's no-match detail", async () => {
    await askUnroutablePrompt();
    await waitFor(() => expect(bffGet).toHaveBeenCalled());
    expect(bffGet).toHaveBeenCalledWith("/api/fallback/chips", {
      params: { prompt: "book me a flight to Paris", verticalId: "healthcare" },
    });
  });

  it("dispatches the clicked suggestion back through the NL pipeline", async () => {
    await askUnroutablePrompt();
    const chip = await screen.findByRole("button", { name: "Book an appointment" });
    await act(async () => {
      fireEvent.click(chip);
    });
    await waitFor(() => {
      expect(nlCalls.some((c) => c.message === "book an appointment")).toBe(true);
    });
  });

  it("keeps the plain-text reply when the no-match lookup fails", async () => {
    bffGet.mockRejectedValue(new Error("network down"));
    await askUnroutablePrompt();
    await waitFor(() => {
      expect(screen.getByText(/Heuristics could not route that\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/No matching action in/)).not.toBeInTheDocument();
  });
});
