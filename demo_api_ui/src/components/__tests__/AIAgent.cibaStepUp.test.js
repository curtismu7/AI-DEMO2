/**
 * runAction's mcp_step_up_required catch must branch on step_up_method.
 *
 * callMcpTool THROWS on mcp_step_up_required (HITL soft-resolves; step-up does
 * not), so this catch is the chip/runAction equivalent of the soft path's
 * normalized.step_up_method switch. It previously ran the P1MFA challenge for
 * every step-up, including UC22 / the bk-ciba chip, which declare 'ciba'.
 * MFA and CIBA both set session.stepUpVerified, so the MFA modal satisfying a
 * CIBA-required gate let the retry PERMIT with no out-of-band approval.
 *
 * The discriminator asserted here is the next network call the UI makes:
 *   ciba  -> POST /api/auth/ciba/initiate, and never /api/auth/mfa/challenge
 *   p1mfa -> POST /api/auth/mfa/challenge, and never /api/auth/ciba/initiate
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


// "Account nickname" is a plain callMcpTool chip (no form), dispatched through
// the same handleChipActivate -> handleActionClick -> runAction path the other
// chip tests use — see AIAgent.chips.test.js's get_account_nickname test.
async function clickMcpChip() {
  renderAgent({ user: customerUser, mode: "inline" });
  await act(async () => {
    fireEvent.click(screen.getByText("Account nickname"));
  });
}

function stepUpError(method) {
  return Object.assign(new Error("Step-up required"), {
    code: "mcp_step_up_required",
    statusCode: 428,
    step_up_method: method,
    step_up_acr: "urn:acr:ciba",
    transaction_amount: 600,
    fromAccountId: "acct-from",
    toAccountId: "acct-to",
    hitlChallengeId: "challenge-ciba-1",
  });
}

let fetchCalls;
let fetchBodies;

beforeEach(() => {
  localStorage.clear();
  callMcpTool.mockReset();
  fetchCalls = [];
  fetchBodies = [];
  vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn() });
  global.fetch = vi.fn((url, options = {}) => {
    fetchCalls.push(String(url));
    fetchBodies.push(options.body ? JSON.parse(options.body) : null);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ auth_req_id: "req-1", interval: 5, daId: "da-1", devices: [] }),
    });
  });
});

// NOTE: no vi.restoreAllMocks() here — it also resets the module-level vi.mock
// implementations above (fetchAgentTools would return undefined and the mount
// effect at AIAgent.js:1562 throws on .then). beforeEach re-installs both stubs.

const called = (fragment) => fetchCalls.some((u) => u.includes(fragment));

describe("runAction mcp_step_up_required — CIBA vs MFA", () => {
  it("step_up_method 'ciba' starts CIBA and never calls the MFA challenge", async () => {
    callMcpTool.mockRejectedValue(stepUpError("ciba"));
    await clickMcpChip();

    await waitFor(() => expect(called("/api/auth/ciba/initiate")).toBe(true));
    const cibaCallIndex = fetchCalls.findIndex((url) => url.includes("/api/auth/ciba/initiate"));
    expect(fetchBodies[cibaCallIndex]).toMatchObject({ hitl_challenge_id: "challenge-ciba-1" });
    expect(called("/api/auth/mfa/challenge")).toBe(false);
  });

  it("step_up_method 'p1mfa' still runs the MFA challenge and never starts CIBA", async () => {
    callMcpTool.mockRejectedValue(stepUpError("p1mfa"));
    await clickMcpChip();

    await waitFor(() => expect(called("/api/auth/mfa/challenge")).toBe(true));
    expect(called("/api/auth/ciba/initiate")).toBe(false);
  });

  it("an unspecified step_up_method keeps the prior MFA default", async () => {
    const err = stepUpError(undefined);
    delete err.step_up_method;
    callMcpTool.mockRejectedValue(err);
    await clickMcpChip();

    await waitFor(() => expect(called("/api/auth/mfa/challenge")).toBe(true));
    expect(called("/api/auth/ciba/initiate")).toBe(false);
  });
});
