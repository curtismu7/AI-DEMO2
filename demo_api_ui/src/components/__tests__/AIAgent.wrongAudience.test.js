/**
 * Regression: the "Test Wrong Audience" chip called the old, broken
 * `/api/mcp/tool` + `_testAudience` path, which never exercised a real RFC
 * 8693 token exchange and always reported success. It now calls the real
 * wrong-audience attack simulator at `POST /api/demo/attack-sim/run`
 * (`{sim: "wrong-aud"}`) and shows both the audience that was tried and the
 * audience the gateway actually expects (triedAudience / allowedAudience),
 * distinguishing the invalid_aud / unexpected_permit outcomes rather than
 * collapsing them into a single rejected/not-rejected message.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";

// ─── Mock heavy dependencies (mirrors AIAgent.aguiError.test.js) ────────────

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

// The "Test Wrong Audience" chip lives in the collapsed-by-default "Testing"
// action group in the inline left rail (ACTION_GROUPS.testing in
// agentActions.js, rendered via renderActionGroups()/renderChip() and
// dispatched through handleChipActivate → handleActionClick → runAction, the
// same real click-to-runAction path exercised for other chips in
// AIAgent.chips.test.js). Expand the group, then click the chip — this drives
// the real `case "test_wrong_audience"` in AIAgent.js end-to-end.
async function clickWrongAudienceChip() {
  renderAgent({ user: customerUser, mode: "inline" });
  const groupHeader = screen.getByRole("button", { name: /Testing/i });
  fireEvent.click(groupHeader);
  const chip = await screen.findByText("Wrong Audience");
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
});

describe("Test Wrong Audience chip", () => {
  it("calls /api/demo/attack-sim/run with {sim: \"wrong-aud\"}, not /api/mcp/tool", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 403,
      json: async () => ({
        sim: "wrong-aud",
        status: 403,
        errorCode: "invalid_aud",
        reason: "aud mismatch",
        triedAudience: "https://tried.example.com",
        allowedAudience: "https://allowed.example.com",
      }),
    });

    await clickWrongAudienceChip();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const call = global.fetch.mock.calls.find((c) =>
      String(c[0]).includes("/api/demo/attack-sim/run"),
    );
    expect(call).toBeTruthy();
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ sim: "wrong-aud" });
    expect(
      global.fetch.mock.calls.some((c) => String(c[0]).includes("/api/mcp/tool")),
    ).toBe(false);
  });

  it("shows both triedAudience and allowedAudience for an invalid_aud deny response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 403,
      json: async () => ({
        sim: "wrong-aud",
        status: 403,
        errorCode: "invalid_aud",
        reason: "Gateway rejected mismatched audience",
        triedAudience: "https://tried.example.com",
        allowedAudience: "https://allowed.example.com",
      }),
    });

    await clickWrongAudienceChip();

    await waitFor(() => {
      expect(document.body.textContent).toContain('aud="https://tried.example.com"');
      expect(document.body.textContent).toContain('aud="https://allowed.example.com"');
    });
    expect(document.body.textContent).toMatch(/Gateway correctly rejected/i);
  });

  it("reflects an unexpected_permit response distinctly from the deny case", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        sim: "wrong-aud",
        status: 200,
        errorCode: "unexpected_permit",
        reason: "Gateway permitted the wrong-audience token",
        triedAudience: "https://tried.example.com",
        allowedAudience: "https://allowed.example.com",
      }),
    });

    await clickWrongAudienceChip();

    await waitFor(() => {
      expect(document.body.textContent).toMatch(
        /permitted a wrong-audience token/i,
      );
    });
    expect(document.body.textContent).not.toMatch(/Gateway correctly rejected/i);
  });
});
