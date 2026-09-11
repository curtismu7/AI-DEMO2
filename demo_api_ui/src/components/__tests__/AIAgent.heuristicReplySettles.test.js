/**
 * The Agent request flow panel seeds "You → Agent" + a pending "Agent → You" for
 * every typed prompt (agentFlowDiagram.startLlmReasoning). Only the AG-UI path
 * (useAgentRun) settled that reply, so a prompt answered by the heuristics path
 * (/api/demo-agent/nl) left "Agent → You" pending forever — seen live on a
 * "Which account…?" clarification. These drive the real typed-prompt path and
 * assert the reply settles: done once the answer is shown, error when /nl fails.
 * Harness mirrors AIAgent.noMatch.test.js; the flow-diagram service is real.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import { agentFlowDiagram } from "../../services/agentFlowDiagramService";

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

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    activeId: "healthcare",
    pageManifest: { id: "healthcare", identity: { displayName: "CareConnect" } },
    agentManifest: { id: "healthcare", identity: { displayName: "CareConnect" } },
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

const replyStatus = () =>
  agentFlowDiagram.getState().steps.find((s) => s.id === "reply")?.status;
const promptText = () =>
  agentFlowDiagram.getState().steps.find((s) => s.id === "prompt")?.detail;

beforeEach(() => {
  localStorage.clear();
  agentFlowDiagram.reset();
  bffGet.mockReset();
  bffGet.mockResolvedValue({ data: { chips: [], suggestions: [], noMatch: true } });
});

function renderAgent() {
  render(
    <MemoryRouter>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <AIAgent user={customerUser} mode="inline" forceVertical="healthcare" />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>,
  );
}

async function typeAndSend(text) {
  const input = await screen.findByPlaceholderText(/Message .* AI/i);
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

describe("flow panel reply step on the heuristics path", () => {
  it("settles the reply once the heuristics answer is shown", async () => {
    global.fetch = vi.fn((url) =>
      String(url).includes("/api/demo-agent/nl")
        ? jsonResponse({ result: { kind: "none", message: "Heuristics could not route that." }, source: "heuristic" })
        : jsonResponse({}),
    );
    renderAgent();
    await typeAndSend("book me a flight to Paris");
    await waitFor(() => {
      expect(screen.getByText(/Heuristics could not route that\.|No matching action in/)).toBeInTheDocument();
    });
    expect(agentFlowDiagram.getState().steps.map((s) => s.id)).toContain("prompt");
    await waitFor(() => expect(replyStatus()).toBe("done"));
  });

  it("marks the reply failed when the heuristics request fails", async () => {
    global.fetch = vi.fn((url) =>
      String(url).includes("/api/demo-agent/nl")
        ? Promise.reject(new Error("network down"))
        : jsonResponse({}),
    );
    renderAgent();
    await typeAndSend("book me a flight to Paris");
    await waitFor(() => expect(replyStatus()).toBe("error"));
  });

  // Greptile P1 on #3137: answering a clarification ("checking" after "Which
  // account…?") dispatched without starting a new flow turn, so the panel stayed
  // on the previous prompt and this turn's reply never showed.
  it("starts and settles a new turn when the user answers a clarification", async () => {
    global.fetch = vi.fn((url) =>
      String(url).includes("/api/demo-agent/nl")
        ? jsonResponse({ result: { kind: "banking", banking: { action: "balance", params: {} } }, source: "heuristic" })
        : jsonResponse({}),
    );
    renderAgent();
    await typeAndSend("show my balance");
    await screen.findByText(/Which account would you like to check the balance for\?/i);
    await waitFor(() => expect(replyStatus()).toBe("done"));

    await typeAndSend("checking");

    await waitFor(() => expect(promptText()).toBe("checking"));
    await waitFor(() => expect(replyStatus()).toBe("done"));
  });
});
