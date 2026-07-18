/**
 * The "Test Wrong Scope" chip calls the real admin-only MCP tool
 * (admin_get_all_users) with a customer token via callMcpTool, which
 * rejects with a scope-denial error carrying requiredScopes/availableScopes/
 * missingScopes (mcpToolPipeline.js's response body, surfaced by
 * demoAgentService.js:436-451). Previously the resulting chat message only
 * showed missingScopes; it now also shows the scopes that were tried
 * (availableScopes) vs. what's actually allowed (requiredScopes).
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

// ─── Mock heavy dependencies (mirrors AIAgent.wrongAudience.test.js) ───────

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
    reset: jest.fn(),
  }),
}));

vi.mock("../../hooks/useAgentRun", () => ({
  useAgentRun: () => ({ run: jest.fn(), abort: jest.fn() }),
}));

import AIAgent from "../AIAgent";
import { callMcpTool } from "../../services/demoAgentService";

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

// The "Test Wrong Scope" chip lives in the collapsed-by-default "Testing"
// action group in the inline left rail (ACTION_GROUPS.testing in
// agentActions.js, rendered via renderActionGroups()/renderChip() and
// dispatched through handleChipActivate → handleActionClick → runAction, the
// same real click-to-runAction path exercised for other chips in
// AIAgent.chips.test.js). Expand the group, then click the chip — this drives
// the real `case "test_wrong_scope"` in AIAgent.js end-to-end.
async function clickWrongScopeChip() {
  renderAgent({ user: customerUser, mode: "inline" });
  const groupHeader = screen.getByRole("button", { name: /Testing/i });
  fireEvent.click(groupHeader);
  const chip = await screen.findByText("Wrong Scope");
  await act(async () => {
    fireEvent.click(chip);
  });
}

beforeEach(() => {
  localStorage.clear();
  // token-event chat messages (the RFC info card this chip renders into) are
  // hidden by default; this persisted setting is the component's own real
  // mechanism for showing them, not a test-only shortcut.
  localStorage.setItem("ba_show_rfc_info", "true");
  callMcpTool.mockReset();
});

describe("Test Wrong Scope chip", () => {
  it("shows both availableScopes (tried) and requiredScopes (allowed) on a scope-denial error", async () => {
    callMcpTool.mockRejectedValue(
      Object.assign(new Error("MCP tool access denied: insufficient scope"), {
        code: "mcp_scope_denied",
        statusCode: 403,
        tool: "admin_get_all_users",
        requiredScopes: ["admin"],
        availableScopes: ["read", "write"],
        missingScopes: ["admin"],
      }),
    );

    await clickWrongScopeChip();

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Gateway correctly rejected/i);
    });
    expect(document.body.textContent).toContain("read, write");
    expect(document.body.textContent).toContain("admin");
  });

  it("does not crash and still reports the denial when availableScopes is absent", async () => {
    callMcpTool.mockRejectedValue(
      Object.assign(new Error("MCP tool access denied: insufficient scope"), {
        code: "mcp_scope_denied",
        statusCode: 403,
        tool: "admin_get_all_users",
        requiredScopes: ["admin"],
        missingScopes: ["admin"],
        // availableScopes intentionally absent
      }),
    );

    await clickWrongScopeChip();

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Gateway correctly rejected/i);
    });
  });
});
