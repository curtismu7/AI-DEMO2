/**
 * Path A (api_key disposition) placeholder actions must reach runAction.
 *
 * `gear_warranty_demo` (sporting-goods), `mortgage_demo` (banking),
 * `invest_demo` and `vertical_feature_demo` are NOT MCP tools — each is a
 * placeholder whose only implementation is AIAgent's runAction case, which
 * swaps in the vertical's real feature tool (gear_warranty_demo ->
 * show_gear_warranty). dispatchNlResult's kind:"vertical" branch used to
 * re-dispatch every non-banking action to /api/agent/invoke, so the server was
 * asked for a tool literally named `gear_warranty_demo` and answered
 * "Error: unknown tool: gear_warranty_demo" — observed live on
 * ai-demo.ping-devops.com 2026-09-08 for UC33 in sporting-goods.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({
    preset: { shortName: "Super Sports", name: "Super Sports" },
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
    source: "heuristic",
    result: {
      kind: "vertical",
      vertical: "sporting-goods",
      action: "gear_warranty_demo",
      params: {},
    },
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
  callMcpTool: vi.fn().mockResolvedValue({ success: true, result: { warranty: {} } }),
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true, reply: "Done." }),
  fetchAgentTools: vi
    .fn()
    .mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
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
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    warning: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

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
    },
    handlers: {},
    reset: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }),
}));

import AIAgent from "../AIAgent";
import { callMcpTool, sendAgentMessage } from "../../services/demoAgentService";

const customerUser = {
  id: "u1",
  role: "customer",
  email: "user@test.com",
  username: "demoUser",
  firstName: "Test",
  lastName: "User",
};

// AIAgent calls /api/demo-agent/nl with a raw fetch (AIAgent.js:8309), not
// through demoAgentNlService — so the routing result has to be stubbed here.
const NL_VERTICAL_RESULT = {
  source: "heuristic",
  result: {
    kind: "vertical",
    vertical: "sporting-goods",
    action: "gear_warranty_demo",
    params: {},
  },
};

beforeEach(() => {
  localStorage.clear();
  callMcpTool.mockClear();
  sendAgentMessage.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const u = String(url);
      const body = u.includes("/api/demo-agent/nl") ? NL_VERTICAL_RESULT : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client-dispatched vertical actions (Path A placeholders)", () => {
  it("routes gear_warranty_demo to runAction, which calls the real show_gear_warranty tool", async () => {
    const { container } = render(
      <MemoryRouter>
        <ActivityNarrativeProvider>
          <ProofOfEnforcementProvider>
            <AIAgent user={customerUser} mode="inline" />
          </ProofOfEnforcementProvider>
        </ActivityNarrativeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(container.querySelector("input.ba-input")).toBeTruthy());
    const input = container.querySelector("input.ba-input");
    await act(async () => {
      fireEvent.change(input, { target: { value: "show my gear warranty" } });
    });
    await act(async () => {
      fireEvent.click(container.querySelector("button.ba-send-btn"));
    });

    await waitFor(() => {
      expect(callMcpTool).toHaveBeenCalledWith(
        "show_gear_warranty",
        {},
        expect.objectContaining({ vertical: "sporting-goods" }),
      );
    });
    // The placeholder name must never be handed to the server as a tool.
    const sentTools = sendAgentMessage.mock.calls.map((c) => String(c[0]));
    expect(sentTools.some((m) => m.includes("gear_warranty_demo"))).toBe(false);
  });
});
