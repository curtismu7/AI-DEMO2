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

// The brand is only available client-side, from the manifest the
// VerticalProvider already loaded. `mockManifest = null` reproduces a vertical
// whose manifest carries no identity.displayName.
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
  mockManifest = { id: "healthcare", identity: { displayName: "CareConnect" } };
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
  it("names the brand and vertical and explains the refusal instead of failing silently", async () => {
    await askUnroutablePrompt();
    await waitFor(() => {
      expect(screen.getByText(/No matching action in/)).toBeInTheDocument();
    });
    expect(document.querySelector(".ba-nomatch-head")).toHaveTextContent(
      "No matching action in CareConnect (Healthcare)",
    );
    expect(
      screen.getByText(/will not answer it using another vertical's data/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Intents considered")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("names the vertical alone when the manifest carries no brand", async () => {
    mockManifest = { id: "healthcare" };
    await askUnroutablePrompt();
    await waitFor(() => {
      expect(screen.getByText(/No matching action in/)).toBeInTheDocument();
    });
    const head = document.querySelector(".ba-nomatch-head");
    expect(head).toHaveTextContent("No matching action in Healthcare");
    expect(head.textContent).not.toMatch(/[()]|undefined|null/);
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
