/**
 * UC7 (MFA step-up) must still reach the human approval when the replay is HITL.
 *
 * The live PingOne Authorize policy answers `pay_tuition_balance` with HITL at
 * every amount, so after the user verifies their identity the retried request
 * comes back `hitl_required` with a challenge id. The step-up callback used to
 * print `resp.reply` and stop: the user saw chat, the MFA dialog, then chat
 * again, and the minted challenge stayed pending with nobody able to approve it.
 * The callback must open the same approval card the other gates open, and
 * approving must approve THAT challenge.
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
});
afterEach(() => {
  global.fetch = origFetch;
});

test("after the step-up verifies, a HITL replay opens the approval card and approves that challenge", async () => {
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

  render(
    <MemoryRouter initialEntries={[{ pathname: "/dashboard", state: { triggerText: "pay $600 tuition", useCaseId: "UC7" } }]}>
      <ProofOfEnforcementProvider>
        <ActivityNarrativeProvider>
          <AIAgent user={customerUser} mode="inline" />
        </ActivityNarrativeProvider>
      </ProofOfEnforcementProvider>
    </MemoryRouter>,
  );

  // 1. Step-up first: verify identity with a code.
  fireEvent.click(await screen.findByRole("button", { name: "complete-mfa" }, { timeout: 5000 }));

  // 2. The replay was HITL: an approval card must appear (not just chat text).
  const agree = await screen.findByRole("button", { name: /agree & continue|allow|approve/i }, { timeout: 5000 });
  const modal = agree.closest('[role="dialog"]');
  for (const box of within(modal).queryAllByRole("checkbox")) fireEvent.click(box);
  fireEvent.click(agree);

  // 3. Approving approves the challenge the replay minted.
  await waitFor(() => {
    expect(fetchedUrls().some((u) => u.includes("/api/mcp/decision/chal-uc7/approve"))).toBe(true);
  });
});
