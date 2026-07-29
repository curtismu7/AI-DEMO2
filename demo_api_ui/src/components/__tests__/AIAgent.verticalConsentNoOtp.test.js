/* eslint-disable testing-library/no-wait-for-multiple-assertions */
/**
 * UC8 (consent-only) must not demand an emailed OTP.
 *
 * The `isMcpHitl` branch of handleHitlConfirm already learned this — see its
 * comment: "Do NOT pre-chain an OTP here: that made every consent-only transfer
 * (UC8 $300) and the CIBA demo (UC22) show a stray OTP field after the consent
 * modal. Let the policy decide what comes next."
 *
 * The `isVerticalConsent` branch (retail checkout, healthcare pay_bill, …) never
 * got that fix and still called initiateStepUpOtp() unconditionally, so approving
 * a $300 retail checkout popped an MFA device list even though PingOne Authorize
 * had asked only for consent ($300 sits between confirm=250 and step-up=500).
 *
 * A vertical tool that genuinely IS a step-up (mcp_step_up_required) must keep
 * its OTP — that is UC7, not UC8.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AIAgent from "../AIAgent";
import { ActivityNarrativeProvider } from "../../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../../context/ProofOfEnforcementContext";
import * as demoAgentService from "../../services/demoAgentService";

vi.mock("../../context/IndustryBrandingContext", () => ({
  useIndustryBranding: () => ({ preset: { shortName: "Super Banking", name: "Super Banking" } }),
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => ({ open: jest.fn(), close: jest.fn() }),
  useEducationUI: () => ({ open: jest.fn(), close: jest.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({ useTokenChainOptional: () => null }));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: jest.fn(), toolbarHostEl: null }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({ tokenSecondsLeft: 900, tokenLoading: false, staleSession: false, hasActiveToken: true }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: null, agentManifest: null, adminManifest: null, pageMockData: null,
    activeId: "retail", isAdminScope: false, isAdmin: false, refetch: () => {},
  }),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: jest.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: jest.fn().mockResolvedValue({
    source: "local", result: { kind: "action", action: { id: "accounts" } },
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
  sendAgentMessage: jest.fn().mockResolvedValue({ success: true }),
  fetchAgentTools: jest.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({ loadPublicConfig: jest.fn().mockResolvedValue({}) }));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: jest.fn(() => false),
  setAgentBlockedByConsentDecline: jest.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked.",
  getConsentState: jest.fn(() => null),
  setConsentDeclined: jest.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: jest.fn(() => []) }));
vi.mock("react-toastify", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warn: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), warning: jest.fn(), update: jest.fn(), dismiss: jest.fn(), loading: jest.fn() },
  notifySuccess: jest.fn(), notifyError: jest.fn(), notifyInfo: jest.fn(), notifyWarning: jest.fn(),
}));
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

const customerUser = { id: "u1", role: "customer", email: "user@test.com", username: "demoUser", firstName: "Demo" };

const renderAgent = () =>
  render(
    <MemoryRouter>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent user={customerUser} mode="inline" />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );

let origFetch;
const fetchedUrls = () => global.fetch.mock.calls.map((c) => String(c[0]));

/** Drive a vertical tool call whose gate response is `body`. */
async function runVerticalGate(body) {
  demoAgentService.sendAgentMessage.mockResolvedValue(body);
  global.fetch = jest.fn((url) => {
    if (String(url).includes("/api/demo-agent/nl")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          result: { kind: "vertical", action: "checkout", vertical: "retail", params: { amount: 300 } },
          source: "heuristic",
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  renderAgent();
  const input = screen.getByPlaceholderText(/^Message |^Ask about/);
  fireEvent.change(input, { target: { value: "checkout headphones for $300" } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** Tick the modal's own consent checkbox (the page has others) and accept. */
async function approveConsentModal() {
  const agree = await screen.findByRole("button", { name: /agree & continue|allow/i });
  const modal = agree.closest('[role="dialog"]');
  for (const box of within(modal).queryAllByRole("checkbox")) fireEvent.click(box);
  fireEvent.click(agree);
}

beforeEach(() => {
  localStorage.clear();
  origFetch = global.fetch;
  jest.clearAllMocks();
});
afterEach(() => {
  global.fetch = origFetch;
});

test("approving a CONSENT-only vertical gate does not initiate a step-up OTP", async () => {
  await runVerticalGate({
    success: false,
    error: "mcp_hitl_required",
    action: "checkout",
    hitlChallengeId: "c1",
    reply: "Human approval required.",
  });

  await approveConsentModal();

  await waitFor(() => {
    expect(fetchedUrls().some((u) => u.includes("/api/mcp/decision/c1/approve"))).toBe(true);
  });
  expect(fetchedUrls().some((u) => u.includes("/api/auth/oauth/user/initiate-otp"))).toBe(false);
  expect(fetchedUrls().some((u) => u.includes("/api/auth/mfa/challenge"))).toBe(false);
});

test("approving a genuine STEP-UP vertical gate still initiates the OTP (UC7)", async () => {
  await runVerticalGate({
    success: false,
    error: "mcp_step_up_required",
    action: "checkout",
    hitlChallengeId: "c2",
    reply: "Step-up required.",
  });

  await approveConsentModal();

  await waitFor(() => {
    expect(fetchedUrls().some((u) => u.includes("/api/auth/oauth/user/initiate-otp"))).toBe(true);
  });
});
