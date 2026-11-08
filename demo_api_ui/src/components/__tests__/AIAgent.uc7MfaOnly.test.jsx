/**
 * UC7 is the MFA step-up and nothing more: it ends once identity is verified.
 *
 * The step-up callback used to replay the prompt after the MFA. The live PingOne
 * Authorize policy answers pay_tuition_balance with HITL at every amount, so each
 * UC7 run minted a HITL challenge that UC7 never asks anyone to approve (UC8 is
 * the HITL use case). A use-case run now stops at "verified"; free-form chat still
 * replays so the payment the user typed goes through.
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
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../../context/TokenChainContext", () => ({ useTokenChainOptional: () => null }));
vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "none", fab: true, setAgentUi: vi.fn(), toolbarHostEl: null }),
}));
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({ tokenSecondsLeft: 900, tokenLoading: false, staleSession: false, hasActiveToken: true }),
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: null, agentManifest: null, adminManifest: null, pageMockData: null,
    activeId: "university", isAdminScope: false, isAdmin: false, refetch: () => {},
  }),
}));
vi.mock("../../services/demoAgentNlService", () => ({
  fetchNlStatus: vi.fn().mockResolvedValue({ groqConfigured: false, geminiConfigured: false }),
  parseNaturalLanguage: vi.fn().mockResolvedValue({
    source: "local", result: { kind: "action", action: { id: "accounts" } },
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
  callMcpTool: vi.fn().mockResolvedValue({ success: true }),
  sendAgentMessage: vi.fn().mockResolvedValue({ success: true }),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
}));
vi.mock("../../services/configService", () => ({ loadPublicConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("../../services/agentAccessConsent", () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false),
  setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: "Blocked.",
  getConsentState: vi.fn(() => null),
  setConsentDeclined: vi.fn(),
}));
vi.mock("../../utils/agentToolSteps", () => ({ getToolStepsForAction: vi.fn(() => []) }));
vi.mock("react-toastify", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../utils/appToast", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(), warning: vi.fn(), update: vi.fn(), dismiss: vi.fn(), loading: vi.fn() },
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(),
}));
// The real modal runs a PingOne device ceremony; the stub just reports "verified".
vi.mock("../OtpStepUpModal", async () => {
  const R = await import("react");
  return {
    default: ({ show, onSubmit }) =>
      show ? R.createElement("button", { onClick: () => onSubmit("123123") }, "complete-mfa") : null,
  };
});
vi.mock("../BankingAgent.css", () => ({}), { virtual: true });

const customerUser = { id: "u1", role: "customer", email: "user@test.com", username: "demoUser", firstName: "Demo" };

let origFetch;
const fetchedUrls = () => global.fetch.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.clear();
  origFetch = global.fetch;
  vi.clearAllMocks();
  // clearAllMocks keeps queued once-values; UC7 never consumes the HITL reply it queues.
  demoAgentService.sendAgentMessage.mockReset();
});
afterEach(() => {
  global.fetch = origFetch;
});

const stepUpThenHitl = () => {
  demoAgentService.sendAgentMessage
    .mockResolvedValueOnce({
      success: false, error: "mcp_step_up_required", action: "pay_tuition_balance",
      step_up_required: true, reply: "Step-up required.",
    })
    .mockResolvedValueOnce({
      success: false, error: "hitl_required", action: "pay_tuition_balance",
      hitlChallengeId: "chal-uc7", reply: "This action requires your approval.",
    })
    .mockResolvedValue({ success: true, reply: "Payment submitted." });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
};

const launch = (state) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: "/dashboard", state }]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent user={customerUser} mode="inline" />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );

test("UC7 ends once the MFA verifies: no replay, no HITL challenge, no approval card", async () => {
  stepUpThenHitl();
  launch({ triggerText: "pay $600 tuition", useCaseId: "UC7" });

  fireEvent.click(await screen.findByRole("button", { name: "complete-mfa" }, { timeout: 5000 }));

  expect(await screen.findByText(/Identity verified — MFA step-up complete/, {}, { timeout: 5000 })).toBeInTheDocument();
  expect(demoAgentService.sendAgentMessage).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /agree & continue|allow|approve/i })).toBeNull();
  expect(fetchedUrls().some((u) => u.includes("/api/mcp/decision/"))).toBe(false);
});

test("free-form chat (no use case) still replays the payment after the MFA", async () => {
  stepUpThenHitl();
  launch({ triggerText: "pay $600 tuition" });

  fireEvent.click(await screen.findByRole("button", { name: "complete-mfa" }, { timeout: 5000 }));

  await waitFor(() => expect(demoAgentService.sendAgentMessage).toHaveBeenCalledTimes(2));
});
